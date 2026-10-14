import {
  addWorkdays, canTransitionInquiry, caseTimeline, inquiryLetter, REJECTION_REASON_LABELS, reminderLetter, responseDeadline,
  type InquiryStatus, type IsoDate, type RejectionReason,
} from '@/domain/ef';
import { archive, dispatch, logCall, type OutboundItem } from './adapters';
import { now, today } from './clock';
import { assertCan, assertNotLocked, CENTRAL_MAILBOX, loadCaseFor, paramsAt, type Actor } from './context';
import type { Db } from './db';
import { DomainError } from './errors';
import { appendEvent } from './event-log';
import { ensureAuthTasks } from './fuldmagter';
import { withIdempotency } from './idempotency';
import { newId } from './ids';
import { inquiryChecks, refreshCase, refreshInquiry } from './readiness';
import { closeTasks, ensureTask, notify } from './work';

export { transition as transitionInquiry };

/**
 * Udsendelsesservice (P07–P08, SOP-EF-04/05) – erstatter RPA/VBA-scriptet:
 * batches pr. institut og kanal, idempotent afsendelse fra funktionspostkassen,
 * rykkere, afvisninger og eskalering efter faste regler (K5).
 */

async function loadInquiry(db: Db, actor: Actor, inquiryId: string) {
  const inquiry = await db.inquiry.findUnique({ where: { id: inquiryId } });
  if (!inquiry) throw new DomainError('NOT_FOUND', 'Forespørgslen findes ikke.');
  const c = await loadCaseFor(db, actor, inquiry.caseId);
  return { inquiry, c };
}

async function transition(db: Db, inquiryId: string, to: InquiryStatus, actorId: string, data: Record<string, unknown> = {}, reason?: string) {
  const inquiry = await db.inquiry.findUniqueOrThrow({ where: { id: inquiryId } });
  const check = canTransitionInquiry(inquiry.status as InquiryStatus, to);
  if (!check.ok) throw new DomainError('INVALID_STATE', check.reason);
  await db.inquiry.update({ where: { id: inquiryId }, data: { ...data, status: to, updatedAt: await now(db) } });
  await appendEvent(db, {
    objectType: 'Forespørgsel', objectId: inquiryId, caseId: inquiry.caseId, action: `forespoergsel.${to.toLowerCase()}`, actorId,
    source: actorId === 'system' ? 'SYSTEM' : 'BRUGER', before: { status: inquiry.status }, after: { status: to, ...data }, reason,
  });
}

/** K1: forventet modtagelse = svarfrist + instituttets historiske afvigelse fra SLA. */
function expectedResponse(deadline: IsoDate, slaDeviationWorkdays: number): IsoDate {
  const extra = Math.round(slaDeviationWorkdays);
  return extra > 0 ? addWorkdays(deadline, extra) : deadline;
}

async function outboundItem(db: Db, inquiryId: string, fuldmagtId: string | null): Promise<OutboundItem> {
  const inquiry = await db.inquiry.findUniqueOrThrow({ where: { id: inquiryId } });
  const c = await db.case.findUniqueOrThrow({ where: { id: inquiry.caseId } });
  const customer = await db.srcCustomer.findUniqueOrThrow({ where: { id: c.customerId } });
  const inst = await db.institute.findUniqueOrThrow({ where: { id: inquiry.instituteId } });
  const auditor = c.responsibleId ? await db.user.findUnique({ where: { id: c.responsibleId } }) : null;
  const fuldmagt = fuldmagtId ? await db.fuldmagt.findUnique({ where: { id: fuldmagtId } }) : null;
  return {
    inquiryId, reference: inquiry.reference, company: customer.name, cvr: customer.cvr, statementDate: inquiry.statementDate, fuldmagtRef: fuldmagt?.documentRef ?? null,
    letter: inquiryLetter({ company: customer.name, cvr: customer.cvr, institute: inst.name, statementDate: inquiry.statementDate, reference: inquiry.reference, mailbox: CENTRAL_MAILBOX, auditor: auditor?.name ?? 'Opgaveansvarlig revisor', entity: fuldmagt?.holderName ?? 'Cedra' }),
  };
}

