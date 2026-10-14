import {
  addWorkdays, canCloseDeviation, CATEGORY_LABELS, formatDanish, reconcile, signingRightsDeviation, toDkkOre,
  type IsoDate, type LineCategory, type RejectionReason, type Severity,
} from '@/domain/ef';
import { archive, logCall } from './adapters';
import { managementAt } from './auth-check';
import { now, today } from './clock';
import { assertCan, assertNotLocked, loadCaseFor, paramsAt, type Actor } from './context';
import type { Db } from './db';
import { DomainError } from './errors';
import { appendEvent } from './event-log';
import { newId } from './ids';
import { rejectInquiry, transitionInquiry } from './inquiries';
import { refreshCase } from './readiness';
import { closeTasks, ensureTask, notify } from './work';

/**
 * Svarmodtagelse og afstemning (P09, SOP-EF-06, AR-01–AR-11) – erstatter
 * svar i personlige indbakker og afstemning i Excel. Svar læses fra
 * funktionspostkassen (Graph) eller platformen, matches på reference,
 * afsenderen kontrolleres, og udtrækket afstemmes mod bogføringen (SAF-T).
 */

export interface ExtractedLine {
  category: LineCategory;
  accountRef: string | null;
  description: string;
  currency: string;
  amountOre: number | null;
  securityDescription?: string | null;
  /** Demo: linjen er svær at læse, så AI-udtrækket får lav sikkerhed (AR-11). */
  lowConfidence?: boolean;
}

export interface InboundMessage {
  channel: 'EMAIL' | 'PLATFORM';
  from: string;
  subject: string;
  body: string;
  attachmentName: string;
  cvr: string | null;
  statementDate: IsoDate | null;
  extracted: { lines: ExtractedLine[]; signingRights: string[]; missingCategories: string[] };
  rejection?: { reason: RejectionReason; note: string };
}

const REFERENCE = /EF-\d{4}-\d{6}/;
const domainOf = (email: string) => email.split('@')[1]?.toLowerCase() ?? '';

async function ratesAt(db: Db, date: IsoDate): Promise<Record<string, number>> {
  const rows = await db.srcFxRate.findMany({ where: { date: { lte: date } }, orderBy: { date: 'asc' } });
  const rates: Record<string, number> = {};
  for (const r of rows) rates[r.currency] = r.rate; // seneste kurs på eller før balancedagen
  return rates;
}

/** AR-01: reference → ellers CVR + institut (afsenderdomæne) + dato → ellers "Uidentificerede svar". */
async function findMatch(db: Db, msg: InboundMessage): Promise<{ inquiryId: string; method: string } | null> {
  const ref = (msg.subject.match(REFERENCE) ?? msg.body.match(REFERENCE))?.[0];
  if (ref) {
    const inquiry = await db.inquiry.findUnique({ where: { reference: ref } });
    if (inquiry) return { inquiryId: inquiry.id, method: `reference ${ref}` };
  }
  if (msg.cvr && msg.statementDate) {
    const institutes = (await db.institute.findMany()).filter((i) => (JSON.parse(i.senderDomains) as string[]).includes(domainOf(msg.from)));
    const cases = await db.case.findMany({ where: { cvr: msg.cvr } });
    const candidates = await db.inquiry.findMany({
      where: { caseId: { in: cases.map((c) => c.id) }, instituteId: { in: institutes.map((i) => i.id) }, statementDate: msg.statementDate, status: { in: ['SENDT', 'RYKKET', 'UDEN_SVAR'] } },
    });
    if (candidates.length === 1) return { inquiryId: candidates[0]!.id, method: 'CVR, institut og dato' };
  }
  return null;
}

