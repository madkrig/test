import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as clientsRoute from '@/app/api/clients/route';
import * as signersRoute from '@/app/api/clients/[id]/signers/route';
import * as demoSignRoute from '@/app/api/demo/penneo/sign/route';
import * as notificationsRoute from '@/app/api/notifications/route';
import * as requestsRoute from '@/app/api/signing-requests/route';
import * as requestRoute from '@/app/api/signing-requests/[id]/route';
import * as archiveRoute from '@/app/api/signing-requests/[id]/archive/route';
import { prisma } from '@/services';
import { adapters, setPenneoFailure, setSharePointFailure } from '@/services/adapters';
import { minimalPdf } from '@/services/pdf';
import { call, caseFile, penneoWebhook, reseed, signerSigned } from './helpers';

const sofie = 'u-sofie';
const martin = 'u-martin';

const create = (body: Record<string, unknown>, key = crypto.randomUUID(), user = sofie) =>
  call(requestsRoute, 'POST', '/api/signing-requests', { user, body, idempotencyKey: key });
const detail = (id: string) => call(requestRoute, 'GET', `/api/signing-requests/${id}`, { user: sofie, params: { id } });
const penneoCalls = (operation: string) => prisma.integrationCall.count({ where: { system: 'PENNEO', operation } });
const notificationsFor = (type: string) => prisma.notification.findMany({ where: { recipient: sofie, type } });

beforeEach(reseed);
afterEach(() => {
  delete process.env.PENNEO_WEBHOOK_TOKEN;
  process.env.PENNEO_MODE = 'mock';
});

describe('markedspladsens dialog', () => {
  it('viser revisors egne kunder og underskriverne præcis som i stamdata', async () => {
    const clients = await call(clientsRoute, 'GET', '/api/clients', { user: sofie });
    expect(clients.json.data.map((c: { name: string }) => c.name)).toEqual(['Bager Jensen ApS', 'Fjordlys Ejendomme A/S', 'Nordhavn Teknik A/S']);

    const res = await call(signersRoute, 'GET', '/api/clients/c-nordhavn/signers?service=ANNUAL_REPORT', { user: sofie, params: { id: 'c-nordhavn' } });
    expect(res.status).toBe(200);
    expect(res.json.data.signers.map((s: { name: string; roleLabel: string }) => `${s.name} (${s.roleLabel})`)).toEqual([
      'Mette Hansen (Direktør)', 'Lars Holm (Bestyrelsesformand)', 'Anne Kjær (Bestyrelsesmedlem)',
    ]);
    expect(res.json.data.blockers).toEqual([]);
    expect(res.json.data.documentTitle).toBe('Årsrapport 2025 – Nordhavn Teknik A/S');

    const representation = await call(signersRoute, 'GET', '/api/clients/c-nordhavn/signers?service=MANAGEMENT_REPRESENTATION', { user: sofie, params: { id: 'c-nordhavn' } });
    expect(representation.json.data.signers.map((s: { name: string }) => s.name)).toEqual(['Mette Hansen']);
  });

  it('blokerer, når stamdata ikke er klar, uden at kontakte Penneo', async () => {
    const fjordlys = await call(signersRoute, 'GET', '/api/clients/c-fjordlys/signers?service=ANNUAL_REPORT', { user: sofie, params: { id: 'c-fjordlys' } });
    expect(fjordlys.json.data.blockers).toEqual(['Søren Mikkelsen (Bestyrelsesformand) mangler e-mail i stamdata.']);

    const res = await create({ clientId: 'c-bager', serviceType: 'AUDIT_PROTOCOL' });
    expect(res.status).toBe(409);
    expect(res.json.error.reasons[0]).toContain('ingen aktive underskrivere med rollen bestyrelsesformand');
    expect(res.json.error.recovery).toContain('stamdata');
    expect(await penneoCalls('createAndSendCaseFile')).toBe(1); // kun seed-forløbet
  });

  it('afviser en anden revisors kunde og logger afvisningen', async () => {
    const res = await call(signersRoute, 'GET', '/api/clients/c-vestkyst/signers?service=ANNUAL_REPORT', { user: sofie, params: { id: 'c-vestkyst' } });
    expect(res.status).toBe(403);
    expect((await create({ clientId: 'c-vestkyst', serviceType: 'ANNUAL_REPORT' })).status).toBe(403);
    expect(await prisma.event.count({ where: { action: 'ACCESS_DENIED', actorId: sofie } })).toBe(2);
    expect((await call(clientsRoute, 'GET', '/api/clients', { user: martin })).json.data).toHaveLength(1);
  });
});