/**
 * P07: send en batch. Kun forespørgsler til samme institut og kanal; alle
 * kontroller (VR-01–VR-09) køres igen lige før afsendelse. Idempotent: samme
 * nøgle sender aldrig to gange (dobbeltklik, retry, genstart).
 */
export async function sendBatch(db: Db, actor: Actor, input: { inquiryIds: string[]; idempotencyKey: string | undefined }) {
  assertCan(actor, 'SEND_INQUIRY');
  if (input.inquiryIds.length === 0) throw new DomainError('VALIDATION', 'Vælg mindst én forespørgsel.');
  return withIdempotency(db, input.idempotencyKey, 'afsendelse.batch', async () => {
    const loaded = await Promise.all(input.inquiryIds.map((id) => loadInquiry(db, actor, id)));
    const instituteIds = new Set(loaded.map((l) => l.inquiry.instituteId));
    const channels = new Set(loaded.map((l) => l.inquiry.channel));
    if (instituteIds.size > 1 || channels.size > 1) {
      throw new DomainError('VALIDATION', 'En batch kan kun dannes af forespørgsler til samme institut og kanal.', { recovery: 'Filtrér køen på ét pengeinstitut, og vælg igen.' });
    }
    const date = await today(db);
    const problems: string[] = [];
    const auths = new Map<string, string | null>();
    for (const { inquiry, c } of loaded) {
      assertNotLocked(c);
      if (inquiry.status !== 'KLAR') { problems.push(`${inquiry.reference}: status er ikke "Klar til afsendelse".`); continue; }
      const checks = await inquiryChecks(db, inquiry, date, await paramsAt(db, c.rulesAsOf));
      for (const b of checks.blockers) problems.push(`${inquiry.reference}: ${b.ruleId} ${b.message}`);
      auths.set(inquiry.id, checks.auth.authId);
    }
    if (problems.length) throw new DomainError('INVALID_STATE', 'Batchen kan ikke sendes.', { reasons: problems, recovery: 'Fjern de blokerede forespørgsler fra batchen, eller løs årsagen.' });

    const inst = await db.institute.findUniqueOrThrow({ where: { id: [...instituteIds][0]! } });
    const items = await Promise.all(loaded.map((l) => outboundItem(db, l.inquiry.id, auths.get(l.inquiry.id) ?? null)));
    const result = await dispatch(db, { institute: inst, items, mailbox: CENTRAL_MAILBOX });
    const batchId = newId('batch');
    const at = await now(db);
    await db.batch.create({ data: { id: batchId, instituteId: inst.id, channel: inst.channel, createdById: actor.id, createdAt: at, idempotencyKey: `${input.idempotencyKey}`, receipt: JSON.stringify(result), fileName: result.fileName } });
    for (const { inquiry, c } of loaded) {
      const deadline = responseDeadline(date, c.balanceDate, inst);
      await transition(db, inquiry.id, 'SENDT', actor.id, {
        sentAt: at, sentById: actor.id, batchId, responseDeadline: deadline, expectedResponseDate: expectedResponse(deadline, inst.slaDeviationWorkdays), fuldmagtId: auths.get(inquiry.id) ?? null,
      }, `${result.channelUsed}: ${result.perItem.find((p) => p.inquiryId === inquiry.id)?.receipt}`);
      await archive(db, { caseId: c.id, kind: 'FORESPOERGSEL', title: `Forespørgsel ${inquiry.reference} til ${inst.name}`, cvr: c.cvr, fileName: `${inquiry.reference}.pdf` });
      await closeTasks(db, { type: 'OPG-06', inquiryId: inquiry.id });
    }
    await appendEvent(db, { objectType: 'Batch', objectId: batchId, action: 'batch.sendt', actorId: actor.id, after: { institute: inst.name, channel: inst.channel, count: items.length, summary: result.summary } });
    for (const c of new Set(loaded.map((l) => l.c.id))) await refreshCase(db, c);
    return { batchId, sent: items.length, channel: result.channelUsed, summary: result.summary, fileName: result.fileName };
  });
}

