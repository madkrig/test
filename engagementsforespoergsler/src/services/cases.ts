import {
  addDays, addWorkdays, bankListCompleteness, caseTimeline, CATEGORY_LABELS, formatDanish, kr, referenceFor, RESOLVED_INQUIRY,
  SEVERITY_LABELS, DEVIATION_DECISION_LABELS, sendWindow, type BankListSource, type InquiryStatus, type IsoDate, type LineCategory, type Severity,
} from '@/domain/ef';
import { archive } from './adapters';
import { authEvaluation } from './auth-check';
import { now, today } from './clock';
import { assertCan, assertNotLocked, isDelegate, loadCaseFor, paramsAt, type Actor } from './context';
import type { Db } from './db';
import { DomainError } from './errors';
import { appendEvent } from './event-log';
import { ensureAuthTasks } from './fuldmagter';
import { newId } from './ids';
import { customerName, refreshCase, refreshInquiry } from './readiness';
import { closeTasks, ensureTask, notify } from './work';

/**
 * Sagsservice (P01–P03, P11, SOP-EF-01/02/08/09) – erstatter banklister i
 * Excel/Access og den manuelle planlægning: sagen oprettes af reglerne,
 * banklisten foreslås fra sidste år og SAF-T, og revisor godkender i appen.
 */

/**
 * Kernemedarbejder pr. afdeling (kerneteam Øst/Vest). Habilitetsspærrede og
 * medarbejdere uden adgang til fortrolige kunder springes over (10.4).
 */
async function coreUserFor(db: Db, department: string, customerId: string): Promise<string | null> {
  const customer = await db.srcCustomer.findUniqueOrThrow({ where: { id: customerId } });
  const conflicts = (await db.srcConflict.findMany({ where: { customerId } })).map((c) => c.userId);
  const allowed = JSON.parse(customer.confidentialUserIds) as string[];
  const ok = (id: string) => !conflicts.includes(id) && (!customer.confidential || allowed.includes(id));
  const mapping = await db.setting.findUnique({ where: { key: `kerneteam:${department}` } });
  if (mapping && ok(mapping.value)) return mapping.value;
  const kms = await db.user.findMany({ where: { role: 'KM' }, orderBy: { id: 'asc' } });
  return kms.find((u) => ok(u.id))?.id ?? null;
}

/** Næste løbenummer til referencen EF-ÅÅÅÅ-nnnnnn. */
async function nextReference(db: Db, date: IsoDate): Promise<string> {
  const year = Number(date.slice(0, 4));
  const key = `refSeq:${year}`;
  const row = await db.setting.findUnique({ where: { key } });
  const seq = (row ? Number(row.value) : 4800) + 1;
  await db.setting.upsert({ where: { key }, update: { value: String(seq) }, create: { key, value: String(seq) } });
  return referenceFor(year, seq);
}

/**
 * P01 (TR-01, TR-02, TR-03, TR-09): opret sager for erklæringsopgaver, hvor
 * T−60 er nået. Køres af den daglige kørsel og er idempotent (én sag pr. opgave).
 */
export async function createDueCases(db: Db): Promise<string[]> {
  const date = await today(db);
  const params = await paramsAt(db, date);
  const engagements = await db.srcEngagement.findMany({ where: { status: 'AKTIV' } });
  const existing = new Set((await db.case.findMany({ select: { engagementId: true } })).map((c) => c.engagementId));
  const created: string[] = [];
  for (const e of engagements) {
    if (existing.has(e.id)) continue;
    const mandatory = params.mandatoryTypes.includes(e.type);
    if (!mandatory && !(params.optInTypes.includes(e.type) && e.optIn)) continue;
    const t = caseTimeline(e.periodEnd, e.plannedSignOff, params);
    if (date < t.create || date > e.plannedSignOff) continue;
    created.push(await createCase(db, e.id, mandatory ? 'TR-01' : 'TR-01 (tilvalg)'));
  }
  return created;
}

