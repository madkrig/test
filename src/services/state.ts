import {
  authorizationCovers,
  canTransitionSubtask,
  compareDates,
  computeTimeline,
  createCalendar,
  deriveSubtaskStatus,
  formatDanish,
  fourEyesReasons,
  isReviewReady,
  STATUS_LABELS,
  summarizeTasks,
  type BankTask,
  type SubtaskStatus,
} from '@/domain/bank-confirmations';
import { adapters } from './adapters';
import { now, today } from './clock';
import type { Db } from './db';
import { DomainError } from './errors';
import { appendEvent } from './event-log';
import { taskUpdate, toAuthorization, toBankTask, toMethod, toResponse } from './mappers';

export const calendar = createCalendar();

const CHANNEL_LABEL: Record<string, string> = {
  PLATFORM: 'platform',
  UPLOAD_PORTAL: 'uploadportal',
  EMAIL: 'e-mail',
  OTHER: 'anden kanal',
};

export async function loadTaskContext(db: Db, taskId: string) {
  const row = await db.bankTask.findUnique({ where: { id: taskId }, include: { response: true } });
  if (!row) throw new DomainError('NOT_FOUND', 'Bankopgaven findes ikke.');
  const methodRow = row.methodVersionId ? await db.bankMethodVersion.findUnique({ where: { id: row.methodVersionId } }) : null;
  const authRows = await db.authorization.findMany({
    where: { coverage: { some: { bankTaskId: taskId } } },
    include: { coverage: true },
  });
  const engagement = await db.engagement.findUniqueOrThrow({ where: { id: row.engagementId } });
  return {
    row,
    task: toBankTask(row),
    method: methodRow ? toMethod(methodRow) : undefined,
    authorizations: authRows.map(toAuthorization),
    response: row.response ? toResponse(row.response) : undefined,
    engagement,
  };
}

/** Genberegner flag og næste handling ud fra status, metode, autorisation og svar. */
export async function recomputeTask(db: Db, taskId: string): Promise<BankTask> {
  const ctx = await loadTaskContext(db, taskId);
  const { task, method, response } = ctx;
  const day = today();
  const auth = ctx.authorizations.find((a) => authorizationCovers(a, task, day)) ?? ctx.authorizations[0];
  const fourEyes = fourEyesReasons(task, method, auth);
  const flags = {
    ...task.flags,
    blocked: !method || !!ctx.row.blockedReason,
    missingAuthorization: !authorizationCovers(auth, task, day),
    fourEyesRequired: fourEyes.length > 0 && !task.fourEyesCompleted,
    deadlineExceeded: !task.sentAt && compareDates(day, task.sendDate) > 0,
  };
  let nextAction = '–';
  let nextOwner = '–';
  switch (task.status) {
    case 'AWAITING_KERNE':
      nextOwner = 'Kerne';
      if (!method) [nextAction, nextOwner] = ['Bankmetode mangler i bankregisteret', 'Kerne Service Owner'];
      else if (ctx.row.blockedReason) nextAction = ctx.row.blockedReason;
      else if (task.sentAt && !task.responseId) nextAction = 'Afslut efter revisors beslutning';
      else if (task.responseId) nextAction = 'Afslut opgaven';
      else if (flags.missingAuthorization) nextAction = 'Indhent autorisation';
      else if (flags.fourEyesRequired) nextAction = `Fire-øjne-kontrol før udsendelse (${fourEyes.join(', ')})`;
      else nextAction = `Send anmodning via ${CHANNEL_LABEL[method.channel]} · ${formatDanish(task.sendDate)}`;
      break;
    case 'AWAITING_BANK':
      nextOwner = 'Bank';
      nextAction = ctx.row.nextReminderDate ? `Afventer svar · påmindelse ${formatDanish(ctx.row.nextReminderDate)}` : 'Afventer svar';
      break;
    case 'RECEIVED':
      nextOwner = 'Kerne';
      nextAction = task.administrativeCheckPassed ? 'Afslut opgaven' : 'Administrativ kontrol og arkivering';
      break;
    case 'AWAITING_AUDITOR':
      nextOwner = 'Revisor';
      nextAction = 'Faglig beslutning';
      break;
    case 'COMPLETED':
      break;
  }
  if (response && response.administrativeCheckStatus === 'PASSED' && !response.sharePointDocumentId) {
    flags.blocked = true;
    nextAction = 'Arkivering i SharePoint fejlede – prøv igen';
    nextOwner = 'Kerne';
  }
  const updated: BankTask = { ...task, flags, nextAction, nextOwner };
  await db.bankTask.update({ where: { id: taskId }, data: { ...taskUpdate(updated), updatedAt: now() } });
  return updated;
}

