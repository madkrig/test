import { z } from 'zod';
import { CHANNELS, LINE_CATEGORIES, REJECTION_REASONS, SEVERITIES } from '@/domain/ef';
import * as s from '@/services';
import type { RouteDef } from './handler';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Dato skal være ÅÅÅÅ-MM-DD');
const id = z.string().min(1);
const reason = z.string().trim().min(1, 'Angiv en begrundelse');
const lineInput = z.object({
  category: z.enum(LINE_CATEGORIES),
  accountRef: z.string().nullable(),
  description: z.string().min(1),
  currency: z.string().length(3).default('DKK'),
  amountOre: z.number().int().nullable(),
  securityDescription: z.string().nullable().optional(),
});
const institutePatch = z.object({
  name: z.string().min(1).optional(),
  channel: z.enum(CHANNELS).optional(),
  channelAddress: z.string().min(1).optional(),
  senderDomains: z.array(z.string().min(3)).optional(),
  authRequirement: z.enum(['GENEREL', 'BANKSPECIFIK']).optional(),
  authMaxAgeMonths: z.number().int().positive().nullable().optional(),
  responseWorkdays: z.number().int().min(1).max(90).optional(),
  seasonDeadline: z.string().regex(/^\d{2}-\d{2}$/).nullable().optional(),
  earliestSendOffset: z.number().int().min(-60).max(30).optional(),
  latestSendOffset: z.number().int().min(-60).max(30).nullable().optional(),
  fee: z.string().nullable().optional(),
  bulkFileRule: z.string().nullable().optional(),
  source: z.string().optional(),
});

