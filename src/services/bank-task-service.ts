import {
  addWorkdays,
  assertSharePointUpload,
  authorizationCovers,
  bankTaskCompletionBlockers,
  canTransitionBankTask,
  compareDates,
  DEFAULT_CONFIG,
  formatDanish,
  fourEyesReasons,
  MISSING_RESPONSE_OPTIONS,
  reminderBlockers,
  reminderSchedule,
  requiresProfessionalEscalation,
  sendBlockers,
  STATUS_LABELS,
  validateFourEyesReviewer,
  type BankTask,
  type BankTaskStatus,
  type MethodChannel,
  type User,
} from '@/domain/bank-confirmations';
import { requireEngagementAccess, requirePermission } from './access';
import { adapters, KERNE_QUEUE } from './adapters';
import { now, today } from './clock';
import { prisma, transaction, type Db } from './db';
import { assertOrThrow, DomainError } from './errors';
import { appendEvent, listEvents } from './event-log';
import { withIdempotency } from './idempotency';
import { newId } from './ids';
import { json, toBankTask } from './mappers';
import { calendar, loadTaskContext, recomputeTask, refreshSubtask, timelineFor } from './state';

export const EXCEPTION_OPTIONS = [
  { id: 'NO_ACTION', label: 'Ingen yderligere handling' },
  { id: 'REVIEW_NOTE', label: 'Opret review note til teamet' },
  { id: 'ADDITIONAL_PROCEDURES', label: 'Iværksæt yderligere revisionshandlinger' },
] as const;

async function transition(tx: Db, task: BankTask, to: BankTaskStatus, actorId: string, reason?: string) {
  const check = canTransitionBankTask(task.status, to);
  if (!check.ok) throw new DomainError('INVALID_STATE', check.reason);
  await tx.bankTask.update({ where: { id: task.id }, data: { status: to, updatedAt: now() } });
  await appendEvent(tx, {
    objectType: 'BANK_TASK', objectId: task.id, subtaskId: task.subtaskId, action: 'STATUS_CHANGED', actorId,
    change: `${STATUS_LABELS[task.status]} → ${STATUS_LABELS[to]}`, ...(reason ? { reason } : {}),
  });
}

async function taskResult(tx: Db, taskId: string) {
  const task = await recomputeTask(tx, taskId);
  await refreshSubtask(tx, task.subtaskId, 'system');
  const fresh = await tx.bankTask.findUniqueOrThrow({ where: { id: taskId } });
  return { data: toBankTask(fresh), nextAction: fresh.nextAction, nextOwner: fresh.nextOwner };
}

/* ---------------- Arbejdskø (K-01) ---------------- */

/** Prioritet: blokeret › frist overskredet › autorisation mangler › klar til udsendelse › svar til kontrol › afventer. */
export function queueRank(t: BankTask): number {
  if (t.status === 'COMPLETED') return 9;
  if (t.flags.blocked) return 0;
  if (t.flags.deadlineExceeded) return 1;
  if (t.status === 'AWAITING_KERNE' && t.flags.missingAuthorization && !t.sentAt) return 2;
  if (t.status === 'AWAITING_KERNE' && !t.sentAt) return 3;
  // Modtaget svar (kontrol eller afslutning) og afslutning efter faglig beslutning kræver Kerne nu.
  if (t.status === 'RECEIVED' || t.status === 'AWAITING_KERNE') return 4;
  return 5;
}

export interface QueueQuery {
  status?: BankTaskStatus;
  ownerId?: string;
  bankId?: string;
  flag?: keyof BankTask['flags'];
  includeCompleted?: boolean;
  page?: number;
  pageSize?: number;
}