async function createCase(db: Db, engagementId: string, reason: string): Promise<string> {
  const e = await db.srcEngagement.findUniqueOrThrow({ where: { id: engagementId } });
  const customer = await db.srcCustomer.findUniqueOrThrow({ where: { id: e.customerId } });
  const date = await today(db);
  const params = await paramsAt(db, date);
  const t = caseTimeline(e.periodEnd, e.plannedSignOff, params);
  const previous = await db.case.findFirst({ where: { customerId: customer.id, balanceDate: { lt: e.periodEnd } }, orderBy: { balanceDate: 'desc' } });
  const hasAuth = (await db.fuldmagt.count({ where: { customerId: customer.id, status: { in: ['GYLDIG', 'BOER_FORNYES'] } } })) > 0;
  const isNewCustomer = !previous && !hasAuth; // TR-03
  const id = newId('sag');
  const at = await now(db);
  await db.case.create({
    data: {
      id, engagementId: e.id, customerId: customer.id, cvr: customer.cvr, engagementType: e.type, balanceDate: e.periodEnd,
      plannedSignOff: e.plannedSignOff, responsibleId: e.responsibleId, coreUserId: await coreUserFor(db, e.department, customer.id), department: e.department,
      status: 'PLANLAGT', isNewCustomer, rulesAsOf: date, createdAt: at, updatedAt: at,
    },
  });
  await appendEvent(db, { objectType: 'Sag', objectId: id, caseId: id, action: 'sag.oprettet', actorId: 'system', after: { customer: customer.name, balanceDate: e.periodEnd, type: e.type, rulesAsOf: date }, reason: `${reason}, TR-02 (T−${params.createDaysBeforeT})` });
  await ensureTask(db, { caseId: id, type: 'OPG-01', title: `Engagementsforespørgsler · ${customer.name} · ${formatDanish(e.periodEnd)}`, role: 'OR', assigneeId: e.responsibleId, dueDate: t.conclusionDeadline, createdByRule: 'TR-01' });

  // Bankliste-forslag (P02): sidste års svar + SAF-T. Fusionerede institutter erstattes af det overtagende.
  const proposal = new Map<string, Set<BankListSource>>();
  const add = async (instituteId: string, source: BankListSource) => {
    const inst = await db.institute.findUnique({ where: { id: instituteId } });
    const target = inst?.mergedIntoId ?? instituteId;
    if (!proposal.has(target)) proposal.set(target, new Set());
    proposal.get(target)!.add(source);
  };
  if (previous) {
    const lastYear = await db.bankListLine.findMany({ where: { caseId: previous.id, included: true } });
    for (const l of lastYear) await add(l.instituteId, 'SIDSTE_AAR');
  }
  const ledger = await db.srcLedgerAccount.findMany({ where: { customerId: customer.id, instituteId: { not: null } } });
  for (const l of ledger) await add(l.instituteId!, 'SAFT');
  for (const [instituteId, sources] of proposal) {
    await db.bankListLine.create({ data: { id: newId('bl'), caseId: id, instituteId, sources: JSON.stringify([...sources]), createdAt: at } });
  }
  if (proposal.size) await appendEvent(db, { objectType: 'Sag', objectId: id, caseId: id, action: 'bankliste.foreslaaet', actorId: 'system', after: { lines: proposal.size }, reason: 'Sidste års svar og SAF-T (P02)' });

  const c = await db.case.findUniqueOrThrow({ where: { id } });
  if (isNewCustomer || proposal.size === 0) {
    await ensureTask(db, { caseId: id, type: 'OPG-03', title: 'Indhent bankliste fra kunden', role: 'KM', assigneeId: c.coreUserId, dueDate: t.proposal, createdByRule: isNewCustomer ? 'TR-03' : 'Ingen historik og intet SAF-T' });
  }
  if (isNewCustomer && e.type === 'REVISION') {
    await ensureTask(db, { caseId: id, type: 'OPG-12', title: 'Tag stilling til primo-forespørgsel (førsteårsrevision, ISA 510)', role: 'OR', assigneeId: e.responsibleId, dueDate: t.approvalDeadline, createdByRule: 'TR-09' });
  }
  await ensureAuthTasks(db, id); // TR-04
  if (date >= t.proposal) await bankListProposalReady(db, id);
  await refreshCase(db, id);
  return id;
}

/** TR-05: forslaget er klar til revisor (T−45) – OPG-04 og notifikation (Teams + brugerflade). */
export async function bankListProposalReady(db: Db, caseId: string): Promise<void> {
  const c = await db.case.findUniqueOrThrow({ where: { id: caseId } });
  if (c.bankListApprovedAt) return;
  const params = await paramsAt(db, c.rulesAsOf);
  const t = caseTimeline(c.balanceDate, c.plannedSignOff, params);
  const existing = await db.task.findFirst({ where: { caseId, type: 'OPG-04' } });
  if (existing) return;
  await ensureTask(db, { caseId, type: 'OPG-04', title: 'Godkend bankliste', role: 'OR', assigneeId: c.delegateId ?? c.responsibleId, dueDate: t.approvalDeadline, createdByRule: 'TR-05' });
  await notify(db, { recipientId: c.delegateId ?? c.responsibleId, type: 'BANKLISTE_KLAR', message: `Bankliste klar til godkendelse: ${await customerName(db, c.customerId)} (frist ${formatDanish(t.approvalDeadline)})`, link: `/sager/${caseId}?fane=bankliste`, channels: ['TEAMS', 'BRUGERFLADE'] });
}

// ---------------------------------------------------------------------------
// Bankliste (P02–P03, S04)
// ---------------------------------------------------------------------------