/** Indgående svar fra funktionspostkassen eller platformen (svar.modtaget). */
export async function ingestInbound(db: Db, msg: InboundMessage) {
  const match = await findMatch(db, msg);
  const id = newId('svar');
  const date = await today(db);
  const ref = `sharepoint://Engagementsforespoergsler/indbakke/${date}/${id}-${msg.attachmentName}`;
  await db.response.create({
    data: {
      id, inquiryId: match?.inquiryId ?? null, receivedAt: await now(db), channel: msg.channel, sender: msg.from, senderVerified: false, subject: msg.subject,
      statementDate: msg.statementDate, documentRef: ref, matchStatus: match ? 'MATCHED' : 'UNMATCHED', content: JSON.stringify(msg),
    },
  });
  await logCall(db, msg.channel === 'EMAIL' ? 'Graph (funktionspostkasse)' : 'Platform', 'svar læst', { responseId: id, from: msg.from, subject: msg.subject, archived: ref });
  await appendEvent(db, { objectType: 'Svar', objectId: id, action: 'svar.modtaget', actorId: 'system', after: { from: msg.from, subject: msg.subject, match: match?.method ?? 'ingen' }, reason: match ? `AR-01: matchet via ${match.method}` : 'AR-01: intet match – lagt i "Uidentificerede svar"' });
  if (!match) {
    const km = (await db.setting.findUnique({ where: { key: 'kerneteam:vagt' } }))?.value ?? null;
    await ensureTask(db, { caseId: null, type: 'OPG-09', title: `Uidentificeret svar fra ${msg.from}`, role: 'KM', assigneeId: km, dueDate: addWorkdays(date, 2), createdByRule: 'AR-01' });
    return { responseId: id, matched: false };
  }
  await processMatched(db, id, 'system');
  return { responseId: id, matched: true };
}

