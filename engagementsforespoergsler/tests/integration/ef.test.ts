import { NextRequest } from 'next/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { createRouter } from '@/app/api/_lib/handler';
import { ROUTES } from '@/app/api/_lib/routes';
import { prisma, setToday } from '@/services';
import { DEMO_DATE, runScenario } from '../../scripts/seed/scenario';
import { seedWorld } from '../../scripts/seed/world';

/**
 * Integrationstests gennem API-kontrakten (samme router som appen) mod en
 * SQLite-testdatabase, der er afspillet frem til demo-datoen via services.
 */
const router = createRouter(ROUTES);

async function call(method: string, path: string, opts: { user?: string; body?: unknown; key?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.user !== undefined) headers['x-user-id'] = opts.user;
  if (opts.key) headers['idempotency-key'] = opts.key;
  const req = new NextRequest(`http://test/api${path}`, { method, headers, body: opts.body === undefined || method === 'GET' ? undefined : JSON.stringify(opts.body) });
  const segments = new URL(`http://test${path}`).pathname.split('/').filter(Boolean);
  const res = await router(req, { params: Promise.resolve({ path: segments }) });
  const text = await res.text();
  let json: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}

const caseOf = async (customerId: string, T: string) => prisma.case.findFirstOrThrow({ where: { customerId, balanceDate: T } });
const inquiryOf = async (customerId: string, T: string, instituteId: string) =>
  prisma.inquiry.findFirstOrThrow({ where: { caseId: (await caseOf(customerId, T)).id, instituteId, status: { not: 'ANNULLERET' } }, orderBy: { createdAt: 'desc' } });

describe('P01 – sager oprettes af reglerne', () => {
  it('opretter sager ved T−60 og er idempotent', async () => {
    await seedWorld(prisma, { startDate: '2026-04-30' });
    await call('POST', '/job/daglig', { user: 'u-lfrost' });
    expect(await prisma.case.count({ where: { id: { not: { startsWith: 'sag-hist' } } } })).toBe(0);
    await setToday(prisma, '2026-05-01');
    const first = await call('POST', '/job/daglig', { user: 'u-lfrost' });
    expect(first.json.casesCreated).toBe(2);
    const again = await call('POST', '/job/daglig', { user: 'u-lfrost' });
    expect(again.json.casesCreated).toBe(0);
    const c = await caseOf('k-havbryggen', '2026-06-30');
    const lines = await prisma.bankListLine.findMany({ where: { caseId: c.id } });
    expect(lines.map((l) => l.instituteId).sort()).toEqual(['inst-lindholm', 'inst-nordea']);
    expect(JSON.parse(lines.find((l) => l.instituteId === 'inst-nordea')!.sources)).toEqual(['SIDSTE_AAR', 'SAFT']);
  });

  it('kun kerneteamleder, administrator og systemet kan køre den daglige kørsel', async () => {
    expect((await call('POST', '/job/daglig', { user: 'u-mlund' })).status).toBe(403);
    expect((await call('POST', '/job/daglig')).status).toBe(403);
  });
});