export async function addBankListLine(db: Db, actor: Actor, caseId: string, input: { instituteId: string; source?: BankListSource; note?: string }) {
  assertCan(actor, 'EDIT_BANKLIST', { proposal: true });
  const c = await loadCaseFor(db, actor, caseId);
  assertNotLocked(c);
  const inst = await db.institute.findUnique({ where: { id: input.instituteId } });
  if (!inst) throw new DomainError('NOT_FOUND', 'Instituttet findes ikke i bankregisteret.', { recovery: 'Opret instituttet i bankregisteret (S09).' });
  if (inst.mergedIntoId) {
    const into = await db.institute.findUnique({ where: { id: inst.mergedIntoId } });
    throw new DomainError('VALIDATION', `${inst.name} er fusioneret ind i ${into?.name}.`, { recovery: `Tilføj ${into?.name} i stedet.` });
  }
  const source: BankListSource = actor.role === 'AGENT' ? 'AGENT' : (input.source ?? 'MANUEL');
  const existing = await db.bankListLine.findUnique({ where: { caseId_instituteId: { caseId, instituteId: inst.id } } });
  const at = await now(db);
  if (existing) {
    const sources = new Set<string>(JSON.parse(existing.sources));
    sources.add(source);
    await db.bankListLine.update({ where: { id: existing.id }, data: { sources: JSON.stringify([...sources]), included: actor.role === 'AGENT' ? existing.included : true, deselectReason: actor.role === 'AGENT' ? existing.deselectReason : null } });
  } else {
    await db.bankListLine.create({
      data: {
        id: newId('bl'), caseId, instituteId: inst.id, sources: JSON.stringify([source]),
        // Agentens forslag er en kladde (10.5): linjen er fravalgt, indtil en bruger tager den med.
        included: actor.role !== 'AGENT', deselectReason: actor.role === 'AGENT' ? 'Forslag fra agent – afventer bruger' : null,
        addedAfterApproval: !!c.bankListApprovedAt, createdAt: at,
      },
    });
  }
  await appendEvent(db, { objectType: 'Bankliste', objectId: caseId, caseId, action: 'bankliste.linje_tilfoejet', actorId: actor.id, source: actor.role === 'AGENT' ? 'AGENT' : 'BRUGER', after: { institute: inst.name, source }, reason: input.note });
  if (c.bankListApprovedAt && actor.role !== 'AGENT') {
    // TR-06: nyt institut efter godkendelse kræver ny godkendelse – og bliver en ad hoc-forespørgsel.
    const params = await paramsAt(db, c.rulesAsOf);
    const t = caseTimeline(c.balanceDate, c.plannedSignOff, params);
    await ensureTask(db, { caseId, type: 'OPG-04', title: `Godkend tilføjet institut: ${inst.name} (TR-06)`, role: 'OR', assigneeId: c.responsibleId, dueDate: addWorkdays(await today(db), 2) < t.alternativesDeadline ? addWorkdays(await today(db), 2) : t.alternativesDeadline, createdByRule: 'TR-06' });
    await notify(db, { recipientId: c.responsibleId, type: 'BANKLISTE_KLAR', message: `Nyt institut på banklisten kræver godkendelse: ${inst.name}`, link: `/sager/${caseId}?fane=bankliste`, channels: ['BRUGERFLADE'] });
  }
  await ensureAuthTasks(db, caseId);
  await refreshCase(db, caseId);
  return { ok: true };
}

export async function setBankListLine(db: Db, actor: Actor, lineId: string, input: { included: boolean; reason?: string; customerConfirmed?: boolean }) {
  assertCan(actor, 'EDIT_BANKLIST');
  const line = await db.bankListLine.findUnique({ where: { id: lineId } });
  if (!line) throw new DomainError('NOT_FOUND', 'Linjen findes ikke.');
  const c = await loadCaseFor(db, actor, line.caseId);
  assertNotLocked(c);
  if (c.bankListApprovedAt && !line.addedAfterApproval) {
    throw new DomainError('INVALID_STATE', 'Banklisten er godkendt. Linjer kan ikke fravælges bagefter.', { recovery: 'Annullér forespørgslen til instituttet med begrundelse i stedet.' });
  }
  if (!input.included && !input.reason?.trim()) {
    throw new DomainError('VALIDATION', 'Fravalg kræver en begrundelse (VR-08).', { recovery: 'Skriv fx "Engagement ophørt 03.2026 – bekræftet af kunden".' });
  }
  if (actor.role === 'AGENT' && input.included) throw new DomainError('FORBIDDEN', 'Agenter må kun foreslå linjer. En bruger skal tage dem med (10.5).');
  await db.bankListLine.update({ where: { id: lineId }, data: { included: input.included, deselectReason: input.included ? null : input.reason!.trim(), customerConfirmed: input.customerConfirmed ?? line.customerConfirmed } });
  const inst = await db.institute.findUnique({ where: { id: line.instituteId } });
  await appendEvent(db, { objectType: 'Bankliste', objectId: line.caseId, caseId: line.caseId, action: input.included ? 'bankliste.linje_medtaget' : 'bankliste.linje_fravalgt', actorId: actor.id, before: { included: line.included }, after: { institute: inst?.name, included: input.included }, reason: input.reason });
  await refreshCase(db, line.caseId);
  return { ok: true };
}