/** OPG-07 / ER-02: rykker sendes via samme kanal; 2. rykker orienterer revisor (daglig opsamling). */
export async function sendReminder(db: Db, actor: Actor, inquiryId: string) {
  assertCan(actor, 'SEND_INQUIRY');
  const { inquiry, c } = await loadInquiry(db, actor, inquiryId);
  assertNotLocked(c);
  if (inquiry.status !== 'SENDT' && inquiry.status !== 'RYKKET') throw new DomainError('INVALID_STATE', 'Der kan kun rykkes for sendte forespørgsler.');
  if (inquiry.reminderCount >= 2) throw new DomainError('INVALID_STATE', 'Der er allerede sendt 2 rykkere.', { owner: 'Opgaveansvarlig revisor', recovery: 'Eskalér til revisor (ER-03).' });
  const date = await today(db);
  if (inquiry.responseDeadline && date <= inquiry.responseDeadline) throw new DomainError('INVALID_STATE', 'Svarfristen er ikke overskredet endnu.');
  const inst = await db.institute.findUniqueOrThrow({ where: { id: inquiry.instituteId } });
  const customer = await db.srcCustomer.findUniqueOrThrow({ where: { id: c.customerId } });
  const number = (inquiry.reminderCount + 1) as 1 | 2;
  const letter = reminderLetter({ number, company: customer.name, cvr: customer.cvr, institute: inst.name, statementDate: inquiry.statementDate, reference: inquiry.reference, sentDate: inquiry.sentAt!.slice(0, 10), replyBy: addWorkdays(date, 5), mailbox: CENTRAL_MAILBOX });
  await dispatch(db, { institute: inst, items: [{ inquiryId, reference: inquiry.reference, company: customer.name, cvr: customer.cvr, statementDate: inquiry.statementDate, letter, fuldmagtRef: null }], mailbox: CENTRAL_MAILBOX });
  await transition(db, inquiryId, 'RYKKET', actor.id, { reminderCount: number, lastReminderAt: await now(db) }, `${number}. rykker (ER-02)`);
  await closeTasks(db, { type: 'OPG-07', inquiryId });
  if (number === 2) {
    await notify(db, { recipientId: c.responsibleId, type: 'RYKKER_2', message: `2. rykker sendt til ${inst.name} for ${customer.name} (${inquiry.reference})`, link: `/sager/${c.id}?fane=forespoergsler`, channels: ['DAGLIG'] });
  }
  await refreshCase(db, c.id);
  return { ok: true, number };
}

/** Afvisning fra instituttet med standardårsag (SOP-EF-05). OPG-08 rettes inden 2 hverdage (ER-04). */
export async function registerRejection(db: Db, actor: Actor, inquiryId: string, input: { reason: RejectionReason; note?: string }) {
  assertCan(actor, 'SEND_INQUIRY');
  const { inquiry, c } = await loadInquiry(db, actor, inquiryId);
  assertNotLocked(c);
  return rejectInquiry(db, actor.id, inquiry.id, input);
}