/** API-kontrakten for EF-service. Hver rute kalder én service; GET /api viser listen. */
export const ROUTES: RouteDef[] = [
  { method: 'GET', path: '/', summary: 'Kontrakten: alle ruter', run: async () => ({ routes: ROUTES.map((r) => ({ method: r.method, path: `/api${r.path === '/' ? '' : r.path}`, summary: r.summary })) }) },
  { method: 'GET', path: '/mig', summary: 'Aktuel bruger, systemdato og rettigheder', run: ({ db, actor }) => s.shellInfo(db, actor) },
  { method: 'GET', path: '/brugere', summary: 'Brugere til rollevælgeren', run: async ({ db }) => ({ data: await db.user.findMany({ orderBy: { id: 'asc' } }) }) },

  // S01 Arbejdskø og afsendelse (P06–P08)
  { method: 'GET', path: '/koe', summary: 'Arbejdskø med nøgletal (S01)', run: ({ db, actor, query }) => s.workQueue(db, actor, Object.fromEntries(query) as s.QueueFilter) },
  { method: 'POST', path: '/afsendelser/batch', summary: 'Send en batch til ét institut og én kanal (kræver Idempotency-Key)', schema: z.object({ inquiryIds: z.array(id).min(1) }), run: ({ db, actor, body, idempotencyKey }) => s.sendBatch(db, actor, { inquiryIds: body.inquiryIds, idempotencyKey }) },
  { method: 'POST', path: '/koe/opgaver', summary: 'Bulk: tildel til mig eller udskyd', schema: z.object({ inquiryIds: z.array(id).min(1), action: z.enum(['TILDEL', 'UDSKYD']), until: date.optional() }), run: ({ db, actor, body }) => s.bulkTasks(db, actor, body) },
  { method: 'POST', path: '/forespoergsler/:id/rykker', summary: 'Send 1. eller 2. rykker (ER-02)', run: ({ db, actor, params }) => s.sendReminder(db, actor, params.id!) },
  { method: 'POST', path: '/forespoergsler/:id/afvisning', summary: 'Registrér afvisning fra instituttet', schema: z.object({ reason: z.enum(REJECTION_REASONS), note: z.string().optional() }), run: ({ db, actor, params, body }) => s.registerRejection(db, actor, params.id!, body) },
  { method: 'POST', path: '/forespoergsler/:id/genfremsend', summary: 'Ret og genfremsend en afvist forespørgsel (kræver Idempotency-Key)', schema: z.object({ note: reason, statementDate: date.optional() }), run: ({ db, actor, params, body, idempotencyKey }) => s.correctAndResend(db, actor, params.id!, { ...body, idempotencyKey }) },
  { method: 'POST', path: '/forespoergsler/:id/annuller', summary: 'Annullér med begrundelse', schema: z.object({ reason }), run: ({ db, actor, params, body }) => s.cancelInquiry(db, actor, params.id!, body.reason) },
  { method: 'POST', path: '/forespoergsler/:id/beslutning', summary: 'Revisors beslutning ved manglende svar (ER-03)', schema: z.object({ decision: z.enum(['KUNDE_KONTAKTER', 'NY_FRIST', 'ALTERNATIVE']), newDeadline: date.optional(), note: z.string().optional() }), run: ({ db, actor, params, body }) => s.decideMissingResponse(db, actor, params.id!, body) },
  { method: 'POST', path: '/forespoergsler/:id/alternative', summary: 'Dokumentér alternative handlinger (OPG-11)', schema: z.object({ text: z.string() }), run: ({ db, actor, params, body }) => s.documentAlternatives(db, actor, params.id!, body) },
  { method: 'POST', path: '/forespoergsler/:id/alternative/godkend', summary: 'Godkend alternative handlinger', run: ({ db, actor, params }) => s.approveAlternatives(db, actor, params.id!) },
  { method: 'POST', path: '/forespoergsler/:id/adhoc/godkend', summary: 'Godkend ad hoc-forespørgsel (SOP-EF-09)', run: ({ db, actor, params }) => s.approveAdhoc(db, actor, params.id!) },
  { method: 'POST', path: '/forespoergsler/:id/afvigelser/send', summary: 'Send afvigelser til revisor', run: ({ db, actor, params }) => s.sendDeviationsToAuditor(db, actor, params.id!) },
  { method: 'POST', path: '/forespoergsler/:id/simuler-svar', summary: 'Demo: pengeinstituttet svarer', schema: z.object({ variant: z.enum(Object.keys(s.REPLY_VARIANTS) as [s.ReplyVariant]).default('NORMAL') }), run: ({ db, params, body }) => s.simulateBankReply(db, params.id!, body.variant) },

  // S02–S04 Sager og bankliste (P01–P03, P11)
  { method: 'GET', path: '/sager', summary: 'Sager med pakkesporing (S02)', run: ({ db, actor, query }) => s.caseList(db, actor, { scope: (query.get('scope') as 'MINE' | 'ALLE') ?? undefined, balanceDate: query.get('balanceDate') ?? undefined, status: query.get('status') ?? undefined, mineOnly: query.get('mineOnly') === '1' }) },
  { method: 'GET', path: '/sager/:id', summary: 'Sagsvisning (S03)', run: ({ db, actor, params }) => s.caseDetail(db, actor, params.id!) },
  { method: 'POST', path: '/sager/:id/bankliste', summary: 'Tilføj institut til banklisten (agent: forslag)', schema: z.object({ instituteId: id, note: z.string().optional() }), run: ({ db, actor, params, body }) => s.addBankListLine(db, actor, params.id!, body) },
  { method: 'PATCH', path: '/banklistelinjer/:id', summary: 'Medtag eller fravælg en linje med begrundelse (VR-08)', schema: z.object({ included: z.boolean(), reason: z.string().optional(), customerConfirmed: z.boolean().optional() }), run: ({ db, actor, params, body }) => s.setBankListLine(db, actor, params.id!, body) },
  { method: 'POST', path: '/sager/:id/bankliste/godkend', summary: 'Godkend banklisten (VR-03)', schema: z.object({ acknowledgeWarnings: z.boolean().optional() }), run: ({ db, actor, params, body }) => s.approveBankList(db, actor, params.id!, body) },
  { method: 'POST', path: '/sager/:id/bankliste/kunde', summary: 'Registrér kundens bekræftelse af institutter (OPG-03)', schema: z.object({ instituteIds: z.array(id).min(1), note: z.string().optional() }), run: ({ db, actor, params, body }) => s.customerConfirmBankList(db, actor, params.id!, body) },
  { method: 'POST', path: '/sager/:id/delegering', summary: 'Delegér godkendelse af banklisten', schema: z.object({ delegateId: z.string().nullable(), until: date.nullable().optional() }), run: ({ db, actor, params, body }) => s.delegateApproval(db, actor, params.id!, body) },
  { method: 'POST', path: '/sager/:id/adhoc', summary: 'Anmod om ad hoc-forespørgsel (SOP-EF-09)', schema: z.object({ instituteId: id, statementDate: date, reason }), run: ({ db, actor, params, body }) => s.requestAdhoc(db, actor, params.id!, body) },
  { method: 'POST', path: '/sager/:id/primo', summary: 'Tag stilling til primo-forespørgsel (TR-09)', schema: z.object({ accept: z.boolean(), reason: z.string().optional() }), run: ({ db, actor, params, body }) => s.decidePrimo(db, actor, params.id!, body) },
  { method: 'POST', path: '/sager/:id/konkluder', summary: 'Konkludér og lås sagen (OPG-14, P11)', schema: z.object({ conclusion: z.string() }), run: ({ db, actor, params, body }) => s.concludeCase(db, actor, params.id!, body) },
  { method: 'POST', path: '/sager/:id/genaabn', summary: 'Genåbn en låst sag med begrundelse', schema: z.object({ reason }), run: ({ db, actor, params, body }) => s.reopenCase(db, actor, params.id!, body.reason) },
  { method: 'POST', path: '/opgaver/:id/tilvalg', summary: 'Tilvælg engagementsforespørgsler for review/opstilling (TR-01)', run: ({ db, actor, params }) => s.optInEngagement(db, actor, params.id!) },

  // S05 Fuldmagter (P04–P05)
  { method: 'GET', path: '/fuldmagter', summary: 'Fuldmagtsstatus pr. kunde (S05)', run: ({ db, actor }) => s.fuldmagtOverview(db, actor) },
  { method: 'POST', path: '/fuldmagter', summary: 'Dan udkast fra skabelon (bilag A) med foreslåede underskrivere', schema: z.object({ customerId: id, scope: z.enum(['GENEREL', 'BANKSPECIFIK']).default('GENEREL'), instituteId: z.string().nullable().optional() }), run: ({ db, actor, body }) => s.prepareFuldmagt(db, actor, body) },
  { method: 'POST', path: '/fuldmagter/bulk', summary: 'Bulk: dan og send fuldmagter til signering', schema: z.object({ customerIds: z.array(id).min(1) }), run: ({ db, actor, body }) => s.bulkSendForSigning(db, actor, body.customerIds) },
  { method: 'POST', path: '/fuldmagter/manuel', summary: 'Upload manuelt underskrevet fuldmagt (FR-09)', schema: z.object({ customerId: id, signedDate: date, signerUnits: z.array(id).min(1), scope: z.enum(['GENEREL', 'BANKSPECIFIK']).default('GENEREL'), instituteId: z.string().nullable().optional(), fileName: z.string().min(1) }), run: ({ db, actor, body }) => s.uploadManualFuldmagt(db, actor, body) },
  { method: 'GET', path: '/fuldmagter/:id/dokument', summary: 'Fuldmagtens tekst (bilag A)', run: async ({ db, params }) => ({ raw: await s.fuldmagtDocument(db, params.id!), contentType: 'text/plain; charset=utf-8' }) },
  { method: 'POST', path: '/fuldmagter/:id/signering', summary: 'Send til signering i Penneo', schema: z.object({ signerUnits: z.array(id).optional() }), run: ({ db, actor, params, body }) => s.sendForSigning(db, actor, params.id!, body.signerUnits) },
  { method: 'POST', path: '/fuldmagter/:id/paamind', summary: 'Påmind underskrivere via Penneo (ER-05)', run: ({ db, actor, params }) => s.remindSigners(db, actor, params.id!) },
  { method: 'POST', path: '/fuldmagter/:id/verificer', summary: '4-øjne: godkend eller afvis manuelt underskrevet fuldmagt', schema: z.object({ approve: z.boolean(), note: z.string().optional() }), run: ({ db, actor, params, body }) => s.verifyManualFuldmagt(db, actor, params.id!, body) },
  { method: 'POST', path: '/fuldmagter/:id/tilbagekald', summary: 'Tilbagekald fuldmagt (FR-07)', schema: z.object({ reason }), run: ({ db, actor, params, body }) => s.revokeFuldmagt(db, actor, params.id!, body.reason) },
  { method: 'POST', path: '/fuldmagter/:id/penneo-underskrevet', summary: 'Demo/webhook: Penneo melder underskrevet', run: async ({ db, params }) => { if (!s.demoEnabled()) throw new s.DomainError('FORBIDDEN', 'Kun i demo.'); return s.penneoSigned(db, params.id!); } },

  // S06–S07 Svar, afstemning og afvigelser (P09)
  { method: 'POST', path: '/postkasse', summary: 'Indgående svar fra funktionspostkassen/platformen (Graph-webhook)', schema: z.object({ channel: z.enum(['EMAIL', 'PLATFORM']), from: z.string().email(), subject: z.string(), body: z.string().default(''), attachmentName: z.string().default('svar.pdf'), cvr: z.string().nullable().default(null), statementDate: date.nullable().default(null), extracted: z.object({ lines: z.array(lineInput.extend({ lowConfidence: z.boolean().optional() })), signingRights: z.array(z.string()).default([]), missingCategories: z.array(z.string()).default([]) }) }), run: async ({ db, actor, body }) => { s.assertCan(actor, 'RUN_JOBS'); return s.ingestInbound(db, body); } },
  { method: 'GET', path: '/svar/uidentificerede', summary: 'Svar uden match (AR-01)', run: ({ db, actor }) => s.unmatchedResponses(db, actor) },
  { method: 'GET', path: '/svar/:id', summary: 'Svar og afstemning (S06)', run: ({ db, actor, params }) => s.responseDetail(db, actor, params.id!) },
  { method: 'POST', path: '/svar/:id/match', summary: 'Match et uidentificeret svar manuelt', schema: z.object({ inquiryId: id }), run: ({ db, actor, params, body }) => s.matchResponse(db, actor, params.id!, body.inquiryId) },
  { method: 'POST', path: '/svar/:id/linjer', summary: 'Tilføj linje manuelt', schema: lineInput, run: ({ db, actor, params, body }) => s.addResponseLine(db, actor, params.id!, body) },
  { method: 'POST', path: '/svar/:id/godkend', summary: 'Godkend udtræk og afstem (AR-05–AR-09)', schema: z.object({ acknowledgeWarnings: z.boolean().optional() }), run: ({ db, actor, params, body }) => s.approveExtraction(db, actor, params.id!, body) },
  { method: 'PATCH', path: '/svarlinjer/:id', summary: 'Ret udtræk', schema: lineInput.partial(), run: ({ db, actor, params, body }) => s.updateResponseLine(db, actor, params.id!, body) },
  { method: 'POST', path: '/svarlinjer/:id/kontroller', summary: 'Markér linje som kontrolleret (AR-11)', run: ({ db, actor, params }) => s.verifyResponseLine(db, actor, params.id!) },
  { method: 'DELETE', path: '/svarlinjer/:id', summary: 'Slet linje', run: ({ db, actor, params }) => s.deleteResponseLine(db, actor, params.id!) },
  { method: 'GET', path: '/afvigelser/:id', summary: 'Afvigelse (S07)', run: ({ db, actor, params }) => s.deviationDetail(db, actor, params.id!) },
  { method: 'POST', path: '/afvigelser/:id/vurdering', summary: 'Vurdér eller beslut en afvigelse', schema: z.object({ decision: z.enum(['FORKLARET', 'FEJL_I_REGNSKABET', 'YDERLIGERE_HANDLING']), justification: z.string(), severity: z.enum(SEVERITIES).optional() }), run: ({ db, actor, params, body }) => s.assessDeviation(db, actor, params.id!, body) },
  { method: 'POST', path: '/afvigelser/:id/kunde', summary: 'Bed kunden om en forklaring', schema: z.object({ question: z.string().min(5) }), run: ({ db, actor, params, body }) => s.requestCustomerExplanation(db, actor, params.id!, body) },

  // S09 Bankregister og S10 Regler
  { method: 'GET', path: '/bankregister', summary: 'Bankregister (S09)', run: ({ db, actor }) => s.registerOverview(db, actor) },
  { method: 'POST', path: '/bankregister', summary: 'Opret institut', schema: institutePatch.extend({ name: z.string().min(1), cvr: z.string().min(4), channel: z.enum(CHANNELS), channelAddress: z.string().min(1), responseWorkdays: z.number().int().min(1) }), run: ({ db, actor, body }) => s.createInstitute(db, actor, body) },
  { method: 'PATCH', path: '/bankregister/:id', summary: 'Ret institut – kanal og adresse kræver 4-øjne', schema: institutePatch, run: ({ db, actor, params, body }) => s.updateInstitute(db, actor, params.id!, body) },
  { method: 'POST', path: '/bankregister/:id/verificer', summary: 'Verificér institut (SOP-EF-10)', run: ({ db, actor, params }) => s.verifyInstitute(db, actor, params.id!) },
  { method: 'POST', path: '/bankregister/:id/fusion', summary: 'Fusionér institut ind i et andet', schema: z.object({ intoId: id }), run: ({ db, actor, params, body }) => s.mergeInstitute(db, actor, params.id!, body.intoId) },
  { method: 'POST', path: '/bankregister/aendringer/:id', summary: 'Godkend eller afvis ændring (4-øjne)', schema: z.object({ approve: z.boolean() }), run: ({ db, actor, params, body }) => s.decideInstituteChange(db, actor, params.id!, body.approve) },
  { method: 'GET', path: '/regler', summary: 'Regler med versioner (S10)', run: ({ db, actor }) => s.rulesOverview(db, actor) },
  { method: 'POST', path: '/regler/:ruleId', summary: 'Ny version af en regel (kun procesejer)', schema: z.object({ params: z.record(z.string(), z.unknown()), activeFrom: date, reason }), run: ({ db, actor, params, body }) => s.changeRule(db, actor, params.ruleId!, body) },

  // S08/S11 Kapacitet, KPI og eksport
  { method: 'GET', path: '/rapporter/kpi', summary: 'KPI pr. periode, afdeling og institut (S11)', run: ({ db, actor, query }) => s.kpiReport(db, actor, { from: query.get('from') ?? undefined, to: query.get('to') ?? undefined, department: query.get('department') ?? undefined }) },
  { method: 'GET', path: '/rapporter/kapacitet', summary: 'Årshjul og kapacitet pr. uge og institut (S08)', run: ({ db, actor, query }) => s.capacityForecast(db, actor, { from: query.get('from') ?? undefined, weeks: query.get('weeks') ? Number(query.get('weeks')) : undefined }) },
  { method: 'GET', path: '/rapporter/haendelseslog.csv', summary: 'Hændelsesloggen som CSV', run: async ({ db, actor }) => ({ raw: await s.eventLogCsv(db, actor), contentType: 'text/csv; charset=utf-8', fileName: 'ef-haendelseslog.csv' }) },
  { method: 'GET', path: '/rapporter/ocel', summary: 'Hændelsesloggen som OCEL 2.0 (procesanalyse)', run: async ({ db, actor }) => ({ raw: JSON.stringify(await s.exportOcel(db, actor), null, 2), contentType: 'application/json', fileName: 'ef-ocel.json' }) },

  // Drift og demo
  { method: 'POST', path: '/job/daglig', summary: 'Kør den daglige kørsel nu', run: ({ db, actor }) => s.runDailyJobAs(db, actor) },
  { method: 'POST', path: '/demo/dato', summary: 'Demo: flyt systemdatoen frem og kør dagene', schema: z.object({ date }), transactional: false, run: ({ db, actor, body }) => s.advanceDemoDate(db, actor, body.date) },
  { method: 'GET', path: '/notifikationer', summary: 'Mine notifikationer', run: async ({ db, actor }) => ({ data: await s.notificationsFor(db, actor), unread: await db.notification.count({ where: { recipientId: actor.id, readAt: null } }) }) },
  { method: 'POST', path: '/notifikationer/laest', summary: 'Markér notifikationer som læst', run: async ({ db, actor }) => { await db.notification.updateMany({ where: { recipientId: actor.id, readAt: null }, data: { readAt: await s.now(db) } }); return { unread: 0 }; } },
  { method: 'GET', path: '/mine-opgaver', summary: 'Mine åbne opgaver (K3)', run: async ({ db, actor }) => ({ data: await s.tasksFor(db, actor) }) },
];