export async function listBankTasks(actor: User, q: QueueQuery = {}) {
  await requirePermission(prisma, actor, 'WORK_BANK_TASK');
  const rows = await prisma.bankTask.findMany({
    where: {
      ...(q.status ? { status: q.status } : q.includeCompleted ? {} : { status: { not: 'COMPLETED' } }),
      ...(q.ownerId ? { kerneOwnerId: q.ownerId } : {}),
      ...(q.bankId ? { bankId: q.bankId } : {}),
    },
  });
  const [banks, customers, engagements, methods] = await Promise.all([
    prisma.bank.findMany(), prisma.customer.findMany(), prisma.engagement.findMany(), prisma.bankMethodVersion.findMany(),
  ]);
  let items = rows.map((r) => {
    const t = toBankTask(r);
    const e = engagements.find((x) => x.id === r.engagementId);
    const m = methods.find((x) => x.id === r.methodVersionId);
    return {
      ...t,
      rank: queueRank(t),
      customerName: customers.find((c) => c.id === r.customerId)?.name ?? '',
      engagementLabel: e ? `${e.statementType === 'REVISION' ? 'Revision' : 'Udvidet gennemgang'} ${e.periodEnd.slice(0, 4)}` : '',
      bankName: banks.find((b) => b.id === r.bankId)?.name ?? r.bankId,
      statusLabel: STATUS_LABELS[t.status],
      deadline: t.sentAt ? r.nextReminderDate : t.sendDate,
      method: m ? `${m.channel} v${m.version}` : null,
    };
  });
  if (q.flag) items = items.filter((t) => t.flags[q.flag!]);
  items.sort((a, b) => a.rank - b.rank || (a.deadline ?? '').localeCompare(b.deadline ?? '') || a.id.localeCompare(b.id));
  const pageSize = Math.min(q.pageSize ?? 50, 200);
  const page = Math.max(q.page ?? 1, 1);
  return { total: items.length, page, pageSize, items: items.slice((page - 1) * pageSize, page * pageSize) };
}

export async function getBankTask(actor: User, id: string) {
  await requirePermission(prisma, actor, 'WORK_BANK_TASK');
  const ctx = await loadTaskContext(prisma, id);
  const bank = await prisma.bank.findUniqueOrThrow({ where: { id: ctx.task.bankId } });
  const customer = await prisma.customer.findUniqueOrThrow({ where: { id: ctx.task.customerId } });
  return {
    task: { ...ctx.task, statusLabel: STATUS_LABELS[ctx.task.status], nextReminderDate: ctx.row.nextReminderDate, blockedReason: ctx.row.blockedReason },
    bank,
    customer,
    engagement: ctx.engagement,
    method: ctx.method ?? null,
    fourEyesReasons: fourEyesReasons(ctx.task, ctx.method, ctx.authorizations[0]),
    authorizations: ctx.authorizations,
    response: ctx.response ?? null,
    sendBlockers: ctx.task.status === 'AWAITING_KERNE' && !ctx.task.sentAt
      ? sendBlockers(ctx.task, ctx.method, ctx.authorizations.find((a) => authorizationCovers(a, ctx.task, today())), today())
      : [],
    events: await listEvents(prisma, { objectType: 'BANK_TASK', objectId: id }),
  };
}

/* ---------------- Tildeling ---------------- */

export async function assign(actor: User, ids: string[], ownerId: string) {
  return transaction(async (tx) => {
    await requirePermission(tx, actor, 'WORK_BANK_TASK');
    const owner = await tx.user.findUnique({ where: { id: ownerId } });
    if (!owner || (owner.role !== 'KERNE' && owner.role !== 'SERVICE_OWNER')) throw new DomainError('VALIDATION', 'Opgaver kan kun tildeles Kerne-medarbejdere.');
    const results: { id: string; ok: boolean; error?: string }[] = [];
    for (const id of ids) {
      const t = await tx.bankTask.findUnique({ where: { id } });
      if (!t) { results.push({ id, ok: false, error: 'Findes ikke' }); continue; }
      await tx.bankTask.update({ where: { id }, data: { kerneOwnerId: ownerId, updatedAt: now() } });
      await appendEvent(tx, { objectType: 'BANK_TASK', objectId: id, subtaskId: t.subtaskId, action: 'ASSIGNED', actorId: actor.id, change: `${t.kerneOwnerId ?? 'ingen'} → ${ownerId}` });
      results.push({ id, ok: true });
    }
    return { data: results, nextAction: '–', nextOwner: owner.name };
  });
}

