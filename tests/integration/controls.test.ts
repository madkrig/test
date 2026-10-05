import { describe, expect, it } from 'vitest';
import * as activateRoute from '@/app/api/engagements/[id]/bank-confirmations/activate/route';
import * as checkRoute from '@/app/api/bank-tasks/[id]/administrative-check/route';
import * as patchItemRoute from '@/app/api/bank-confirmations/[id]/population/items/[itemId]/route';
import * as portfolioRoute from '@/app/api/reviewer/portfolio/route';
import * as bulkRoute from '@/app/api/reviewer/bulk-approve/route';
import * as runRoute from '@/app/api/completeness-runs/run/route';
import * as clarifyRoute from '@/app/api/completeness-items/[id]/decide/route';
import * as methodsRoute from '@/app/api/banks/[id]/methods/route';
import * as approveMethodRoute from '@/app/api/bank-methods/[id]/approve/route';
import * as activateMethodRoute from '@/app/api/bank-methods/[id]/activate/route';
import * as banksRoute from '@/app/api/banks/route';
import { prisma } from '@/services';
import { setSharePointFailure } from '@/services/adapters';
import { setClock } from '@/services/clock';
import { allChecks, call, reseed } from './helpers';

describe('BR-01 dublet', () => {
  it('viser den eksisterende subopgave ved dubletforsøg', async () => {
    const ids = await reseed('start');
    const res = await call(activateRoute, 'POST', '/a', { user: 'u-sofie', params: { id: 'eng-nordhavn-2026' }, body: {} });
    expect(res.status).toBe(409);
    expect(res.json.error.existingId).toBe(ids.nordhavn);
  });
});

describe('population – fjernelse kræver begrundelse', () => {
  it('afviser fjernelse uden begrundelse og gemmer revisors ændring i ny version', async () => {
    const ids = await reseed('start');
    const v1 = await prisma.populationVersion.findFirstOrThrow({ where: { subtaskId: ids.nordhavn }, include: { items: true } });
    const jyske = v1.items.find((i) => i.bankId === 'jyske')!;
    const bad = await call(patchItemRoute, 'PATCH', '/p', { user: 'u-sofie', params: { id: ids.nordhavn, itemId: jyske.id }, body: { change: 'REMOVED' } });
    expect(bad.status).toBe(400);
    const ok = await call(patchItemRoute, 'PATCH', '/p', { user: 'u-sofie', params: { id: ids.nordhavn, itemId: jyske.id }, body: { change: 'REMOVED', removalReason: 'Konto ophørt 2025' } });
    expect(ok.status).toBe(200);
    const versions = await prisma.populationVersion.findMany({ where: { subtaskId: ids.nordhavn }, orderBy: { version: 'asc' } });
    expect(versions.map((v) => [v.version, v.status])).toEqual([[1, 'REJECTED'], [2, 'SUBMITTED']]);
  });
});

describe('SharePoint-integrationsfejl', () => {
  it('gemmer blokeret tilstand med recovery action, og genforsøg lykkes', async () => {
    const ids = await reseed('brief');
    setClock('2027-01-20');
    const sydbank = (await prisma.bankTask.findMany({ where: { subtaskId: ids.nordhavn } })).find((t) => t.bankId === 'sydbank')!;
    const { receive } = await import('@/services/bank-task-service');
    const { loadActor } = await import('@/services/access');
    await receive(await loadActor(prisma, 'u-jonas'), sydbank.id, { channel: 'UPLOAD_PORTAL', originalFileName: 'sydbank.pdf' }, 'recv');
    setSharePointFailure(true);
    const fail = await call(checkRoute, 'POST', '/c', { user: 'u-jonas', params: { id: sydbank.id }, idempotencyKey: 'c1', body: { checks: allChecks } });
    setSharePointFailure(false);
    expect(fail.status).toBe(502);
    expect(fail.json.error.recovery).toMatch(/Prøv uploaden igen/);
    const blocked = await prisma.bankTask.findUniqueOrThrow({ where: { id: sydbank.id } });
    expect(blocked.flagBlocked).toBe(true);
    expect(blocked.nextAction).toMatch(/SharePoint fejlede/);
    const retry = await call(checkRoute, 'POST', '/c', { user: 'u-jonas', params: { id: sydbank.id }, idempotencyKey: 'c2', body: {} });
    expect(retry.status).toBe(200);
    expect(retry.json.data.flags.blocked).toBe(false);
  });
});