export async function rejectInquiry(db: Db, actorId: string, inquiryId: string, input: { reason: RejectionReason; note?: string }) {
  const inquiry = await db.inquiry.findUniqueOrThrow({ where: { id: inquiryId } });
  const c = await db.case.findUniqueOrThrow({ where: { id: inquiry.caseId } });
  const params = await paramsAt(db, c.rulesAsOf);
  const date = await today(db);
  await transition(db, inquiryId, 'AFVIST', actorId, { rejectionReason: input.reason, rejectedAt: await now(db) }, `${REJECTION_REASON_LABELS[input.reason]}${input.note ? ` – ${input.note}` : ''}`);
  await closeTasks(db, { type: ['OPG-07', 'OPG-09'], inquiryId });
  const inst = await db.institute.findUniqueOrThrow({ where: { id: inquiry.instituteId } });
  await ensureTask(db, { caseId: c.id, type: 'OPG-08', title: `Ret afvisning fra ${inst.name}: ${REJECTION_REASON_LABELS[input.reason].toLowerCase()}`, role: 'KM', assigneeId: c.coreUserId, dueDate: addWorkdays(date, params.rejectionFixWorkdays), createdByRule: 'ER-04', inquiryId });
  if (input.reason === 'FULDMAGT' && inquiry.fuldmagtId) {
    // TR-04: afvisning pga. fuldmagt udløser ny fuldmagtskontrol.
    const f = await db.fuldmagt.findUnique({ where: { id: inquiry.fuldmagtId } });
    if (f && (f.status === 'GYLDIG' || f.status === 'BOER_FORNYES')) {
      await db.fuldmagt.update({ where: { id: f.id }, data: { status: 'SKAL_FORNYES', invalidReason: `Afvist af ${inst.name}${input.note ? `: ${input.note}` : ''}` } });
      await appendEvent(db, { objectType: 'Fuldmagt', objectId: f.id, action: 'fuldmagt.skal_fornyes', actorId, before: { status: f.status }, after: { status: 'SKAL_FORNYES' }, reason: `Afvisning fra ${inst.name} (TR-04)` });
      await ensureAuthTasks(db, c.id);
    }
  }
  await refreshCase(db, c.id);
  return { ok: true };
}

/** OPG-08: ret og genfremsend. Kontrollerne køres igen; frist og rykkere nulstilles. */
export async function correctAndResend(db: Db, actor: Actor, inquiryId: string, input: { statementDate?: IsoDate; note: string; idempotencyKey: string | undefined }) {
  assertCan(actor, 'SEND_INQUIRY');
  return withIdempotency(db, input.idempotencyKey, 'afsendelse.genfremsend', async () => {
    const { inquiry, c } = await loadInquiry(db, actor, inquiryId);
    assertNotLocked(c);
    if (inquiry.status !== 'AFVIST') throw new DomainError('INVALID_STATE', 'Kun afviste forespørgsler kan genfremsendes.');
    if (!input.note.trim()) throw new DomainError('VALIDATION', 'Beskriv rettelsen.');
    const statementDate = input.statementDate ?? inquiry.statementDate;
    if (statementDate !== inquiry.statementDate) await db.inquiry.update({ where: { id: inquiryId }, data: { statementDate } });
    const date = await today(db);
    const checks = await inquiryChecks(db, { ...inquiry, statementDate, plannedSendDate: date }, date, await paramsAt(db, c.rulesAsOf));
    if (checks.blockers.length) throw new DomainError('INVALID_STATE', 'Forespørgslen kan ikke genfremsendes endnu.', { reasons: checks.blockers.map((b) => `${b.ruleId}: ${b.message}`), recovery: 'Løs årsagen (fx ny fuldmagt) og prøv igen.' });
    const inst = await db.institute.findUniqueOrThrow({ where: { id: inquiry.instituteId } });
    const result = await dispatch(db, { institute: inst, items: [await outboundItem(db, inquiryId, checks.auth.authId)], mailbox: CENTRAL_MAILBOX });
    const deadline = responseDeadline(date, c.balanceDate, inst);
    await transition(db, inquiryId, 'SENDT', actor.id, {
      sentAt: await now(db), sentById: actor.id, responseDeadline: deadline, expectedResponseDate: expectedResponse(deadline, inst.slaDeviationWorkdays), reminderCount: 0, escalatedAt: null, fuldmagtId: checks.auth.authId,
    }, `Genfremsendt: ${input.note} (${result.channelUsed})`);
    await closeTasks(db, { type: 'OPG-08', inquiryId });
    await refreshCase(db, c.id);
    return { ok: true };
  });
}

export async function cancelInquiry(db: Db, actor: Actor, inquiryId: string, reason: string) {
  assertCan(actor, 'CANCEL_INQUIRY');
  const { inquiry, c } = await loadInquiry(db, actor, inquiryId);
  assertNotLocked(c);
  if (!reason.trim()) throw new DomainError('VALIDATION', 'Annullering kræver en begrundelse.');
  await transition(db, inquiryId, 'ANNULLERET', actor.id, { cancelReason: reason.trim() }, reason);
  await closeTasks(db, { inquiryId }, 'ANNULLERET');
  const line = await db.bankListLine.findUnique({ where: { caseId_instituteId: { caseId: c.id, instituteId: inquiry.instituteId } } });
  if (line && inquiry.type === 'AARLIG') await db.bankListLine.update({ where: { id: line.id }, data: { included: false, deselectReason: `Forespørgsel annulleret: ${reason.trim()}` } });
  await refreshCase(db, c.id);
  return { ok: true };
}