/** AR-02, AR-03 og registrering af udtrækket for et matchet svar. */
async function processMatched(db: Db, responseId: string, actorId: string) {
  const response = await db.response.findUniqueOrThrow({ where: { id: responseId } });
  const msg = JSON.parse(response.content) as InboundMessage;
  const inquiry = await db.inquiry.findUniqueOrThrow({ where: { id: response.inquiryId! } });
  const c = await db.case.findUniqueOrThrow({ where: { id: inquiry.caseId } });
  const inst = await db.institute.findUniqueOrThrow({ where: { id: inquiry.instituteId } });
  const date = await today(db);
  await db.response.update({ where: { id: responseId }, data: { documentRef: await archive(db, { caseId: c.id, kind: 'SVAR', title: `Svar fra ${inst.name} (${inquiry.reference})`, cvr: c.cvr, fileName: `${inquiry.reference}-svar-${msg.attachmentName}` }) } });

  // AR-02: kun direkte fra instituttets registrerede domæne eller kanal – ikke videresendt af kunden (ISA 505.10).
  const verified = msg.channel === 'PLATFORM' || (JSON.parse(inst.senderDomains) as string[]).includes(domainOf(msg.from));
  if (!verified) {
    const reason = `AR-02: afsenderen ${msg.from} er ikke ${inst.name}s registrerede domæne. Svaret accepteres ikke som revisionsbevis.`;
    await db.response.update({ where: { id: responseId }, data: { senderVerified: false, invalidReason: reason } });
    await appendEvent(db, { objectType: 'Svar', objectId: responseId, caseId: c.id, action: 'svar.afsender_afvist', actorId, reason });
    await ensureTask(db, { caseId: c.id, type: 'OPG-09', title: `Svar fra ukendt afsender – kontakt ${inst.name} direkte`, role: 'KM', assigneeId: c.coreUserId, dueDate: addWorkdays(date, 2), createdByRule: 'AR-02', inquiryId: inquiry.id });
    await refreshCase(db, c.id);
    return;
  }
  await db.response.update({ where: { id: responseId }, data: { senderVerified: true } });

  if (msg.rejection) {
    await db.response.update({ where: { id: responseId }, data: { invalidReason: `Afvisning: ${msg.rejection.note}` } });
    await rejectInquiry(db, actorId, inquiry.id, msg.rejection);
    return;
  }
  if (!['SENDT', 'RYKKET', 'UDEN_SVAR'].includes(inquiry.status)) {
    await appendEvent(db, { objectType: 'Svar', objectId: responseId, caseId: c.id, action: 'svar.supplement', actorId, reason: `Forespørgslen har status ${inquiry.status} – svaret er knyttet som supplement.` });
    return;
  }
  await transitionInquiry(db, inquiry.id, 'SVAR_MODTAGET', actorId, {}, `Svar fra ${msg.from}`);
  await closeTasks(db, { type: ['OPG-07', 'OPG-11'], inquiryId: inquiry.id });

  // AR-03: opgørelsesdatoen skal være den forespurgte – ellers en ny forespørgsel.
  if (msg.statementDate !== inquiry.statementDate) {
    const note = `Svaret er opgjort pr. ${formatDanish(msg.statementDate)} – forespurgt pr. ${formatDanish(inquiry.statementDate)} (AR-03)`;
    await db.response.update({ where: { id: responseId }, data: { invalidReason: note } });
    await rejectInquiry(db, actorId, inquiry.id, { reason: 'FORKERT_DATO', note });
    return;
  }

  // AI-udtræk (mock): beløb, konti, valuta og sikkerhed pr. linje. Valuta omregnes (AR-10).
  const rates = await ratesAt(db, inquiry.statementDate);
  let order = 0;
  for (const l of msg.extracted.lines) {
    const dkk = l.amountOre === null ? null : l.currency === 'DKK' ? l.amountOre : rates[l.currency] ? toDkkOre(l.amountOre, l.currency, rates) : null;
    await db.responseLine.create({
      data: {
        id: newId('sl'), responseId, category: l.category, accountRef: l.accountRef, description: l.description, currency: l.currency, amountOre: l.amountOre,
        amountDkkOre: dkk, securityDescription: l.securityDescription ?? null, aiConfidence: l.lowConfidence ? 0.82 : 0.99, sortOrder: order++,
      },
    });
  }
  await appendEvent(db, { objectType: 'Svar', objectId: responseId, caseId: c.id, action: 'svar.udtrukket', actorId: 'system', after: { lines: msg.extracted.lines.length, method: 'AI' } });
  await ensureTask(db, { caseId: c.id, type: 'OPG-09', title: `Registrér og verificér svar fra ${inst.name}`, role: 'KM', assigneeId: c.coreUserId, dueDate: addWorkdays(date, 3), createdByRule: 'svar.modtaget', inquiryId: inquiry.id });
  await refreshCase(db, c.id);
}