function subtaskNext(status: SubtaskStatus, ctx: { pending: boolean; delta: boolean; openDecisions: number; conclusion: boolean; awaitingBank: number; auditorName: string }) {
  switch (status) {
    case 'INITIATED_KERNE': return { nextAction: 'Klargør populationsforslag', nextOwner: 'Kerne' };
    case 'AWAITING_AUDITOR':
      if (ctx.pending) return { nextAction: ctx.delta ? 'Godkend ændring (ny bank)' : 'Verificér bankpopulation', nextOwner: ctx.auditorName };
      if (ctx.openDecisions > 0) return { nextAction: `Træf faglig beslutning (${ctx.openDecisions})`, nextOwner: ctx.auditorName };
      return { nextAction: 'Vurdér reviewpakke og konkludér', nextOwner: ctx.auditorName };
    case 'AWAITING_KERNE':
      return ctx.conclusion
        ? { nextAction: 'Afslut operationelle opgaver', nextOwner: 'Kerne' }
        : { nextAction: 'Indhent autorisation og send anmodninger', nextOwner: 'Kerne' };
    case 'AWAITING_BANK': return { nextAction: `Afventer svar fra ${ctx.awaitingBank} bank(er)`, nextOwner: 'Bank' };
    case 'RECEIVED': return { nextAction: 'Administrativ kontrol af banksvar', nextOwner: 'Kerne' };
    case 'COMPLETED': return { nextAction: '–', nextOwner: '–' };
  }
}

/**
 * Afleder og gemmer subopgavens samlede status, validerer overgangen,
 * logger hændelsen og publicerer status til AuditFlow (mock).
 */
export async function refreshSubtask(db: Db, subtaskId: string, actorId: string, force?: SubtaskStatus) {
  const subtask = await db.subtask.findUniqueOrThrow({ where: { id: subtaskId }, include: { engagement: true } });
  const taskRows = await db.bankTask.findMany({ where: { subtaskId }, include: { response: true } });
  const tasks = taskRows.map(toBankTask);
  const pendingVersion = await db.populationVersion.findFirst({ where: { subtaskId, status: 'SUBMITTED' } });
  const openDecisions = await db.decision.count({ where: { subtaskId, status: 'OPEN' } });
  const current = subtask.status as SubtaskStatus;
  const target = force ?? deriveSubtaskStatus({
    current,
    tasks,
    populationAwaitingApproval: !!pendingVersion,
    openDecisions,
    conclusionRecorded: !!subtask.professionalConclusion,
  });
  if (target !== current) {
    const check = canTransitionSubtask(current, target);
    if (!check.ok) throw new DomainError('INVALID_STATE', check.reason);
  }
  const auditor = await db.user.findUnique({ where: { id: subtask.engagement.responsibleAuditorId } });
  const summary = summarizeTasks(tasks);
  const next = subtaskNext(target, {
    pending: !!pendingVersion,
    delta: pendingVersion?.kind === 'DELTA',
    openDecisions,
    conclusion: !!subtask.professionalConclusion,
    awaitingBank: summary.awaitingBank,
    auditorName: auditor?.name ?? 'Revisor',
  });
  await db.subtask.update({ where: { id: subtaskId }, data: { status: target, ...next, updatedAt: now() } });
  if (target !== current) {
    await appendEvent(db, {
      objectType: 'SUBTASK', objectId: subtaskId, subtaskId, action: 'STATUS_CHANGED', actorId,
      change: `${STATUS_LABELS[current]} → ${STATUS_LABELS[target]}`,
    });
    if (target === 'AWAITING_AUDITOR' && tasks.length > 0 && tasks.every(isReviewReady) && openDecisions === 0) {
      await adapters.notifications.notify(db, subtask.engagement.responsibleAuditorId, 'REVIEW_PACKAGE_READY', 'Reviewpakken for bankbekræftelser er klar.', `/auditflow/${subtask.engagementId}/review`);
    }
  }
  await adapters.auditFlow.publishSubtaskStatus(db, {
    subtaskId,
    engagementId: subtask.engagementId,
    status: target,
    banks: summary.banks,
    received: summary.received,
    exceptions: summary.exceptions,
    responseLinks: taskRows.flatMap((t) => (t.response?.sharePointUrl ? [t.response.sharePointUrl] : [])),
  });
  return { status: target, ...next, summary };
}

export function timelineFor(engagement: { statusDate: string; professionalDeadline: string }) {
  return computeTimeline(engagement.statusDate, engagement.professionalDeadline, calendar);
}