/** ER-03: revisor beslutter ved manglende svar – kunden kontakter instituttet, ny frist eller alternative handlinger. */
export async function decideMissingResponse(
  db: Db,
  actor: Actor,
  inquiryId: string,
  input: { decision: 'KUNDE_KONTAKTER' | 'NY_FRIST' | 'ALTERNATIVE'; newDeadline?: IsoDate; note?: string },
) {
  assertCan(actor, 'DECIDE_ALTERNATIVES');
  const { inquiry, c } = await loadInquiry(db, actor, inquiryId);
  assertNotLocked(c);
  if (c.responsibleId !== actor.id) throw new DomainError('FORBIDDEN', 'Kun sagens opgaveansvarlige revisor beslutter (ER-03).');
  if (inquiry.status !== 'SENDT' && inquiry.status !== 'RYKKET') throw new DomainError('INVALID_STATE', 'Forespørgslen venter ikke på svar.');
  const date = await today(db);
  const params = await paramsAt(db, c.rulesAsOf);
  const t = caseTimeline(c.balanceDate, c.plannedSignOff, params);
  const inst = await db.institute.findUniqueOrThrow({ where: { id: inquiry.instituteId } });
  await closeTasks(db, { type: 'OPG-11', inquiryId }); // eskaleringens beslutningsopgave
  if (input.decision === 'ALTERNATIVE') {
    await transition(db, inquiryId, 'UDEN_SVAR', actor.id, { escalatedAt: inquiry.escalatedAt ?? date }, input.note ?? 'Revisor har besluttet alternative handlinger (ISA 505.12)');
    await ensureTask(db, { caseId: c.id, type: 'OPG-11', title: `Dokumentér alternative handlinger for ${inst.name}`, role: 'OR', assigneeId: c.responsibleId, dueDate: t.alternativesDeadline, createdByRule: 'ER-03', inquiryId });
  } else {
    const newDeadline = input.newDeadline ?? addWorkdays(date, 5);
    if (newDeadline <= date) throw new DomainError('VALIDATION', 'Den nye frist skal ligge i fremtiden.');
    await db.inquiry.update({ where: { id: inquiryId }, data: { responseDeadline: newDeadline, expectedResponseDate: newDeadline, escalatedAt: null, updatedAt: await now(db) } });
    await appendEvent(db, { objectType: 'Forespørgsel', objectId: inquiryId, caseId: c.id, action: input.decision === 'KUNDE_KONTAKTER' ? 'forespoergsel.kunde_kontakter' : 'forespoergsel.ny_frist', actorId: actor.id, after: { responseDeadline: newDeadline }, reason: input.note });
    if (input.decision === 'KUNDE_KONTAKTER') {
      const customer = await db.srcCustomer.findUniqueOrThrow({ where: { id: c.customerId } });
      await logCall(db, 'Graph (funktionspostkasse)', 'sendMail', { to: customer.contactEmail, subject: `Bed ${inst.name} besvare revisors forespørgsel ${inquiry.reference}`, note: 'Svaret skal sendes direkte fra banken til revisor.' });
    }
  }
  await refreshCase(db, c.id);
  return { ok: true };
}