describe('Sæsonen afspillet til demo-datoen', () => {
  beforeAll(async () => {
    await seedWorld(prisma, { startDate: '2026-05-01' });
    await runScenario(prisma);
  }, 120000);

  it('kontrakten er beskrevet (GET /api)', async () => {
    const r = await call('GET', '/', { user: 'u-mlund' });
    expect(r.json.routes.length).toBeGreaterThan(50);
    expect(r.json.routes).toContainEqual(expect.objectContaining({ method: 'POST', path: '/api/afsendelser/batch' }));
  });

  it('arbejdskøen viser nøgletal og kun sager, brugeren har adgang til (10.4)', async () => {
    const maja = await call('GET', '/koe?view=ALLE', { user: 'u-mlund' });
    expect(maja.json.today).toBe(DEMO_DATE);
    expect(maja.json.kpis.klar).toBeGreaterThanOrEqual(4);
    expect(maja.json.kpis.afvist).toBe(1);
    const ahmad = await call('GET', '/koe?view=ALLE', { user: 'u-aali' });
    const names = (r: { json: { rows: { customer: string }[] } }) => r.json.rows.map((x) => x.customer);
    expect(names(maja)).toContain('Saltholm Kapital A/S');
    expect(names(ahmad)).not.toContain('Saltholm Kapital A/S'); // fortrolig
    expect(names(ahmad)).not.toContain('Kirkegade Bolig A/S'); // habilitetsspærring
    const kirkegade = await caseOf('k-kirkegade', '2026-12-31');
    expect((await call('GET', `/sager/${kirkegade.id}`, { user: 'u-aali' })).status).toBe(404);
    expect(kirkegade.coreUserId).not.toBe('u-aali');
  });

  it('en batch kræver samme institut og kanal, idempotensnøgle og en bruger – ikke en agent', async () => {
    const nordea = await inquiryOf('k-havnegade', '2026-12-31', 'inst-nordea');
    const groenlund = await inquiryOf('k-groenlund', '2026-12-31', 'inst-nordea');
    const danske = await inquiryOf('k-havnegade', '2026-12-31', 'inst-danske');
    expect((await call('POST', '/afsendelser/batch', { user: 'u-mlund', body: { inquiryIds: [nordea.id] } })).status).toBe(400);
    const mixed = await call('POST', '/afsendelser/batch', { user: 'u-mlund', key: 'k-mixed', body: { inquiryIds: [nordea.id, danske.id] } });
    expect(mixed.status).toBe(400);
    expect(mixed.json.error.message).toContain('samme institut og kanal');
    const agent = await call('POST', '/afsendelser/batch', { user: 'u-agent', key: 'k-agent', body: { inquiryIds: [nordea.id] } });
    expect(agent.status).toBe(403);
    expect(agent.json.error.message).toContain('Agenter må kun læse og foreslå');

    const first = await call('POST', '/afsendelser/batch', { user: 'u-mlund', key: 'k-nordea', body: { inquiryIds: [nordea.id, groenlund.id] } });
    expect(first.status).toBe(200);
    expect(first.json.sent).toBe(2);
    const calls = await prisma.integrationCall.count({ where: { operation: 'sendMail' } });
    const retry = await call('POST', '/afsendelser/batch', { user: 'u-mlund', key: 'k-nordea', body: { inquiryIds: [nordea.id, groenlund.id] } });
    expect(retry.json.batchId).toBe(first.json.batchId);
    expect(await prisma.integrationCall.count({ where: { operation: 'sendMail' } })).toBe(calls);
    const sent = await prisma.inquiry.findUniqueOrThrow({ where: { id: nordea.id } });
    expect(sent.status).toBe('SENDT');
    // Forudbestilling: svarfristen regnes fra balancedagen, og sæsonfristen gælder ved 31.12.
    expect(sent.responseDeadline).toBe('2027-02-26');
  });

  it('afsendelse før instituttets tidligste tidspunkt blokeres (VR-09)', async () => {
    const danske = await inquiryOf('k-havnegade', '2026-12-31', 'inst-danske');
    const r = await call('POST', '/afsendelser/batch', { user: 'u-mlund', key: 'k-early', body: { inquiryIds: [danske.id] } });
    expect(r.status).toBe(409);
    expect(r.json.error.reasons.join(' ')).toContain('VR-09');
  });

  it('afsender og opgørelsesdato kontrolleres (AR-02, AR-03)', async () => {
    const lysgaard = await inquiryOf('k-lysgaard', '2026-09-30', 'inst-nykredit');
    const forwarded = await call('POST', `/forespoergsler/${lysgaard.id}/simuler-svar`, { user: 'u-mlund', body: { variant: 'VIDERESENDT' } });
    expect(forwarded.json.matched).toBe(true);
    const r = await prisma.response.findUniqueOrThrow({ where: { id: forwarded.json.responseId } });
    expect(r.senderVerified).toBe(false);
    expect(r.invalidReason).toContain('AR-02');
    expect((await prisma.inquiry.findUniqueOrThrow({ where: { id: lysgaard.id } })).status).toBe('SENDT');

    const aalund = await inquiryOf('k-aalund', '2026-09-30', 'inst-al');
    expect(aalund.status).toBe('AFVIST');
    expect(aalund.rejectionReason).toBe('FORKERT_DATO');
  });

  it('uidentificerede svar matches manuelt (AR-01)', async () => {
    const queue = await call('GET', '/svar/uidentificerede', { user: 'u-mlund' });
    expect(queue.json.rows).toHaveLength(1);
    const row = queue.json.rows[0];
    const lysgaard = await inquiryOf('k-lysgaard', '2026-09-30', 'inst-nykredit');
    expect(row.candidates.map((c: { id: string }) => c.id)).toContain(lysgaard.id);
    const r = await call('POST', `/svar/${row.id}/match`, { user: 'u-mlund', body: { inquiryId: lysgaard.id } });
    expect(r.status).toBe(200);
    expect((await prisma.inquiry.findUniqueOrThrow({ where: { id: lysgaard.id } })).status).toBe('SVAR_MODTAGET');
  });

  it('afstemning: lav AI-sikkerhed blokerer, og afvigelserne klassificeres som i figur 9', async () => {
    const inquiry = await inquiryOf('k-nordlys', '2026-09-30', 'inst-danske');
    const response = await prisma.response.findFirstOrThrow({ where: { inquiryId: inquiry.id, senderVerified: true } });
    const blocked = await call('POST', `/svar/${response.id}/godkend`, { user: 'u-mlund', body: {} });
    expect(blocked.status).toBe(409);
    expect(blocked.json.error.reasons.join(' ')).toContain('AR-11');
    const low = await prisma.responseLine.findFirstOrThrow({ where: { responseId: response.id, aiConfidence: { lt: 0.95 } } });
    expect((await call('POST', `/svarlinjer/${low.id}/kontroller`, { user: 'u-mlund' })).status).toBe(200);
    const ok = await call('POST', `/svar/${response.id}/godkend`, { user: 'u-mlund', body: {} });
    expect(ok.json).toMatchObject({ matched: 3, lines: 6, deviations: 3, open: 3 });
    const devs = await prisma.deviation.findMany({ where: { inquiryId: inquiry.id } });
    expect(devs.map((d) => `${d.type}:${d.severity}`).sort()).toEqual(['KUN_I_BOGFOERING:VAESENTLIG', 'KUN_I_SVAR:KRITISK', 'SALDODIFFERENCE:VAESENTLIG']);
    expect(devs.find((d) => d.type === 'SALDODIFFERENCE')!.amountOre).toBe(-2000000);

    // Kernemedarbejderen kan ikke lukke en kritisk afvigelse – den går til revisor.
    const critical = devs.find((d) => d.severity === 'KRITISK')!;
    const km = await call('POST', `/afvigelser/${critical.id}/vurdering`, { user: 'u-mlund', body: { decision: 'FORKLARET', justification: 'Kunden siger, at kreditten er ny.' } });
    expect(km.json.status).toBe('UNDER_VURDERING');
    expect((await call('POST', `/afvigelser/${critical.id}/vurdering`, { user: 'u-sdahl', body: { decision: 'FORKLARET', justification: 'Ikke min sag, men forsøger.' } })).status).toBe(404);
    expect((await call('POST', `/forespoergsler/${inquiry.id}/afvigelser/send`, { user: 'u-mlund' })).json.sent).toBe(2);
    for (const d of devs) {
      const r = await call('POST', `/afvigelser/${d.id}/vurdering`, { user: 'u-rholm', body: { decision: 'FEJL_I_REGNSKABET', justification: 'Korrektion foreslået i arbejdspapiret.' } });
      expect(r.json.status).toBe('LUKKET');
    }
    expect((await prisma.inquiry.findUniqueOrThrow({ where: { id: inquiry.id } })).status).toBe('AFSLUTTET');
  });

  it('manuelt underskrevet fuldmagt kræver en anden person (4-øjne, FR-09)', async () => {
    const f = await prisma.fuldmagt.findFirstOrThrow({ where: { customerId: 'k-soendergaard', status: 'UNDERSKREVET' } });
    const self = await call('POST', `/fuldmagter/${f.id}/verificer`, { user: 'u-mlund', body: { approve: true } });
    expect(self.status).toBe(403);
    const other = await call('POST', `/fuldmagter/${f.id}/verificer`, { user: 'u-aali', body: { approve: true } });
    expect(other.json.status).toBe('GYLDIG');
    expect((await inquiryOf('k-soendergaard', '2026-12-31', 'inst-lindholm')).status).toBe('KLAR');
  });

  it('Penneo-underskrift kontrolleres mod tegningsreglen (FR-02)', async () => {
    const f = await prisma.fuldmagt.findFirstOrThrow({ where: { customerId: 'k-bakkehuset', status: 'SENDT_TIL_SIGNERING' } });
    const r = await call('POST', `/fuldmagter/${f.id}/penneo-underskrevet`, { user: 'u-aali' });
    expect(r.json.status).toBe('GYLDIG');
    const old = await prisma.fuldmagt.findUniqueOrThrow({ where: { id: 'fm-hist-bakkehuset' } });
    expect(old.status).toBe('INAKTIV');
    // Underskrivere, der ikke opfylder reglen, afvises, før kunden får noget.
    const draft = await call('POST', '/fuldmagter', { user: 'u-mlund', body: { customerId: 'k-engholm', scope: 'GENEREL' } });
    const wrong = await call('POST', `/fuldmagter/${draft.json.id}/signering`, { user: 'u-mlund', body: { signerUnits: ['4000001602'] } });
    expect(wrong.status).toBe(409);
    expect(wrong.json.error.reasons.join(' ')).toContain('Mangler');
  });

  it('bankregister: kanaladresse kræver godkendelse af en anden (4-øjne)', async () => {
    const r = await call('PATCH', '/bankregister/inst-al', { user: 'u-lfrost', body: { channelAddress: 'ny@al-bank.dk', fee: '250 kr.' } });
    expect(r.json).toEqual({ applied: ['fee'], pending: ['channelAddress'] });
    const change = await prisma.instituteChange.findFirstOrThrow({ where: { instituteId: 'inst-al', status: 'PENDING' } });
    expect((await call('POST', `/bankregister/aendringer/${change.id}`, { user: 'u-lfrost', body: { approve: true } })).status).toBe(403);
    expect((await call('POST', `/bankregister/aendringer/${change.id}`, { user: 'u-mlund', body: { approve: true } })).status).toBe(403);
    const km = await call('PATCH', '/bankregister/inst-al', { user: 'u-mlund', body: { channelAddress: 'andet@al-bank.dk' } });
    expect(km.json.pending).toEqual(['channelAddress']);
    const kmChange = await prisma.instituteChange.findFirstOrThrow({ where: { requestedById: 'u-mlund', status: 'PENDING' } });
    expect((await call('POST', `/bankregister/aendringer/${kmChange.id}`, { user: 'u-lfrost', body: { approve: true } })).status).toBe(200);
    expect((await prisma.institute.findUniqueOrThrow({ where: { id: 'inst-al' } })).channelAddress).toBe('andet@al-bank.dk');
  });

  it('regler ændres kun af procesejeren og kun fremadrettet (6.8)', async () => {
    expect((await call('POST', '/regler/TR-05', { user: 'u-lfrost', body: { params: { forslagDageFoerT: 50, godkendelseDageFoerT: 30 }, activeFrom: '2027-01-01', reason: 'Test' } })).status).toBe(403);
    expect((await call('POST', '/regler/TR-05', { user: 'u-nvang', body: { params: { forslagDageFoerT: 50, godkendelseDageFoerT: 30 }, activeFrom: '2026-01-01', reason: 'Test' } })).status).toBe(400);
    expect((await call('POST', '/regler/TR-05', { user: 'u-nvang', body: { params: { forslagDageFoerT: 'halvtreds' }, activeFrom: '2027-01-01', reason: 'Test' } })).status).toBe(400);
    const ok = await call('POST', '/regler/TR-05', { user: 'u-nvang', body: { params: { forslagDageFoerT: 50, godkendelseDageFoerT: 30 }, activeFrom: '2027-01-01', reason: 'Mere tid til revisor' } });
    expect(ok.json.version).toBe(2);
  });

  it('eskalering ved manglende svar og revisors beslutning (ER-03)', async () => {
    const fjordlys = await inquiryOf('k-fjordlys', '2026-09-30', 'inst-nykredit');
    expect(fjordlys.escalatedAt).toBe(DEMO_DATE);
    expect(await prisma.task.count({ where: { inquiryId: fjordlys.id, type: 'OPG-11', status: 'AABEN', assigneeId: 'u-kbrink' } })).toBe(1);
    const r = await call('POST', `/forespoergsler/${fjordlys.id}/beslutning`, { user: 'u-kbrink', body: { decision: 'ALTERNATIVE', note: 'Kontoudtog og lånedokumenter gennemgået i stedet.' } });
    expect(r.status).toBe(200);
    expect((await call('POST', `/forespoergsler/${fjordlys.id}/alternative`, { user: 'u-kbrink', body: { text: 'Kontoudtog pr. 30.09 indhentet direkte fra netbank under tilsyn; lånedokument og tinglysning afstemt.' } })).status).toBe(200);
    expect((await prisma.inquiry.findUniqueOrThrow({ where: { id: fjordlys.id } })).status).toBe('AFSLUTTET');
  });

  it('konklusion kræver, at alt er afklaret, og låser sagen (P11)', async () => {
    const vestkyst = await caseOf('k-vestkyst', '2026-09-30');
    const early = await call('POST', `/sager/${vestkyst.id}/konkluder`, { user: 'u-kbrink', body: { conclusion: 'For tidligt' } });
    expect(early.status).toBe(409);
    const nordhavn = await caseOf('k-nordhavn', '2026-09-30');
    expect((await call('POST', `/sager/${nordhavn.id}/konkluder`, { user: 'u-rholm', body: { conclusion: 'x' } })).status).toBe(404);
    const detail = await call('GET', `/sager/${nordhavn.id}`, { user: 'u-sdahl' });
    expect(detail.json.conclusion.ready).toBe(true);
    expect(detail.json.conclusion.draft).toContain('Henrik Gammel');
    expect((await call('POST', `/sager/${nordhavn.id}/konkluder`, { user: 'u-sdahl', body: { conclusion: detail.json.conclusion.draft } })).status).toBe(200);
    expect((await prisma.case.findUniqueOrThrow({ where: { id: nordhavn.id } })).status).toBe('LAAST');
    const locked = await call('POST', `/sager/${nordhavn.id}/adhoc`, { user: 'u-sdahl', body: { instituteId: 'inst-al', statementDate: '2026-09-30', reason: 'Efterfølgende fund' } });
    expect(locked.status).toBe(409);
    expect(locked.json.error.recovery).toContain('Genåbn');
  });

  it('agenten kan foreslå en bankliste-linje, men ikke godkende (10.5)', async () => {
    const solbakken = await caseOf('k-solbakken', '2026-12-31');
    const line = await prisma.bankListLine.findFirstOrThrow({ where: { caseId: solbakken.id, instituteId: 'inst-danske' } });
    expect(JSON.parse(line.sources)).toEqual(['AGENT']);
    expect(line.included).toBe(false);
    expect((await call('POST', `/sager/${solbakken.id}/bankliste/godkend`, { user: 'u-agent', body: {} })).status).toBe(403);
  });

  it('hændelsesloggen kan eksporteres som CSV og OCEL 2.0', async () => {
    const csv = await call('GET', '/rapporter/haendelseslog.csv', { user: 'u-nvang' });
    expect(String(csv.json).split('\n')[0]).toContain('tidspunkt;objekttype');
    const ocel = await call('GET', '/rapporter/ocel', { user: 'u-nvang' });
    expect(ocel.json.objectTypes.map((t: { name: string }) => t.name)).toEqual(expect.arrayContaining(['Sag', 'Forespørgsel', 'Fuldmagt', 'Afvigelse', 'Institut']));
    expect(ocel.json.events.length).toBeGreaterThan(400);
    expect((await call('GET', '/rapporter/ocel', { user: 'u-mlund' })).status).toBe(200);
    expect((await call('GET', '/rapporter/ocel', { user: 'u-jbach' })).status).toBe(403);
  });
});