describe('R-06 portefølje og massegodkendelse', () => {
  it('kun klare, egne populationer; separat godkendelse pr. engagement og delvise fejl pr. record', async () => {
    await reseed('start');
    const portfolio = await call(portfolioRoute, 'GET', '/p', { user: 'u-sofie' });
    const byCustomer = Object.fromEntries(portfolio.json.map((r: { customer: string; ready: boolean }) => [r.customer, r.ready]));
    expect(byCustomer).toMatchObject({ 'Havbryn Logistik ApS': true, 'Lindegaard Arkitekter I/S': true, 'Solbakken Ejendomme A/S': false });
    expect(portfolio.json.some((r: { customer: string }) => r.customer === 'Skovly Foods A/S')).toBe(false);
    const pick = (name: string) => portfolio.json.find((r: { customer: string }) => r.customer === name);
    const items = ['Havbryn Logistik ApS', 'Lindegaard Arkitekter I/S', 'Solbakken Ejendomme A/S'].map((n) => ({ subtaskId: pick(n).subtaskId, versionId: pick(n).versionId }));
    expect((await call(bulkRoute, 'POST', '/b', { user: 'u-sofie', body: { items, confirmed: false } })).status).toBe(400);
    const res = await call(bulkRoute, 'POST', '/b', { user: 'u-sofie', body: { items, confirmed: true } });
    expect(res.json.data.approved).toBe(2);
    expect(res.json.data.failed).toBe(1);
    expect(res.json.data.results.find((r: { ok: boolean }) => !r.ok).error).toMatch(/åbne spørgsmål/);
    expect(await prisma.event.count({ where: { action: 'APPROVED', objectType: 'POPULATION', actorId: 'u-sofie' } })).toBe(2);
    // Martin kan ikke massegodkende Sofies opgaver.
    const martin = await call(bulkRoute, 'POST', '/b', { user: 'u-martin', body: { items: [items[2]], confirmed: true } });
    expect(martin.json.data.results[0].ok).toBe(false);
  });
});

describe('månedlig fuldstændighedskontrol', () => {
  it('finder manglende subopgave, opretter afklaring og kræver begrundelse ved fravalg', async () => {
    await reseed('start');
    const seeded = await prisma.completenessItem.findFirstOrThrow({ where: { engagementId: 'eng-havbrynholding-2026' } });
    expect(seeded.decision).toBe('OPEN');
    const run = await call(runRoute, 'POST', '/r', { user: 'u-mia', body: { runDate: '2026-12-01' } });
    expect(run.status).toBe(200);
    expect(run.json.data.newClarifications).toBe(0);
    expect(await prisma.bankTask.count({ where: { engagementId: 'eng-havbrynholding-2026' } })).toBe(0);
    expect((await call(runRoute, 'POST', '/r', { user: 'u-sofie', body: {} })).status).toBe(403);
    const noReason = await call(clarifyRoute, 'POST', '/d', { user: 'u-martin', params: { id: seeded.id }, body: { decision: 'OPT_OUT' } });
    expect(noReason.status).toBe(400);
    const optOut = await call(clarifyRoute, 'POST', '/d', { user: 'u-martin', params: { id: seeded.id }, body: { decision: 'OPT_OUT', reason: 'Holdingselskab uden bankkonti' } });
    expect(optOut.status).toBe(200);
    expect((await prisma.completenessItem.findUniqueOrThrow({ where: { id: seeded.id } })).optOutReason).toBe('Holdingselskab uden bankkonti');
  });
});

describe('SO-02 bankregister', () => {
  it('fire-øjne på metodeændring; åbne opgaver bevarer gammel version', async () => {
    const ids = await reseed('brief');
    const banks = await call(banksRoute, 'GET', '/b', { user: 'u-mia' });
    expect(banks.json[0].name).toBe('Jyske Bank'); // forældet metode først
    const draft = await call(methodsRoute, 'POST', '/m', {
      user: 'u-mia', params: { id: 'sydbank' },
      body: { channel: 'PLATFORM', urlOrChannel: 'Bekræftelsesplatform', requiredFields: ['CVR'], authorizationRequirement: 'GENERAL', expectedResponseWorkdays: 8, reminderMethod: 'Platform', escalationContact: 'Erhverv', validFrom: '2027-01-15', changeReason: 'Sydbank flytter til platform' },
    });
    const id = draft.json.data.id;
    expect((await call(activateMethodRoute, 'POST', '/a', { user: 'u-mia', params: { id } })).json.error.message).toMatch(/godkendes/);
    expect((await call(approveMethodRoute, 'POST', '/a', { user: 'u-mia', params: { id } })).status).toBe(403);
    expect((await call(approveMethodRoute, 'POST', '/a', { user: 'u-lars', params: { id } })).status).toBe(200);
    const activated = await call(activateMethodRoute, 'POST', '/a', { user: 'u-mia', params: { id } });
    const sydbankTask = (await prisma.bankTask.findMany({ where: { subtaskId: ids.nordhavn } })).find((t) => t.bankId === 'sydbank')!;
    expect(activated.json.data.affectedOpenBankTasks).toContain(sydbankTask.id);
    expect(sydbankTask.methodVersionId).toBe('m-sydbank-2');
    expect((await prisma.bankMethodVersion.findUniqueOrThrow({ where: { id: 'm-sydbank-2' } })).status).toBe('RETIRED');
    // Kerne-medarbejder kan ikke ændre bankmetoder.
    expect((await call(approveMethodRoute, 'POST', '/a', { user: 'u-jonas', params: { id } })).status).toBe(403);
  });
});

describe('hændelseslog', () => {
  it('er append-only i applikationslaget', async () => {
    const eventLog = await import('@/services/event-log');
    expect(Object.keys(eventLog).sort()).toEqual(['appendEvent', 'listEvents']);
  });
});