/* ---------------- Fire-øjne (BR-07, SO-03) ---------------- */

export async function performFourEyes(actor: User, id: string, performerId: string) {
  return transaction(async (tx) => {
    await requirePermission(tx, actor, 'PERFORM_FOUR_EYES');
    const ctx = await loadTaskContext(tx, id);
    const reasons = fourEyesReasons(ctx.task, ctx.method, ctx.authorizations[0]);
    if (reasons.length === 0) throw new DomainError('INVALID_STATE', 'Fire-øjne-kontrol er ikke påkrævet for opgaven.');
    const blockers = validateFourEyesReviewer(performerId, actor);
    if (blockers.length) throw new DomainError('FORBIDDEN', blockers.join(' '), { recovery: 'Bed en anden Kerne-medarbejder om at udføre kontrollen.' });
    await tx.bankTask.update({ where: { id }, data: { fourEyesCompleted: true, fourEyesReviewerId: actor.id } });
    await appendEvent(tx, { objectType: 'BANK_TASK', objectId: id, subtaskId: ctx.task.subtaskId, action: 'FOUR_EYES_APPROVED', actorId: actor.id, change: `Udført af ${performerId}`, reason: reasons.join(', ') });
    return taskResult(tx, id);
  });
}

/* ---------------- Udsendelse og påmindelser (K-07, K-08) ---------------- */

export async function send(actor: User, id: string, idempotencyKey: string | undefined) {
  return transaction((tx) => withIdempotency(tx, idempotencyKey, `send:${id}`, async () => {
    await requirePermission(tx, actor, 'SEND_REQUEST');
    const ctx = await loadTaskContext(tx, id);
    const auth = ctx.authorizations.find((a) => authorizationCovers(a, ctx.task, today()));
    assertOrThrow(sendBlockers(ctx.task, ctx.method, auth, today()), 'Anmodningen kan ikke sendes.', { owner: 'Kerne' });
    await transition(tx, ctx.task, 'AWAITING_BANK', actor.id);
    const schedule = reminderSchedule(ctx.engagement.statusDate, ctx.method!.expectedResponseWorkdays, calendar);
    await tx.bankTask.update({ where: { id }, data: { sentAt: now(), nextReminderDate: schedule[0] ?? null, kerneOwnerId: ctx.task.kerneOwnerId ?? actor.id } });
    await appendEvent(tx, {
      objectType: 'BANK_TASK', objectId: id, subtaskId: ctx.task.subtaskId, action: 'REQUEST_SENT', actorId: actor.id,
      change: `${ctx.method!.channel} v${ctx.method!.version} · autorisation ${auth!.id}`,
    });
    return taskResult(tx, id);
  }));
}

export async function remind(actor: User, id: string, idempotencyKey: string | undefined) {
  return transaction((tx) => withIdempotency(tx, idempotencyKey, `remind:${id}`, async () => {
    await requirePermission(tx, actor, 'SEND_REMINDER');
    const ctx = await loadTaskContext(tx, id);
    const blockers = reminderBlockers(ctx.task);
    if (ctx.row.nextReminderDate && compareDates(today(), ctx.row.nextReminderDate) < 0) {
      blockers.push(`Påmindelse kan først sendes ${formatDanish(ctx.row.nextReminderDate)} (bankens forventede svartid).`);
    }
    assertOrThrow(blockers, 'Påmindelsen kan ikke sendes.', { owner: 'Kerne' });
    const count = ctx.task.reminderCount + 1;
    const schedule = reminderSchedule(ctx.engagement.statusDate, ctx.method!.expectedResponseWorkdays, calendar);
    await tx.bankTask.update({ where: { id }, data: { reminderCount: count, nextReminderDate: schedule[count] ?? null } });
    await appendEvent(tx, { objectType: 'BANK_TASK', objectId: id, subtaskId: ctx.task.subtaskId, action: 'REMINDER_SENT', actorId: actor.id, change: `Påmindelse ${count} · ${ctx.method!.reminderMethod}` });
    if (count >= DEFAULT_CONFIG.reminders.maxStandardReminders) {
      await adapters.notifications.notify(tx, KERNE_QUEUE, 'REMINDERS_EXHAUSTED', `To påmindelser sendt uden svar (${ctx.task.bankId}).`, `/kerne/bank-tasks/${id}`);
    }
    return taskResult(tx, id);
  }));
}