/** OPG-03: kundens bekræftelse af sine pengeinstitutter (kundeformular i stedet for mail med Excel-ark). */
export async function customerConfirmBankList(db: Db, actor: Actor, caseId: string, input: { instituteIds: string[]; note?: string }) {
  assertCan(actor, 'EDIT_BANKLIST');
  const c = await loadCaseFor(db, actor, caseId);
  assertNotLocked(c);
  for (const instituteId of input.instituteIds) {
    const existing = await db.bankListLine.findUnique({ where: { caseId_instituteId: { caseId, instituteId } } });
    if (existing) {
      const sources = new Set<string>(JSON.parse(existing.sources));
      sources.add('KUNDE');
      await db.bankListLine.update({ where: { id: existing.id }, data: { sources: JSON.stringify([...sources]), customerConfirmed: true } });
    } else {
      await db.bankListLine.create({ data: { id: newId('bl'), caseId, instituteId, sources: JSON.stringify(['KUNDE']), customerConfirmed: true, addedAfterApproval: !!c.bankListApprovedAt, createdAt: await now(db) } });
    }
  }
  await appendEvent(db, { objectType: 'Bankliste', objectId: caseId, caseId, action: 'bankliste.kunde_bekraeftet', actorId: actor.id, after: { institutes: input.instituteIds.length }, reason: input.note ?? 'Kunden har bekræftet sine pengeinstitutter' });
  await closeTasks(db, { type: 'OPG-03', caseId });
  await ensureAuthTasks(db, caseId);
  await bankListProposalReady(db, caseId);
  await refreshCase(db, caseId);
  return { ok: true };
}

/** Forventede institutter til VR-08: sidste års svar og bogføringen (SAF-T). */
export async function expectedInstitutes(db: Db, caseId: string) {
  const c = await db.case.findUniqueOrThrow({ where: { id: caseId } });
  const previous = await db.case.findFirst({ where: { customerId: c.customerId, balanceDate: { lt: c.balanceDate } }, orderBy: { balanceDate: 'desc' } });
  const lastYear = previous ? (await db.bankListLine.findMany({ where: { caseId: previous.id, included: true } })).map((l) => l.instituteId) : [];
  const saft = (await db.srcLedgerAccount.findMany({ where: { customerId: c.customerId, instituteId: { not: null } } })).map((l) => l.instituteId!);
  const resolve = async (ids: string[]) => Promise.all(ids.map(async (id) => (await db.institute.findUnique({ where: { id } }))?.mergedIntoId ?? id));
  return { lastYear: await resolve(lastYear), saft: await resolve(saft) };
}

export async function bankListWarnings(db: Db, caseId: string): Promise<string[]> {
  const lines = await db.bankListLine.findMany({ where: { caseId } });
  const missing = bankListCompleteness(lines, await expectedInstitutes(db, caseId));
  const names = await db.institute.findMany({ where: { id: { in: missing } } });
  return missing.map((id) => `VR-08: ${names.find((n) => n.id === id)?.name ?? id} fremgår af sidste års svar eller bogføringen, men er hverken med eller fravalgt med begrundelse.`);
}

/** P03 / VR-03: revisor (eller delegeret) godkender; derefter dannes forespørgslerne (P06). */
export async function approveBankList(db: Db, actor: Actor, caseId: string, input: { acknowledgeWarnings?: boolean } = {}) {
  const c = await loadCaseFor(db, actor, caseId);
  assertNotLocked(c);
  const delegated = await isDelegate(db, actor, c);
  assertCan(actor, 'APPROVE_BANKLIST', { delegated });
  if (actor.role === 'OR' && c.responsibleId !== actor.id) {
    throw new DomainError('FORBIDDEN', 'Kun sagens opgaveansvarlige revisor (eller en delegeret) kan godkende banklisten.', { owner: 'Opgaveansvarlig revisor' });
  }
  const lines = await db.bankListLine.findMany({ where: { caseId } });
  const pendingNew = lines.filter((l) => l.addedAfterApproval && l.included);
  if (c.bankListApprovedAt && pendingNew.length === 0) throw new DomainError('INVALID_STATE', 'Banklisten er allerede godkendt.');
  const included = lines.filter((l) => l.included);
  if (included.length === 0) throw new DomainError('VALIDATION', 'Banklisten har ingen institutter.', { recovery: 'Tilføj institutter – eller dokumentér, at kunden ikke har pengeinstitutter, og annullér sagen.' });
  const warnings = await bankListWarnings(db, caseId);
  if (warnings.length && !input.acknowledgeWarnings) {
    throw new DomainError('INVALID_STATE', 'Banklisten kan være ufuldstændig.', { reasons: warnings, recovery: 'Tilføj instituttet, fravælg med begrundelse – eller godkend med advarslen.' });
  }
  const at = await now(db);
  const first = !c.bankListApprovedAt;
  if (first) await db.case.update({ where: { id: caseId }, data: { bankListApprovedById: actor.id, bankListApprovedAt: at, updatedAt: at } });
  await appendEvent(db, {
    objectType: 'Sag', objectId: caseId, caseId, action: 'bankliste.godkendt', actorId: actor.id, onBehalfOf: delegated ? c.responsibleId ?? undefined : undefined,
    after: { included: included.length, deselected: lines.length - included.length, lines: included.length }, reason: warnings.length ? `Godkendt med advarsler: ${warnings.join(' ')}` : undefined,
  });
  await closeTasks(db, { type: 'OPG-04', caseId });
  await generateInquiries(db, caseId, first ? 'AARLIG' : 'ADHOC');
  await ensureAuthTasks(db, caseId);
  await refreshCase(db, caseId);
  return { ok: true, warnings };
}