/** OPG-11: alternative handlinger dokumenteres (RM forbereder) og godkendes af revisor. */
export async function documentAlternatives(db: Db, actor: Actor, inquiryId: string, input: { text: string }) {
  const { inquiry, c } = await loadInquiry(db, actor, inquiryId);
  assertNotLocked(c);
  if (actor.role !== 'OR' && actor.role !== 'RM') throw new DomainError('FORBIDDEN', 'Alternative handlinger dokumenteres af revisionsteamet.');
  if (inquiry.status !== 'UDEN_SVAR') throw new DomainError('INVALID_STATE', 'Revisor har ikke besluttet alternative handlinger for forespørgslen.');
  if (input.text.trim().length < 20) throw new DomainError('VALIDATION', 'Beskriv de alternative handlinger (mindst 20 tegn).');
  await db.inquiry.update({ where: { id: inquiryId }, data: { alternativeActions: input.text.trim(), updatedAt: await now(db) } });
  await appendEvent(db, { objectType: 'Forespørgsel', objectId: inquiryId, caseId: c.id, action: 'forespoergsel.alternative_dokumenteret', actorId: actor.id, after: { alternativeActions: input.text.trim() } });
  if (actor.role === 'OR' && c.responsibleId === actor.id) {
    await transition(db, inquiryId, 'AFSLUTTET', actor.id, {}, 'Alternative handlinger dokumenteret og godkendt');
    await closeTasks(db, { type: 'OPG-11', inquiryId });
  } else {
    const inst = await db.institute.findUniqueOrThrow({ where: { id: inquiry.instituteId } });
    await ensureTask(db, { caseId: c.id, type: 'OPG-11', title: `Godkend alternative handlinger for ${inst.name}`, role: 'OR', assigneeId: c.responsibleId, dueDate: addWorkdays(await today(db), 2), createdByRule: 'OPG-11', inquiryId });
  }
  await refreshCase(db, c.id);
  return { ok: true };
}

export async function approveAlternatives(db: Db, actor: Actor, inquiryId: string) {
  const { inquiry, c } = await loadInquiry(db, actor, inquiryId);
  if (actor.role !== 'OR' || c.responsibleId !== actor.id) throw new DomainError('FORBIDDEN', 'Kun opgaveansvarlig revisor godkender alternative handlinger.');
  if (!inquiry.alternativeActions) throw new DomainError('INVALID_STATE', 'Der er ikke dokumenteret alternative handlinger.');
  await transition(db, inquiryId, 'AFSLUTTET', actor.id, {}, 'Alternative handlinger godkendt');
  await closeTasks(db, { type: 'OPG-11', inquiryId });
  await refreshCase(db, c.id);
  return { ok: true };
}

/** Bulk i S01: tildel til mig / udskyd. Opgaven har altid én ansvarlig og en frist (K3). */
export async function bulkTasks(db: Db, actor: Actor, input: { inquiryIds: string[]; action: 'TILDEL' | 'UDSKYD'; until?: IsoDate }) {
  if (actor.role !== 'KM' && actor.role !== 'KL') throw new DomainError('FORBIDDEN', 'Kun kerneteamet arbejder i køen.');
  let changed = 0;
  for (const inquiryId of input.inquiryIds) {
    const { c } = await loadInquiry(db, actor, inquiryId);
    const tasks = await db.task.findMany({ where: { inquiryId, status: { in: ['AABEN', 'I_GANG', 'VENTER'] }, role: 'KM' } });
    for (const t of tasks) {
      if (input.action === 'TILDEL') await db.task.update({ where: { id: t.id }, data: { assigneeId: actor.id } });
      else {
        if (!input.until) throw new DomainError('VALIDATION', 'Angiv en dato at udskyde til.');
        await db.task.update({ where: { id: t.id }, data: { snoozedUntil: input.until, status: 'VENTER' } });
      }
      await appendEvent(db, { objectType: 'Opgave', objectId: t.id, caseId: c.id, action: input.action === 'TILDEL' ? 'opgave.tildelt' : 'opgave.udskudt', actorId: actor.id, before: { assigneeId: t.assigneeId }, after: input.action === 'TILDEL' ? { assigneeId: actor.id } : { snoozedUntil: input.until } });
      changed++;
    }
    if (input.action === 'TILDEL' && c.coreUserId !== actor.id) await db.case.update({ where: { id: c.id }, data: { coreUserId: actor.id } });
  }
  return { changed };
}

export async function refreshInquiriesOf(db: Db, caseId: string) {
  for (const i of await db.inquiry.findMany({ where: { caseId, status: { in: ['KLADDE', 'KLAR'] } } })) await refreshInquiry(db, i.id);
}