/* ---------------- Svar, administrativ kontrol og SharePoint (K-09, K-10) ---------------- */

export interface ReceiveInput {
  channel: MethodChannel;
  originalFileName: string;
  metadata?: Record<string, string>;
}

export async function receive(actor: User, id: string, input: ReceiveInput, idempotencyKey: string | undefined) {
  return transaction((tx) => withIdempotency(tx, idempotencyKey, `receive:${id}`, async () => {
    await requirePermission(tx, actor, 'REGISTER_RESPONSE');
    const ctx = await loadTaskContext(tx, id);
    if (ctx.task.responseId) throw new DomainError('CONFLICT', 'Svaret er allerede registreret.');
    await transition(tx, ctx.task, 'RECEIVED', actor.id);
    const responseId = newId('resp');
    await tx.bankResponse.create({
      data: {
        id: responseId, bankTaskId: id, receivedAt: now(), channel: input.channel, originalFileName: input.originalFileName,
        metadata: JSON.stringify(input.metadata ?? {}), administrativeCheckStatus: 'PENDING',
      },
    });
    await tx.bankTask.update({ where: { id }, data: { responseId, nextReminderDate: null } });
    await appendEvent(tx, { objectType: 'BANK_TASK', objectId: id, subtaskId: ctx.task.subtaskId, action: 'RESPONSE_RECEIVED', actorId: actor.id, change: input.originalFileName });
    await adapters.notifications.notify(tx, KERNE_QUEUE, 'RESPONSE_RECEIVED', 'Banksvar modtaget – klar til administrativ kontrol.', `/kerne/bank-tasks/${id}`);
    return taskResult(tx, id);
  }));
}

export interface AdministrativeCheckInput {
  checks?: { entity: boolean; bank: boolean; statusDate: boolean; reference: boolean; readable: boolean; complete: boolean };
  deviations?: string[];
  /** Filindhold (prototype: tekst) – bruges til integritetshash. */
  content?: string;
}

/**
 * Administrativ kontrol + upload af banksvaret til SharePoint.
 * Ved integrationsfejl gemmes tilstanden (blokeret med recovery action), og fejlen returneres derefter.
 */