/** P06: én forespørgsel pr. institut med unik reference og planlagt afsendelse (TR-10). */
async function generateInquiries(db: Db, caseId: string, type: 'AARLIG' | 'ADHOC') {
  const c = await db.case.findUniqueOrThrow({ where: { id: caseId } });
  const params = await paramsAt(db, c.rulesAsOf);
  const date = await today(db);
  const lines = await db.bankListLine.findMany({ where: { caseId, included: true } });
  for (const line of lines) {
    const exists = await db.inquiry.findFirst({ where: { caseId, instituteId: line.instituteId, statementDate: c.balanceDate, status: { not: 'ANNULLERET' } } });
    if (exists) continue;
    const inst = await db.institute.findUniqueOrThrow({ where: { id: line.instituteId } });
    const window = sendWindow(c.balanceDate, inst, params);
    const isLate = type === 'ADHOC' || line.addedAfterApproval;
    const planned = isLate ? (window.planned > date ? window.planned : date) : window.planned;
    const at = await now(db);
    const id = newId('fsp');
    await db.inquiry.create({
      data: {
        id, reference: await nextReference(db, planned), caseId, instituteId: inst.id, type: isLate ? 'ADHOC' : 'AARLIG', statementDate: c.balanceDate,
        status: 'KLADDE', channel: inst.channel, plannedSendDate: planned, adhocReason: isLate ? 'Institut tilføjet efter godkendelse (TR-06)' : null,
        requestedById: null, createdAt: at, updatedAt: at,
      },
    });
    await appendEvent(db, { objectType: 'Forespørgsel', objectId: id, caseId, action: 'forespoergsel.oprettet', actorId: 'system', after: { institute: inst.name, plannedSendDate: planned, channel: inst.channel, preorder: window.preorder }, reason: isLate ? 'TR-06' : 'P06' });
    await refreshInquiry(db, id);
  }
}

/** Delegering af bankliste-godkendelsen til en revisionsmedarbejder på sagen (US-R-03). */
export async function delegateApproval(db: Db, actor: Actor, caseId: string, input: { delegateId: string | null; until?: IsoDate | null }) {
  const c = await loadCaseFor(db, actor, caseId);
  assertNotLocked(c);
  if (actor.role !== 'OR' || c.responsibleId !== actor.id) throw new DomainError('FORBIDDEN', 'Kun sagens opgaveansvarlige revisor kan delegere.');
  if (input.delegateId) {
    const u = await db.user.findUnique({ where: { id: input.delegateId } });
    const onTeam = await db.srcTeamMember.findUnique({ where: { engagementId_userId: { engagementId: c.engagementId, userId: input.delegateId } } });
    if (!u || u.role !== 'RM' || !onTeam) throw new DomainError('VALIDATION', 'Der kan kun delegeres til en revisionsmedarbejder på opgaveteamet.');
  }
  await db.case.update({ where: { id: caseId }, data: { delegateId: input.delegateId, delegateUntil: input.until ?? null, updatedAt: await now(db) } });
  await appendEvent(db, { objectType: 'Sag', objectId: caseId, caseId, action: input.delegateId ? 'sag.delegeret' : 'sag.delegering_ophævet', actorId: actor.id, after: { delegateId: input.delegateId, until: input.until } });
  const task = await db.task.findFirst({ where: { caseId, type: 'OPG-04', status: 'AABEN' } });
  if (task) await db.task.update({ where: { id: task.id }, data: { assigneeId: input.delegateId ?? c.responsibleId } });
  await refreshCase(db, caseId);
  return { ok: true };
}

/** Revisor aktiverer en sag med tilvalg (review/opstilling, TR-01). */
export async function optInEngagement(db: Db, actor: Actor, engagementId: string) {
  const e = await db.srcEngagement.findUnique({ where: { id: engagementId } });
  if (!e) throw new DomainError('NOT_FOUND', 'Opgaven findes ikke.');
  if (actor.role !== 'OR' || e.responsibleId !== actor.id) throw new DomainError('FORBIDDEN', 'Kun opgaveansvarlig revisor kan tilvælge engagementsforespørgsler.');
  await db.srcEngagement.update({ where: { id: engagementId }, data: { optIn: true } });
  await appendEvent(db, { objectType: 'Opgave', objectId: engagementId, action: 'tilvalg', actorId: actor.id, reason: 'Revisor har tilvalgt engagementsforespørgsler (TR-01)' });
  const created = await createDueCases(db);
  return { ok: true, created };
}