/** Manuelt match fra køen "Uidentificerede svar" (SOP-EF-06: inden 2 hverdage). */
export async function matchResponse(db: Db, actor: Actor, responseId: string, inquiryId: string) {
  assertCan(actor, 'REGISTER_RESPONSE');
  const response = await db.response.findUnique({ where: { id: responseId } });
  if (!response) throw new DomainError('NOT_FOUND', 'Svaret findes ikke.');
  if (response.matchStatus === 'MATCHED') throw new DomainError('INVALID_STATE', 'Svaret er allerede matchet.');
  const inquiry = await db.inquiry.findUnique({ where: { id: inquiryId } });
  if (!inquiry) throw new DomainError('NOT_FOUND', 'Forespørgslen findes ikke.');
  await loadCaseFor(db, actor, inquiry.caseId);
  await db.response.update({ where: { id: responseId }, data: { inquiryId, matchStatus: 'MATCHED' } });
  await appendEvent(db, { objectType: 'Svar', objectId: responseId, caseId: inquiry.caseId, action: 'svar.matchet_manuelt', actorId: actor.id, after: { reference: inquiry.reference } });
  const open = await db.task.findMany({ where: { type: 'OPG-09', caseId: null, status: 'AABEN', title: { contains: response.sender } } });
  for (const t of open) await db.task.update({ where: { id: t.id }, data: { status: 'LUKKET', closedAt: await now(db) } });
  await processMatched(db, responseId, actor.id);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Udtræk (S06): ret, kontrollér og godkend
// ---------------------------------------------------------------------------

async function editableResponse(db: Db, actor: Actor, responseId: string) {
  assertCan(actor, 'REGISTER_RESPONSE');
  const response = await db.response.findUnique({ where: { id: responseId } });
  if (!response?.inquiryId) throw new DomainError('NOT_FOUND', 'Svaret findes ikke eller er ikke matchet.');
  const c = await loadCaseFor(db, actor, (await db.inquiry.findUniqueOrThrow({ where: { id: response.inquiryId } })).caseId);
  assertNotLocked(c);
  if (response.extractionApprovedAt) throw new DomainError('INVALID_STATE', 'Udtrækket er godkendt og kan ikke ændres.', { recovery: 'Opret en afvigelse eller bed revisor genåbne.' });
  return { response, c };
}

export async function updateResponseLine(
  db: Db,
  actor: Actor,
  lineId: string,
  patch: { category?: LineCategory; accountRef?: string | null; description?: string; currency?: string; amountOre?: number | null; securityDescription?: string | null },
) {
  const line = await db.responseLine.findUnique({ where: { id: lineId } });
  if (!line) throw new DomainError('NOT_FOUND', 'Linjen findes ikke.');
  const { response, c } = await editableResponse(db, actor, line.responseId);
  const next = { ...line, ...patch };
  const rates = await ratesAt(db, response.statementDate ?? c.balanceDate);
  if (next.currency !== 'DKK' && next.amountOre !== null && !rates[next.currency]) throw new DomainError('VALIDATION', `Mangler Nationalbankens kurs for ${next.currency} (AR-10).`);
  const dkk = next.amountOre === null ? null : toDkkOre(next.amountOre, next.currency, rates);
  await db.responseLine.update({ where: { id: lineId }, data: { ...patch, amountDkkOre: dkk, verifiedById: actor.id } });
  await appendEvent(db, { objectType: 'Svarlinje', objectId: lineId, caseId: c.id, action: 'svarlinje.rettet', actorId: actor.id, before: { category: line.category, accountRef: line.accountRef, amountOre: line.amountOre, currency: line.currency }, after: patch });
  return { ok: true };
}

export async function verifyResponseLine(db: Db, actor: Actor, lineId: string) {
  const line = await db.responseLine.findUnique({ where: { id: lineId } });
  if (!line) throw new DomainError('NOT_FOUND', 'Linjen findes ikke.');
  const { c } = await editableResponse(db, actor, line.responseId);
  await db.responseLine.update({ where: { id: lineId }, data: { verifiedById: actor.id } });
  await appendEvent(db, { objectType: 'Svarlinje', objectId: lineId, caseId: c.id, action: 'svarlinje.kontrolleret', actorId: actor.id, reason: 'Kontrolleret mod svarets PDF (AR-11)' });
  return { ok: true };
}

export async function addResponseLine(db: Db, actor: Actor, responseId: string, input: ExtractedLine) {
  const { response, c } = await editableResponse(db, actor, responseId);
  const rates = await ratesAt(db, response.statementDate ?? c.balanceDate);
  const dkk = input.amountOre === null ? null : toDkkOre(input.amountOre, input.currency, rates);
  const count = await db.responseLine.count({ where: { responseId } });
  const id = newId('sl');
  await db.responseLine.create({ data: { id, responseId, category: input.category, accountRef: input.accountRef, description: input.description, currency: input.currency, amountOre: input.amountOre, amountDkkOre: dkk, securityDescription: input.securityDescription ?? null, aiConfidence: null, verifiedById: actor.id, sortOrder: count } });
  await appendEvent(db, { objectType: 'Svarlinje', objectId: id, caseId: c.id, action: 'svarlinje.tilfoejet', actorId: actor.id, after: input });
  return { id };
}

export async function deleteResponseLine(db: Db, actor: Actor, lineId: string) {
  const line = await db.responseLine.findUnique({ where: { id: lineId } });
  if (!line) throw new DomainError('NOT_FOUND', 'Linjen findes ikke.');
  const { c } = await editableResponse(db, actor, line.responseId);
  await db.responseLine.delete({ where: { id: lineId } });
  await appendEvent(db, { objectType: 'Svarlinje', objectId: lineId, caseId: c.id, action: 'svarlinje.slettet', actorId: actor.id, before: { description: line.description, amountOre: line.amountOre } });
  return { ok: true };
}

/** Advarsler og blokeringer, før udtrækket kan godkendes (AR-02–AR-04, AR-10, AR-11). */
export async function extractionChecks(db: Db, responseId: string) {
  const response = await db.response.findUniqueOrThrow({ where: { id: responseId } });
  const lines = await db.responseLine.findMany({ where: { responseId } });
  const inquiry = response.inquiryId ? await db.inquiry.findUnique({ where: { id: response.inquiryId } }) : null;
  const c = inquiry ? await db.case.findUnique({ where: { id: inquiry.caseId } }) : null;
  const params = await paramsAt(db, c?.rulesAsOf ?? (await today(db)));
  const msg = JSON.parse(response.content) as InboundMessage;
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (!response.senderVerified) blockers.push(response.invalidReason ?? 'AR-02: afsenderen er ikke verificeret.');
  else if (response.invalidReason) blockers.push(response.invalidReason);
  const low = lines.filter((l) => l.aiConfidence !== null && l.aiConfidence < params.aiThreshold && !l.verifiedById);
  for (const l of low) blockers.push(`AR-11: "${l.description}" har AI-sikkerhed ${Math.round(l.aiConfidence! * 100)} % – kontrollér linjen mod PDF'en.`);
  for (const l of lines.filter((x) => x.amountOre !== null && x.amountDkkOre === null)) blockers.push(`AR-10: mangler kurs for ${l.currency} på balancedagen.`);
  for (const cat of msg.extracted?.missingCategories ?? []) warnings.push(`AR-04: kategorien "${CATEGORY_LABELS[cat as LineCategory] ?? cat}" er hverken besvaret eller angivet som "ingen".`);
  const confidences = lines.filter((l) => l.aiConfidence !== null).map((l) => l.aiConfidence!);
  return { blockers, warnings, aiConfidence: confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : null, threshold: params.aiThreshold };
}

/** "Godkend udtræk": afstemning mod bogføringen og dannelse af afvigelser (AR-05–AR-09). */
export async function approveExtraction(db: Db, actor: Actor, responseId: string, input: { acknowledgeWarnings?: boolean } = {}) {
  const { response, c } = await editableResponse(db, actor, responseId);
  const inquiry = await db.inquiry.findUniqueOrThrow({ where: { id: response.inquiryId! } });
  if (inquiry.status !== 'SVAR_MODTAGET') throw new DomainError('INVALID_STATE', 'Forespørgslen afventer ikke registrering af et svar.');
  const checks = await extractionChecks(db, responseId);
  if (checks.blockers.length) throw new DomainError('INVALID_STATE', 'Udtrækket kan ikke godkendes endnu.', { reasons: checks.blockers, recovery: 'Kontrollér eller ret de markerede linjer.' });
  if (checks.warnings.length && !input.acknowledgeWarnings) throw new DomainError('INVALID_STATE', 'Svaret er muligvis ufuldstændigt.', { reasons: checks.warnings, recovery: 'Bed instituttet om et supplerende svar – eller godkend med advarslen.' });

  const params = await paramsAt(db, c.rulesAsOf);
  const lines = await db.responseLine.findMany({ where: { responseId }, orderBy: { sortOrder: 'asc' } });
  const booked = await db.srcLedgerAccount.findMany({ where: { customerId: c.customerId, balanceDate: inquiry.statementDate, instituteId: inquiry.instituteId } });
  const materiality = await db.srcMateriality.findUnique({ where: { engagementId: c.engagementId } });
  const result = reconcile(
    lines.map((l) => ({ id: l.id, category: l.category as LineCategory, accountRef: l.accountRef, description: l.description, amountDkkOre: l.amountDkkOre })),
    booked.map((b) => ({ id: b.id, accountRef: b.accountRef, name: b.name, balanceOre: b.balanceOre })),
    { toleranceOre: params.toleranceOre, trivialOre: materiality?.trivialThreshold ?? 0 },
  );
  const msg = JSON.parse(response.content) as InboundMessage;
  const cvrSigners = (await managementAt(db, c.customerId, inquiry.statementDate)).map((p) => p.name);
  const rights = signingRightsDeviation(msg.extracted?.signingRights ?? [], cvrSigners);
  const at = await now(db);
  const reconIds: string[] = [];
  for (const r of result.recon) {
    const id = newId('afst');
    reconIds.push(id);
    await db.reconLine.create({ data: { id, inquiryId: inquiry.id, responseLineId: r.responseLineId, ledgerAccountId: r.ledgerAccountId, bookedOre: r.bookedOre, differenceOre: r.differenceOre, matchStatus: r.matchStatus } });
  }
  const drafts = [...result.deviations, ...(rights ? [rights] : [])];
  let open = 0;
  for (const d of drafts) {
    const id = newId('afv');
    await db.deviation.create({
      data: {
        id, caseId: c.id, inquiryId: inquiry.id, reconLineId: d.reconIndex !== null ? reconIds[d.reconIndex] ?? null : null, type: d.type, severity: d.severity,
        status: d.autoClosed ? 'LUKKET' : 'AABEN', decision: d.autoClosed ? 'FORKLARET' : null, description: d.description, amountOre: d.amountOre,
        justification: d.autoClosed ? 'Under grænsen for klart ubetydelige beløb – lukket automatisk.' : null, approvedById: d.autoClosed ? 'system' : null, approvedAt: d.autoClosed ? at : null, createdAt: at,
      },
    });
    await appendEvent(db, { objectType: 'Afvigelse', objectId: id, caseId: c.id, action: d.autoClosed ? 'afvigelse.lukket_automatisk' : 'afvigelse.oprettet', actorId: 'system', after: { type: d.type, severity: d.severity, amountOre: d.amountOre }, reason: d.description });
    if (!d.autoClosed) open++;
    if (d.severity === 'KRITISK') {
      const rm = await teamRm(db, c.engagementId);
      for (const r of [c.responsibleId, rm]) await notify(db, { recipientId: r, type: 'KRITISK_AFVIGELSE', message: `Kritisk afvigelse: ${d.description}`, link: `/sager/${c.id}?fane=svar`, channels: ['TEAMS', 'BRUGERFLADE'] });
    }
  }
  await db.response.update({ where: { id: responseId }, data: { extractionApprovedById: actor.id, extractionApprovedAt: at } });
  await appendEvent(db, { objectType: 'Svar', objectId: responseId, caseId: c.id, action: 'svar.udtraek_godkendt', actorId: actor.id, after: { matched: result.recon.filter((r) => r.matchStatus === 'MATCH').length, lines: result.recon.length, deviations: drafts.length, open }, reason: checks.warnings.length ? `Godkendt med advarsler: ${checks.warnings.join(' ')}` : undefined });
  await closeTasks(db, { type: 'OPG-09', inquiryId: inquiry.id });
  if (open === 0) await transitionInquiry(db, inquiry.id, 'AFSLUTTET', actor.id, {}, 'Afstemt uden åbne afvigelser');
  await refreshCase(db, c.id);
  return { matched: result.recon.filter((r) => r.matchStatus === 'MATCH').length, lines: result.recon.length, deviations: drafts.length, open };
}

async function teamRm(db: Db, engagementId: string): Promise<string | null> {
  const team = await db.srcTeamMember.findMany({ where: { engagementId } });
  const users = await db.user.findMany({ where: { id: { in: team.map((t) => t.userId) }, role: 'RM' } });
  return users[0]?.id ?? null;
}

// ---------------------------------------------------------------------------
// Afvigelser (S07): send til revisor, vurdér og beslut
// ---------------------------------------------------------------------------

export async function sendDeviationsToAuditor(db: Db, actor: Actor, inquiryId: string) {
  assertCan(actor, 'REGISTER_RESPONSE');
  const inquiry = await db.inquiry.findUnique({ where: { id: inquiryId } });
  if (!inquiry) throw new DomainError('NOT_FOUND', 'Forespørgslen findes ikke.');
  const c = await loadCaseFor(db, actor, inquiry.caseId);
  assertNotLocked(c);
  const open = await db.deviation.findMany({ where: { inquiryId, status: { not: 'LUKKET' }, sentToAuditorAt: null } });
  if (open.length === 0) throw new DomainError('INVALID_STATE', 'Der er ingen åbne afvigelser at sende.');
  const params = await paramsAt(db, c.rulesAsOf);
  const date = await today(db);
  const at = await now(db);
  const rm = await teamRm(db, c.engagementId);
  for (const d of open) {
    await db.deviation.update({ where: { id: d.id }, data: { sentToAuditorAt: at } });
    await ensureTask(db, { caseId: c.id, type: 'OPG-10', title: `Vurdér afvigelse: ${d.description.slice(0, 80)}`, role: rm ? 'RM' : 'OR', assigneeId: rm ?? c.responsibleId, dueDate: addWorkdays(date, params.deviationReminderWorkdays), createdByRule: 'AR-05–AR-09', deviationId: d.id, inquiryId });
    if (d.severity !== 'KRITISK') await notify(db, { recipientId: rm, type: 'AFVIGELSE', message: `Afvigelse til vurdering: ${d.description}`, link: `/afvigelser/${d.id}`, channels: ['DAGLIG'] });
  }
  if (inquiry.status === 'SVAR_MODTAGET') await transitionInquiry(db, inquiryId, 'AFVENTER_REVISOR', actor.id, {}, `${open.length} afvigelse(r) sendt til revisor`);
  await appendEvent(db, { objectType: 'Forespørgsel', objectId: inquiryId, caseId: c.id, action: 'afvigelser.sendt_til_revisor', actorId: actor.id, after: { count: open.length } });
  await refreshCase(db, c.id);
  return { sent: open.length };
}

/**
 * Vurdér en afvigelse. Den, der må lukke efter klassifikationen, lukker;
 * ellers forberedes vurderingen (RM/KM), og revisor godkender (OPG-10).
 */
export async function assessDeviation(
  db: Db,
  actor: Actor,
  deviationId: string,
  input: { decision: 'FORKLARET' | 'FEJL_I_REGNSKABET' | 'YDERLIGERE_HANDLING'; justification: string; severity?: Severity },
) {
  assertCan(actor, 'MARK_EXPLAINED');
  const d = await db.deviation.findUnique({ where: { id: deviationId } });
  if (!d) throw new DomainError('NOT_FOUND', 'Afvigelsen findes ikke.');
  const c = await loadCaseFor(db, actor, d.caseId);
  assertNotLocked(c);
  if (d.status === 'LUKKET') throw new DomainError('INVALID_STATE', 'Afvigelsen er lukket.');
  if (input.justification.trim().length < 10) throw new DomainError('VALIDATION', 'Begrundelsen skal være på mindst 10 tegn.');
  const isResponsible = actor.role === 'OR' && c.responsibleId === actor.id;
  if (input.severity && input.severity !== d.severity && !isResponsible) throw new DomainError('FORBIDDEN', 'Kun opgaveansvarlig revisor kan omklassificere en afvigelse.');
  const severity = (input.severity ?? d.severity) as Severity;
  const at = await now(db);
  if (canCloseDeviation(severity, actor.role, isResponsible)) {
    await db.deviation.update({ where: { id: deviationId }, data: { severity, decision: input.decision, justification: input.justification.trim(), status: 'LUKKET', approvedById: actor.id, approvedAt: at, preparedById: d.preparedById ?? actor.id } });
    await appendEvent(db, { objectType: 'Afvigelse', objectId: deviationId, caseId: c.id, action: 'afvigelse.lukket', actorId: actor.id, before: { status: d.status, severity: d.severity }, after: { status: 'LUKKET', severity, decision: input.decision }, reason: input.justification });
    await closeTasks(db, { deviationId });
    await afterDeviationClosed(db, actor.id, d.inquiryId);
  } else {
    await db.deviation.update({ where: { id: deviationId }, data: { decision: input.decision, justification: input.justification.trim(), status: 'UNDER_VURDERING', preparedById: actor.id } });
    await appendEvent(db, { objectType: 'Afvigelse', objectId: deviationId, caseId: c.id, action: 'afvigelse.vurderet', actorId: actor.id, before: { status: d.status }, after: { status: 'UNDER_VURDERING', decision: input.decision }, reason: input.justification });
    await closeTasks(db, { deviationId });
    await ensureTask(db, { caseId: c.id, type: 'OPG-10', title: `Godkend vurdering: ${d.description.slice(0, 70)}`, role: 'OR', assigneeId: c.responsibleId, dueDate: addWorkdays(await today(db), 2), createdByRule: 'Klassifikation (6.4)', deviationId, inquiryId: d.inquiryId });
    if (!d.sentToAuditorAt) await db.deviation.update({ where: { id: deviationId }, data: { sentToAuditorAt: at } });
  }
  await refreshCase(db, c.id);
  return db.deviation.findUniqueOrThrow({ where: { id: deviationId } });
}

async function afterDeviationClosed(db: Db, actorId: string, inquiryId: string | null) {
  if (!inquiryId) return;
  const remaining = await db.deviation.count({ where: { inquiryId, status: { not: 'LUKKET' } } });
  const inquiry = await db.inquiry.findUniqueOrThrow({ where: { id: inquiryId } });
  if (remaining === 0 && (inquiry.status === 'SVAR_MODTAGET' || inquiry.status === 'AFVENTER_REVISOR')) {
    const response = await db.response.findFirst({ where: { inquiryId, extractionApprovedAt: { not: null } } });
    if (response) await transitionInquiry(db, inquiryId, 'AFSLUTTET', actorId, {}, 'Alle afvigelser er behandlet');
  }
}

/** S07: bed kunden om en forklaring (mail fra funktionspostkassen; svaret registreres i sagen). */
export async function requestCustomerExplanation(db: Db, actor: Actor, deviationId: string, input: { question: string }) {
  assertCan(actor, 'MARK_EXPLAINED');
  const d = await db.deviation.findUnique({ where: { id: deviationId } });
  if (!d) throw new DomainError('NOT_FOUND', 'Afvigelsen findes ikke.');
  const c = await loadCaseFor(db, actor, d.caseId);
  const customer = await db.srcCustomer.findUniqueOrThrow({ where: { id: c.customerId } });
  await logCall(db, 'Graph (funktionspostkasse)', 'sendMail', { to: customer.contactEmail, subject: 'Spørgsmål til jeres bankengagement', body: input.question });
  await appendEvent(db, { objectType: 'Afvigelse', objectId: deviationId, caseId: c.id, action: 'afvigelse.kunde_spurgt', actorId: actor.id, reason: input.question });
  return { ok: true };
}