export async function administrativeCheck(actor: User, id: string, input: AdministrativeCheckInput, idempotencyKey: string | undefined) {
  let integrationError: DomainError | undefined;
  const outcome = await transaction((tx) => withIdempotency(tx, idempotencyKey, `check:${id}`, async () => {
    await requirePermission(tx, actor, 'UPLOAD_RESPONSE');
    const ctx = await loadTaskContext(tx, id);
    const response = ctx.row.response;
    if (ctx.task.status !== 'RECEIVED' || !response) throw new DomainError('INVALID_STATE', 'Administrativ kontrol kræver et modtaget svar.');
    const retry = response.administrativeCheckStatus === 'PASSED' && !response.sharePointDocumentId;
    if (!retry) {
      if (!input.checks) throw new DomainError('VALIDATION', 'Kontrolpunkterne skal udfyldes.');
      const failed = Object.entries(input.checks).filter(([, ok]) => !ok).map(([k]) => k);
      if (failed.length) {
        await tx.bankResponse.update({ where: { id: response.id }, data: { administrativeCheckStatus: 'FAILED', checks: JSON.stringify(input.checks) } });
        await tx.bankTask.update({ where: { id }, data: { blockedReason: `Administrativ kontrol fejlede (${failed.join(', ')}) – indhent korrekt svar fra banken` } });
        await appendEvent(tx, { objectType: 'BANK_TASK', objectId: id, subtaskId: ctx.task.subtaskId, action: 'ADMIN_CHECK_FAILED', actorId: actor.id, change: failed.join(', ') });
        return taskResult(tx, id);
      }
      await tx.bankResponse.update({
        where: { id: response.id },
        data: { administrativeCheckStatus: 'PASSED', checks: JSON.stringify(input.checks), deviations: JSON.stringify(input.deviations ?? []) },
      });
      await appendEvent(tx, { objectType: 'BANK_TASK', objectId: id, subtaskId: ctx.task.subtaskId, action: 'ADMIN_CHECK_PASSED', actorId: actor.id });
    }
    assertSharePointUpload('BANK_RESPONSE');
    try {
      const uploaded = await adapters.sharePoint.uploadBankResponse(tx, {
        customerId: ctx.task.customerId, engagementId: ctx.task.engagementId, fileName: response.originalFileName, content: input.content ?? response.originalFileName,
      });
      await tx.bankResponse.update({ where: { id: response.id }, data: { sharePointDocumentId: uploaded.documentId, sharePointUrl: uploaded.url, integrityHash: uploaded.integrityHash } });
      await tx.bankTask.update({ where: { id }, data: { administrativeCheckPassed: true, blockedReason: null } });
      await appendEvent(tx, { objectType: 'BANK_TASK', objectId: id, subtaskId: ctx.task.subtaskId, action: 'ARCHIVED_SHAREPOINT', actorId: actor.id, change: `${uploaded.documentId} · ${uploaded.integrityHash.slice(0, 15)}…` });
    } catch (e) {
      if (!(e instanceof DomainError) || e.code !== 'INTEGRATION') throw e;
      integrationError = e;
      await tx.bankTask.update({ where: { id }, data: { blockedReason: 'Arkivering i SharePoint fejlede – prøv igen' } });
      await appendEvent(tx, { objectType: 'BANK_TASK', objectId: id, subtaskId: ctx.task.subtaskId, action: 'ARCHIVE_FAILED', actorId: actor.id, reason: e.message });
      return taskResult(tx, id);
    }
    const deviations = json<string[]>((await tx.bankResponse.findUniqueOrThrow({ where: { id: response.id } })).deviations, []);
    if (deviations.length) {
      await openDecision(tx, ctx.task, 'EXCEPTION', `Afvigelse i banksvar: ${deviations.join('; ')}. Hvordan skal det håndteres fagligt?`, EXCEPTION_OPTIONS, { deviations, sharePointUrl: (await tx.bankResponse.findUniqueOrThrow({ where: { id: response.id } })).sharePointUrl }, actor.id);
      await tx.bankTask.update({ where: { id }, data: { flagException: true } });
    }
    return taskResult(tx, id);
  }));
  if (integrationError) throw integrationError;
  return outcome;
}

/* ---------------- Undtagelser og beslutninger (K-11, R-09) ---------------- */