// ---------------------------------------------------------------------------
// Ad hoc og primo (SOP-EF-09, TR-09)
// ---------------------------------------------------------------------------

export async function requestAdhoc(db: Db, actor: Actor, caseId: string, input: { instituteId: string; statementDate: IsoDate; reason: string; type?: 'ADHOC' | 'PRIMO' }) {
  assertCan(actor, 'REQUEST_ADHOC');
  const c = await loadCaseFor(db, actor, caseId);
  assertNotLocked(c);
  if (!input.reason.trim()) throw new DomainError('VALIDATION', 'Angiv en begrundelse.');
  const inst = await db.institute.findUnique({ where: { id: input.instituteId } });
  if (!inst) throw new DomainError('NOT_FOUND', 'Instituttet findes ikke i bankregisteret.');
  const date = await today(db);
  const at = await now(db);
  const id = newId('fsp');
  const selfApproved = actor.role === 'OR' && c.responsibleId === actor.id;
  await db.inquiry.create({
    data: {
      id, reference: await nextReference(db, date), caseId, instituteId: inst.id, type: input.type ?? 'ADHOC', statementDate: input.statementDate, status: 'KLADDE',
      channel: inst.channel, plannedSendDate: date, adhocReason: input.reason.trim(), requestedById: actor.id, approvedById: selfApproved ? actor.id : null, createdAt: at, updatedAt: at,
    },
  });
  await appendEvent(db, { objectType: 'Forespørgsel', objectId: id, caseId, action: 'forespoergsel.adhoc_anmodet', actorId: actor.id, after: { institute: inst.name, statementDate: input.statementDate, type: input.type ?? 'ADHOC' }, reason: input.reason });
  const line = await db.bankListLine.findUnique({ where: { caseId_instituteId: { caseId, instituteId: inst.id } } });
  if (!line) await db.bankListLine.create({ data: { id: newId('bl'), caseId, instituteId: inst.id, sources: JSON.stringify(['MANUEL']), addedAfterApproval: !!c.bankListApprovedAt, createdAt: at } });
  if (!selfApproved) {
    await ensureTask(db, { caseId, type: 'OPG-13', title: `Godkend ad hoc-forespørgsel til ${inst.name}`, role: 'OR', assigneeId: c.responsibleId, dueDate: addWorkdays(date, 2), createdByRule: 'SOP-EF-09', inquiryId: id });
    await notify(db, { recipientId: c.responsibleId, type: 'ADHOC', message: `Ad hoc-forespørgsel til ${inst.name} afventer din godkendelse`, link: `/sager/${caseId}?fane=forespoergsler`, channels: ['BRUGERFLADE'] });
  }
  await ensureAuthTasks(db, caseId);
  await refreshInquiry(db, id);
  await refreshCase(db, caseId);
  return { id };
}

export async function approveAdhoc(db: Db, actor: Actor, inquiryId: string) {
  const inquiry = await db.inquiry.findUnique({ where: { id: inquiryId } });
  if (!inquiry) throw new DomainError('NOT_FOUND', 'Forespørgslen findes ikke.');
  const c = await loadCaseFor(db, actor, inquiry.caseId);
  if (actor.role !== 'OR' || c.responsibleId !== actor.id) throw new DomainError('FORBIDDEN', 'Kun opgaveansvarlig revisor godkender ad hoc-forespørgsler (SOP-EF-09).');
  await db.inquiry.update({ where: { id: inquiryId }, data: { approvedById: actor.id, updatedAt: await now(db) } });
  await appendEvent(db, { objectType: 'Forespørgsel', objectId: inquiryId, caseId: c.id, action: 'forespoergsel.adhoc_godkendt', actorId: actor.id });
  await closeTasks(db, { type: 'OPG-13', inquiryId });
  await refreshInquiry(db, inquiryId);
  await refreshCase(db, c.id);
  return { ok: true };
}

/** TR-09: revisor tilvælger (eller fravælger) primo-forespørgsel for en førstegangskunde. */
export async function decidePrimo(db: Db, actor: Actor, caseId: string, input: { accept: boolean; reason?: string }) {
  const c = await loadCaseFor(db, actor, caseId);
  if (actor.role !== 'OR' || c.responsibleId !== actor.id) throw new DomainError('FORBIDDEN', 'Kun opgaveansvarlig revisor beslutter primo-forespørgsel.');
  const e = await db.srcEngagement.findUniqueOrThrow({ where: { id: c.engagementId } });
  const primoDate = addDays(e.periodStart, -1);
  await closeTasks(db, { type: 'OPG-12', caseId });
  await appendEvent(db, { objectType: 'Sag', objectId: caseId, caseId, action: input.accept ? 'primo.tilvalgt' : 'primo.fravalgt', actorId: actor.id, reason: input.reason ?? (input.accept ? `Primo-saldi pr. ${formatDanish(primoDate)} (ISA 510)` : undefined) });
  if (!input.accept) return { created: 0 };
  const lines = await db.bankListLine.findMany({ where: { caseId, included: true } });
  let created = 0;
  for (const l of lines) {
    await requestAdhoc(db, actor, caseId, { instituteId: l.instituteId, statementDate: primoDate, reason: 'Primo-forespørgsel, førsteårsrevision (TR-09)', type: 'PRIMO' });
    created++;
  }
  return { created };
}