describe('fra markedsplads til arkiveret dokument', () => {
  it('kører hele forløbet: Penneo-sag, underskrifter, SharePoint og besked til revisor', async () => {
    const res = await create({ clientId: 'c-nordhavn', serviceType: 'ANNUAL_REPORT' });
    expect(res.status).toBe(200);
    const request = res.json.data;
    expect(request.status).toBe('AWAITING_SIGNATURES');
    expect(res.json.nextAction).toBe('Afventer underskrift (0/3)');
    expect(res.json.nextOwner).toBe('Mette Hansen, Lars Holm, Anne Kjær');
    expect(request.penneo.statusLabel).toBe('pending');

    const sent = await prisma.integrationCall.findFirstOrThrow({ where: { operation: 'createAndSendCaseFile' }, orderBy: { at: 'desc' } });
    const payload = JSON.parse(sent.payload);
    expect(payload.signers.map((s: { role: string }) => s.role)).toEqual(['Direktør', 'Bestyrelsesformand', 'Bestyrelsesmedlem']);
    expect(payload.reference).toBe(request.id);

    const active = await call(requestsRoute, 'GET', '/api/signing-requests?scope=active', { user: sofie });
    expect(active.json.data.map((r: { id: string }) => r.id)).toEqual([request.id]);

    const signers = await prisma.signingRequestSigner.findMany({ where: { requestId: request.id }, orderBy: { sortOrder: 'asc' } });
    const first = await penneoWebhook(signerSigned(signers[0]!.penneoSignerId!), { eventId: 'evt-1' });
    expect(first.json).toEqual({ handled: true, requestId: request.id });
    let current = (await detail(request.id)).json;
    expect(current.nextAction).toBe('Afventer underskrift (1/3)');
    expect(current.nextOwner).toBe('Lars Holm, Anne Kjær');

    // Penneo genfremsender samme hændelse: ingen dobbeltregistrering.
    const again = await penneoWebhook(signerSigned(signers[0]!.penneoSignerId!), { eventId: 'evt-1' });
    expect(again.json).toEqual(first.json);
    expect(await prisma.event.count({ where: { requestId: request.id, action: 'SIGNER_SIGNED' } })).toBe(1);

    await penneoWebhook(signerSigned(signers[1]!.penneoSignerId!), { eventId: 'evt-2' });
    // Sidste signer-hændelse går tabt; casefile.completed afslutter alligevel.
    const done = await penneoWebhook(caseFile('completed', request.penneo.caseFileId), { eventId: 'evt-3' });
    expect(done.json.handled).toBe(true);

    current = (await detail(request.id)).json;
    expect(current.data.status).toBe('COMPLETED');
    expect(current.data.signers.every((s: { status: string }) => s.status === 'SIGNED')).toBe(true);
    expect(current.data.penneo.statusLabel).toBe('completed');
    expect(current.data.sharePoint.url).toContain('/Kunder/c-nordhavn/E-signering/aarsrapport-2025-nordhavn-teknik-a-s_underskrevet.pdf');
    expect(current.data.sharePoint.integrityHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(current.events.map((e: { action: string }) => e.action)).toEqual([
      'SENT_TO_PENNEO', 'SIGNER_SIGNED', 'SIGNER_SIGNED', 'STATUS_CHANGED', 'ARCHIVED', 'STATUS_CHANGED',
    ]);

    const notifications = await call(notificationsRoute, 'GET', '/api/notifications', { user: sofie });
    expect(notifications.json.unread).toBe(1);
    expect(notifications.json.data[0]).toMatchObject({
      type: 'DOCUMENT_SIGNED',
      message: 'Årsrapport 2025 – Nordhavn Teknik A/S er underskrevet af alle og arkiveret i SharePoint.',
      link: `/opgaver?id=${request.id}`,
    });

    const late = await penneoWebhook(caseFile('completed', request.penneo.caseFileId), { eventId: 'evt-4' });
    expect(late.json).toMatchObject({ handled: false, reason: 'Allerede afsluttet' });
    expect(await penneoCalls('downloadSignedDocument')).toBe(2); // seed + dette forløb
  });

  it('opretter kun én Penneo-sag ved dobbeltklik (Idempotency-Key)', async () => {
    const a = await create({ clientId: 'c-nordhavn', serviceType: 'ANNUAL_REPORT' }, 'klik-1');
    const b = await create({ clientId: 'c-nordhavn', serviceType: 'ANNUAL_REPORT' }, 'klik-1');
    expect(b.json.data.id).toBe(a.json.data.id);
    expect(await penneoCalls('createAndSendCaseFile')).toBe(2);
    // Nøglen gælder pr. bruger: en anden revisor med samme nøgle får sit eget forløb.
    const other = await create({ clientId: 'c-vestkyst', serviceType: 'MANAGEMENT_REPRESENTATION' }, 'klik-1', martin);
    expect(other.json.data.client.name).toBe('Vestkyst Logistik A/S');
    const missing = await call(requestsRoute, 'POST', '/api/signing-requests', { user: sofie, body: { clientId: 'c-nordhavn', serviceType: 'ANNUAL_REPORT' } });
    expect(missing.status).toBe(400);
  });

  it('sender revisors egen PDF og afviser andre filtyper', async () => {
    const notPdf = await create({ clientId: 'c-bager', serviceType: 'ANNUAL_REPORT', document: { fileName: 'noter.txt', contentBase64: Buffer.from('hej').toString('base64') } });
    expect(notPdf.status).toBe(400);
    expect(notPdf.json.error.message).toBe('Dokumentet skal være en PDF.');

    const pdf = minimalPdf(['Årsrapport 2025']).toString('base64');
    const ok = await create({ clientId: 'c-bager', serviceType: 'ANNUAL_REPORT', documentTitle: 'Årsrapport 2025/26', document: { fileName: 'Årsrapport final.pdf', contentBase64: pdf } });
    expect(ok.status).toBe(200);
    expect(ok.json.data).toMatchObject({ fileName: 'Årsrapport final.pdf', documentTitle: 'Årsrapport 2025/26' });
  });
});

describe('fejl og undtagelser', () => {
  it('starter intet, hvis Penneo ikke svarer, og samme nøgle kan genbruges bagefter', async () => {
    setPenneoFailure(true);
    const failed = await create({ clientId: 'c-nordhavn', serviceType: 'ANNUAL_REPORT' }, 'retry-1');
    expect(failed.status).toBe(502);
    expect(failed.json.error.recovery).toContain('Der er ikke sendt noget');
    expect(await prisma.signingRequest.count()).toBe(1);
    setPenneoFailure(false);
    expect((await create({ clientId: 'c-nordhavn', serviceType: 'ANNUAL_REPORT' }, 'retry-1')).status).toBe(200);
  });

  it('beholder et underskrevet dokument som "arkivering fejlede", indtil genforsøg lykkes', async () => {
    const { json } = await create({ clientId: 'c-nordhavn', serviceType: 'MANAGEMENT_REPRESENTATION' });
    setSharePointFailure(true);
    await penneoWebhook(caseFile('completed', json.data.penneo.caseFileId), { eventId: 'evt-sp' });

    let current = (await detail(json.data.id)).json;
    expect(current.data).toMatchObject({ status: 'SIGNED', archiveFailed: true, sharePoint: null });
    expect(current.nextAction).toBe('Arkivering i SharePoint fejlede – prøv igen');
    expect(current.nextOwner).toBe('Sofie Lund');

    const stillDown = await call(archiveRoute, 'POST', '/archive', { user: sofie, params: { id: json.data.id } });
    expect(stillDown.status).toBe(502);
    expect(await notificationsFor('ARCHIVE_FAILED')).toHaveLength(1);

    setSharePointFailure(false);
    const retried = await call(archiveRoute, 'POST', '/archive', { user: sofie, params: { id: json.data.id } });
    expect(retried.status).toBe(200);
    expect(retried.json.data).toMatchObject({ status: 'COMPLETED', archiveFailed: false });
    expect(await notificationsFor('DOCUMENT_SIGNED')).toHaveLength(2); // seed + dette forløb

    current = (await detail(json.data.id)).json;
    expect(current.events.filter((e: { action: string }) => e.action === 'ARCHIVE_FAILED')).toHaveLength(2);
  });

  it('giver også en genforsøgsknap, når arkiveringen fejler uventet', async () => {
    const { json } = await create({ clientId: 'c-nordhavn', serviceType: 'MANAGEMENT_REPRESENTATION' });
    const real = adapters.sharePoint;
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    adapters.sharePoint = { uploadSignedDocument: async () => { throw new Error('socket hang up'); } };
    try {
      const res = await penneoWebhook(caseFile('completed', json.data.penneo.caseFileId), { eventId: 'evt-boom' });
      expect(res.status).toBe(200);
    } finally {
      adapters.sharePoint = real;
      quiet.mockRestore();
    }
    const current = (await detail(json.data.id)).json;
    expect(current.data).toMatchObject({ status: 'SIGNED', archiveFailed: true });
    expect(current.events.at(-1)).toMatchObject({ action: 'ARCHIVE_FAILED', reason: 'Arkiveringen fejlede uventet.' });
    expect((await call(archiveRoute, 'POST', '/archive', { user: sofie, params: { id: json.data.id } })).json.data.status).toBe('COMPLETED');
  });

  it('sender et afvist forløb tilbage til revisor', async () => {
    const { json } = await create({ clientId: 'c-nordhavn', serviceType: 'ANNUAL_REPORT' });
    await penneoWebhook(caseFile('rejected', json.data.penneo.caseFileId), { eventId: 'evt-rej' });
    const current = (await detail(json.data.id)).json;
    expect(current.data.status).toBe('REJECTED');
    expect(current.nextOwner).toBe('Sofie Lund');
    expect(await notificationsFor('SIGNING_REJECTED')).toHaveLength(1);
    const retry = await call(archiveRoute, 'POST', '/archive', { user: sofie, params: { id: json.data.id } });
    expect(retry.status).toBe(409);
  });

  it('kvitterer ukendte hændelser, afviser ugyldigt payload og kræver token, når det er sat', async () => {
    expect((await penneoWebhook({ topic: 'casefile', eventType: 'activated', payload: { id: 1 } })).json).toMatchObject({ handled: false });
    expect((await penneoWebhook(caseFile('completed', 424242))).json).toMatchObject({ handled: false, reason: 'Ukendt Penneo-sag' });
    expect((await penneoWebhook({ topic: 'casefile' })).status).toBe(400);

    process.env.PENNEO_WEBHOOK_TOKEN = 'hemmelig';
    expect((await penneoWebhook(caseFile('completed', 1))).status).toBe(401);
    expect((await penneoWebhook(caseFile('completed', 1), { query: '?token=hemmelig' })).status).toBe(200);
  });
});

describe('demo-simulatoren', () => {
  it('spiller Penneo gennem den rigtige webhook-handler og kan slås fra', async () => {
    const { json } = await create({ clientId: 'c-nordhavn', serviceType: 'ANNUAL_REPORT' });
    for (const signer of json.data.signers) {
      const res = await call(demoSignRoute, 'POST', '/api/demo/penneo/sign', { user: sofie, body: { requestId: json.data.id, signerId: signer.id } });
      expect(res.status).toBe(200);
    }
    expect((await detail(json.data.id)).json.data.status).toBe('COMPLETED');
    expect(await penneoCalls('webhook:signer.signed')).toBe(4); // 1 i seed + 3 her
    expect(await penneoCalls('webhook:casefile.completed')).toBe(2);

    const again = await call(demoSignRoute, 'POST', '/api/demo/penneo/sign', { user: sofie, body: { requestId: json.data.id, signerId: json.data.signers[0].id } });
    expect(again.status).toBe(409);
    expect((await call(demoSignRoute, 'POST', '/', { user: martin, body: { requestId: json.data.id, signerId: json.data.signers[0].id } })).status).toBe(403);

    process.env.PENNEO_MODE = 'live';
    const off = await call(demoSignRoute, 'POST', '/', { user: sofie, body: { requestId: json.data.id, signerId: json.data.signers[0].id } });
    expect(off.status).toBe(403);
  });
});