async function openDecision(
  tx: Db, task: BankTask, type: 'MISSING_RESPONSE' | 'EXCEPTION', question: string,
  options: readonly { id: string; label: string }[], evidence: object, actorId: string,
) {
  const engagement = await tx.engagement.findUniqueOrThrow({ where: { id: task.engagementId } });
  const deadline = addWorkdays(today(), DEFAULT_CONFIG.decisionWorkdays, calendar);
  const decisionId = newId('dec');
  await tx.decision.create({
    data: {
      id: decisionId, subtaskId: task.subtaskId, bankTaskId: task.id, type, question, options: JSON.stringify(options),
      evidence: JSON.stringify(evidence), status: 'OPEN', ownerId: engagement.responsibleAuditorId, deadline, createdAt: now(),
    },
  });
  await tx.bankTask.update({ where: { id: task.id }, data: { openProfessionalDecision: true, flagProfessionalAction: type === 'MISSING_RESPONSE' } });
  const fresh = toBankTask(await tx.bankTask.findUniqueOrThrow({ where: { id: task.id } }));
  if (fresh.status !== 'AWAITING_AUDITOR') await transition(tx, fresh, 'AWAITING_AUDITOR', actorId, question);
  await appendEvent(tx, { objectType: 'DECISION', objectId: decisionId, subtaskId: task.subtaskId, action: 'DECISION_REQUESTED', actorId, change: question });
  await adapters.notifications.notify(
    tx, engagement.responsibleAuditorId, type === 'MISSING_RESPONSE' ? 'T10_ESCALATION' : 'EXCEPTION_DECISION',
    type === 'MISSING_RESPONSE' ? 'Manglende banksvar kræver faglig beslutning.' : 'Faglig undtagelse kræver beslutning.',
    `/auditflow/${task.engagementId}/decisions/${decisionId}`,
  );
  return decisionId;
}

export async function escalate(actor: User, id: string, input: { question: string; evidence?: Record<string, unknown> }) {
  return transaction(async (tx) => {
    await requirePermission(tx, actor, 'ESCALATE');
    if (!input.question.trim()) throw new DomainError('VALIDATION', 'Beskriv beslutningsspørgsmålet.');
    const ctx = await loadTaskContext(tx, id);
    await openDecision(tx, ctx.task, 'EXCEPTION', input.question, EXCEPTION_OPTIONS, input.evidence ?? {}, actor.id);
    await tx.bankTask.update({ where: { id }, data: { flagException: true } });
    return taskResult(tx, id);
  });
}

/** T-10: systemet opretter en obligatorisk beslutning ved fortsat manglende svar. Ingen partnereskalation. */
export async function runEscalationCheck(actor: User) {
  return transaction(async (tx) => {
    await requirePermission(tx, actor, 'SEND_REMINDER');
    const rows = await tx.bankTask.findMany({ where: { status: 'AWAITING_BANK' } });
    const escalated: string[] = [];
    for (const row of rows) {
      const task = toBankTask(row);
      const engagement = await tx.engagement.findUniqueOrThrow({ where: { id: row.engagementId } });
      const escalationDate = timelineFor(engagement).professionalEscalation.date;
      if (!requiresProfessionalEscalation(task, today(), escalationDate)) continue;
      if (await tx.decision.findFirst({ where: { bankTaskId: row.id, type: 'MISSING_RESPONSE', status: 'OPEN' } })) continue;
      await openDecision(tx, task, 'MISSING_RESPONSE', 'Banken har ikke svaret. Hvordan skal manglende svar håndteres?', MISSING_RESPONSE_OPTIONS, {
        sentAt: row.sentAt, reminders: row.reminderCount, escalationDate, professionalDeadline: engagement.professionalDeadline,
      }, actor.id);
      await recomputeTask(tx, row.id);
      await refreshSubtask(tx, row.subtaskId, actor.id);
      escalated.push(row.id);
    }
    return { data: { escalated }, nextAction: escalated.length ? 'Revisor træffer beslutning' : '–', nextOwner: escalated.length ? 'Revisor' : '–' };
  });
}