// ---------------------------------------------------------------------------
// Konklusion, låsning og fremskrivning (P11, SOP-EF-08)
// ---------------------------------------------------------------------------

/** K2: forventet population mod faktisk sendte – manglende, ekstra og dobbelte afsendelser. */
export async function populationCheck(db: Db, caseId: string) {
  const lines = await db.bankListLine.findMany({ where: { caseId, included: true } });
  const inquiries = await db.inquiry.findMany({ where: { caseId, type: 'AARLIG' } });
  const c = await db.case.findUniqueOrThrow({ where: { id: caseId } });
  const active = inquiries.filter((i) => i.status !== 'ANNULLERET' && i.statementDate === c.balanceDate);
  const missing = c.bankListApprovedAt ? lines.filter((l) => !active.some((i) => i.instituteId === l.instituteId)).map((l) => l.instituteId) : [];
  const extra = active.filter((i) => !lines.some((l) => l.instituteId === i.instituteId)).map((i) => i.instituteId);
  const counts = new Map<string, number>();
  for (const i of active) counts.set(i.instituteId, (counts.get(i.instituteId) ?? 0) + 1);
  const duplicates = [...counts].filter(([, n]) => n > 1).map(([id]) => id);
  return { expected: lines.length, actual: active.length, sent: active.filter((i) => i.sentAt).length, missing, extra, duplicates };
}

/** Konklusionsudkast dannet af svar, afvigelser og alternative handlinger (OPG-14). */
export async function conclusionDraft(db: Db, caseId: string): Promise<string> {
  const c = await db.case.findUniqueOrThrow({ where: { id: caseId } });
  const inquiries = await db.inquiry.findMany({ where: { caseId } });
  const institutes = await db.institute.findMany({ where: { id: { in: inquiries.map((i) => i.instituteId) } } });
  const deviations = await db.deviation.findMany({ where: { caseId } });
  const responses = await db.response.findMany({ where: { inquiryId: { in: inquiries.map((i) => i.id) } } });
  const notes = await db.responseLine.findMany({ where: { responseId: { in: responses.map((r) => r.id) }, category: { in: ['GARANTI', 'SIKKERHED_STILLET', 'SIKKERHED_MODTAGET'] } } });
  const name = (id: string) => institutes.find((x) => x.id === id)?.name ?? id;
  const parts = [
    `Engagementsforespørgsler pr. ${formatDanish(c.balanceDate)} for ${await customerName(db, c.customerId)}.`,
    `Der er sendt ${inquiries.filter((i) => i.sentAt).length} forespørgsler til ${new Set(inquiries.filter((i) => i.sentAt).map((i) => i.instituteId)).size} institutter. ` +
      `${inquiries.filter((i) => i.status === 'AFSLUTTET' && !i.alternativeActions).length} er besvaret direkte af instituttet og afstemt til bogføringen.`,
  ];
  for (const i of inquiries.filter((x) => x.alternativeActions)) parts.push(`${name(i.instituteId)}: intet svar. Alternative handlinger: ${i.alternativeActions}`);
  for (const i of inquiries.filter((x) => x.status === 'ANNULLERET')) parts.push(`${name(i.instituteId)}: annulleret – ${i.cancelReason}.`);
  const significant = deviations.filter((d) => d.severity === 'KRITISK' || d.severity === 'VAESENTLIG');
  if (significant.length) {
    parts.push('Afvigelser:');
    for (const d of significant) parts.push(`– ${SEVERITY_LABELS[d.severity as Severity]}: ${d.description} Beslutning: ${d.decision ? DEVIATION_DECISION_LABELS[d.decision as 'FORKLARET'] : 'mangler'}. ${d.justification ?? ''}`.trim());
  } else parts.push('Der er ingen væsentlige eller kritiske afvigelser.');
  if (notes.length) parts.push(`Til noteoplysninger (AR-08): ${notes.map((n) => `${CATEGORY_LABELS[n.category as LineCategory]} ${n.securityDescription ?? n.description}${n.amountDkkOre ? ` ${kr(n.amountDkkOre)} kr.` : ''}`).join('; ')}.`);
  parts.push('Konklusion: Der er opnået tilstrækkeligt og egnet revisionsbevis for bankengagementerne pr. balancedagen.');
  return parts.join('\n\n');
}