export async function decide(
  actor: User,
  decisionId: string,
  input: { option: string; reason: string; followUpOwnerId?: string; followUpDeadline?: string },
) {
  return transaction(async (tx) => {
    await requirePermission(tx, actor, 'DECIDE_EXCEPTION');
    const decision = await tx.decision.findUnique({ where: { id: decisionId } });
    if (!decision) throw new DomainError('NOT_FOUND', 'Beslutningen findes ikke.');
    const subtask = await tx.subtask.findUniqueOrThrow({ where: { id: decision.subtaskId } });
    await requireEngagementAccess(tx, actor, subtask.engagementId);
    if (decision.status !== 'OPEN') throw new DomainError('CONFLICT', 'Beslutningen er allerede truffet.');
    const options = json<{ id: string }[]>(decision.options, []);
    if (!options.some((o) => o.id === input.option)) throw new DomainError('VALIDATION', 'Ugyldigt valg.');
    if (!input.reason.trim()) throw new DomainError('VALIDATION', 'Begrundelse er påkrævet.');
    await tx.decision.update({
      where: { id: decisionId },
      data: {
        status: 'DECIDED', chosenOption: input.option, reason: input.reason, decidedBy: actor.id, decidedAt: now(),
        followUpOwnerId: input.followUpOwnerId ?? null, followUpDeadline: input.followUpDeadline ?? null,
      },
    });
    await appendEvent(tx, { objectType: 'DECISION', objectId: decisionId, subtaskId: decision.subtaskId, action: 'DECIDED', actorId: actor.id, change: input.option, reason: input.reason });
    if (input.option === 'REVIEW_NOTE') await tx.subtask.update({ where: { id: subtask.id }, data: { openReviewNotes: { increment: 1 } } });
    if (decision.bankTaskId) {
      const task = toBankTask(await tx.bankTask.findUniqueOrThrow({ where: { id: decision.bankTaskId } }));
      await tx.bankTask.update({ where: { id: task.id }, data: { openProfessionalDecision: false, flagProfessionalAction: false, flagException: false } });
      const backToBank = decision.type === 'MISSING_RESPONSE' && (input.option === 'WAIT' || input.option === 'ALTERNATIVE_CONTACT');
      const target: BankTaskStatus = backToBank ? 'AWAITING_BANK' : 'AWAITING_KERNE';
      await transition(tx, task, target, actor.id, input.reason);
      if (input.option === 'ALTERNATIVE_CONTACT') {
        await adapters.notifications.notify(tx, KERNE_QUEUE, 'BLOCKED', 'Revisor beder Kerne eskalere via alternativ kontakt.', `/kerne/bank-tasks/${task.id}`);
      }
      return taskResult(tx, task.id);
    }
    await refreshSubtask(tx, decision.subtaskId, actor.id);
    return { data: { decisionId }, nextAction: '–', nextOwner: '–' };
  });
}

export async function complete(actor: User, id: string) {
  return transaction(async (tx) => {
    await requirePermission(tx, actor, 'WORK_BANK_TASK');
    const ctx = await loadTaskContext(tx, id);
    const auth = ctx.authorizations.find((a) => authorizationCovers(a, ctx.task, ctx.task.sendDate)) ?? ctx.authorizations[0];
    assertOrThrow(bankTaskCompletionBlockers(ctx.task, ctx.response, ctx.method, auth), 'Bankopgaven kan ikke afsluttes.', { owner: 'Kerne' });
    await transition(tx, ctx.task, 'COMPLETED', actor.id);
    return taskResult(tx, id);
  });
}

export async function resolveReviewNote(actor: User, subtaskId: string) {
  return transaction(async (tx) => {
    await requirePermission(tx, actor, 'DECIDE_EXCEPTION');
    const subtask = await tx.subtask.findUniqueOrThrow({ where: { id: subtaskId } });
    await requireEngagementAccess(tx, actor, subtask.engagementId);
    if (subtask.openReviewNotes < 1) throw new DomainError('INVALID_STATE', 'Der er ingen åbne review notes.');
    await tx.subtask.update({ where: { id: subtaskId }, data: { openReviewNotes: { decrement: 1 } } });
    await appendEvent(tx, { objectType: 'SUBTASK', objectId: subtaskId, subtaskId, action: 'REVIEW_NOTE_RESOLVED', actorId: actor.id });
    return { data: { openReviewNotes: subtask.openReviewNotes - 1 }, nextAction: subtask.nextAction, nextOwner: subtask.nextOwner };
  });
}