export async function concludeCase(db: Db, actor: Actor, caseId: string, input: { conclusion: string }) {
  assertCan(actor, 'CONCLUDE');
  const c = await loadCaseFor(db, actor, caseId);
  if (c.responsibleId !== actor.id) throw new DomainError('FORBIDDEN', 'Kun sagens opgaveansvarlige revisor kan konkludere.', { owner: 'Opgaveansvarlig revisor' });
  assertNotLocked(c);
  const inquiries = await db.inquiry.findMany({ where: { caseId } });
  const open = inquiries.filter((i) => !RESOLVED_INQUIRY.includes(i.status as InquiryStatus));
  const pop = await populationCheck(db, caseId);
  const openDeviations = await db.deviation.count({ where: { caseId, status: { not: 'LUKKET' } } });
  const reasons = [
    ...(c.bankListApprovedAt ? [] : ['Banklisten er ikke godkendt.']),
    ...(open.length ? [`${open.length} forespørgsel(er) er ikke afsluttet eller afklaret.`] : []),
    ...(openDeviations ? [`${openDeviations} afvigelse(r) er ikke lukket.`] : []),
    ...(pop.missing.length ? [`K2: ${pop.missing.length} institut(ter) på banklisten mangler en forespørgsel.`] : []),
    ...(pop.duplicates.length ? ['K2: der er dobbelte forespørgsler.'] : []),
  ];
  if (reasons.length) throw new DomainError('INVALID_STATE', 'Sagen kan ikke konkluderes endnu.', { reasons, recovery: 'Følg sagens næste handling.' });
  if (!input.conclusion.trim()) throw new DomainError('VALIDATION', 'Skriv eller godkend konklusionen.');
  const at = await now(db);
  await db.case.update({ where: { id: caseId }, data: { status: 'KONKLUDERET', conclusion: input.conclusion.trim(), concludedById: actor.id, concludedAt: at, updatedAt: at } });
  await appendEvent(db, { objectType: 'Sag', objectId: caseId, caseId, action: 'sag.konkluderet', actorId: actor.id, before: { status: c.status }, after: { status: 'KONKLUDERET' } });
  await closeTasks(db, { type: 'OPG-14', caseId });
  await lockAndRollForward(db, caseId);
  return { ok: true };
}

/** OPG-15: arkivér, lås og fremskriv fuldmagtsstatus til næste år. */
async function lockAndRollForward(db: Db, caseId: string) {
  const c = await db.case.findUniqueOrThrow({ where: { id: caseId } });
  await archive(db, { caseId, kind: 'KONKLUSION', title: `Konklusion pr. ${formatDanish(c.balanceDate)}`, cvr: c.cvr, fileName: `Konklusion-${c.cvr}-${c.balanceDate}.pdf` });
  const at = await now(db);
  await db.case.update({ where: { id: caseId }, data: { status: 'LAAST', lockedAt: at, nextAction: 'Ingen – sagen er konkluderet og låst', nextOwner: '–', updatedAt: at } });
  await closeTasks(db, { caseId });
  await appendEvent(db, { objectType: 'Sag', objectId: caseId, caseId, action: 'sag.laast', actorId: 'system', before: { status: 'KONKLUDERET' }, after: { status: 'LAAST' }, reason: 'P11: arkiveret og låst som revisionsbevis' });
  // Fuldmagtsstatus fremskrives (fx "bør fornyes"), så næste års sag starter med det rigtige billede.
  const evaluation = await authEvaluation(db, c.customerId, null, await today(db), await paramsAt(db, await today(db)));
  if (evaluation.authId && (evaluation.result === 'BOER_FORNYES' || evaluation.result === 'SKAL_FORNYES')) {
    await db.fuldmagt.update({ where: { id: evaluation.authId }, data: { status: evaluation.result, invalidReason: evaluation.reason } });
    await appendEvent(db, { objectType: 'Fuldmagt', objectId: evaluation.authId, action: 'fuldmagt.fremskrevet', actorId: 'system', after: { status: evaluation.result }, reason: `${evaluation.ruleId}: ${evaluation.reason}` });
  }
}

export async function reopenCase(db: Db, actor: Actor, caseId: string, reason: string) {
  assertCan(actor, 'REOPEN');
  const c = await loadCaseFor(db, actor, caseId);
  if (c.responsibleId !== actor.id) throw new DomainError('FORBIDDEN', 'Kun sagens opgaveansvarlige revisor kan genåbne.');
  if (!c.lockedAt) throw new DomainError('INVALID_STATE', 'Sagen er ikke låst.');
  if (!reason.trim()) throw new DomainError('VALIDATION', 'Genåbning kræver en begrundelse.');
  await db.case.update({ where: { id: caseId }, data: { status: 'KLAR_TIL_KONKLUSION', lockedAt: null, reopenReason: reason.trim(), updatedAt: await now(db) } });
  await appendEvent(db, { objectType: 'Sag', objectId: caseId, caseId, action: 'sag.genaabnet', actorId: actor.id, before: { status: c.status }, after: { status: 'KLAR_TIL_KONKLUSION' }, reason });
  await refreshCase(db, caseId);
  return { ok: true };
}
