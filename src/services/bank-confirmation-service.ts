import {
  addWorkdays,
  approvePopulation,
  assertEditable,
  compareDates,
  createBankTasks,
  createDeltaVersion,
  DEFAULT_CONFIG,
  findDuplicateSubtask,
  formatDanish,
  isReviewReady,
  MISSING_RESPONSE_OPTIONS,
  STATUS_LABELS,
  subtaskCompletionBlockers,
  validatePopulationItem,
  type ActivationSource,
  type BankConfirmationSubtask,
  type BankPopulationItem,
  type PopulationChange,
  type PopulationSource,
  type SubtaskStatus,
  type User,
} from '@/domain/bank-confirmations';
import { requireEngagementAccess, requirePermission } from './access';
import { adapters, KERNE_QUEUE } from './adapters';
import { now, today } from './clock';
import { prisma, transaction, type Db } from './db';
import { assertOrThrow, DomainError } from './errors';
import { appendEvent } from './event-log';
import { newId } from './ids';
import { json, toBankTask, toItem, toMethod, toVersion } from './mappers';
import { calendar, recomputeTask, refreshSubtask, timelineFor } from './state';

export interface MutationResult<T> {
  data: T;
  nextAction: string;
  nextOwner: string;
}

const CHANGE_ORDER: Record<PopulationChange, number> = { ADDED: 0, CHANGED: 1, REMOVED: 2, PROPOSED: 3, UNCHANGED: 4 };

async function loadSubtask(db: Db, subtaskId: string) {
  const subtask = await db.subtask.findUnique({ where: { id: subtaskId }, include: { engagement: { include: { customer: true } } } });
  if (!subtask) throw new DomainError('NOT_FOUND', 'Bankbekræftelsessubopgaven findes ikke.');
  return subtask;
}

async function result<T>(db: Db, subtaskId: string, data: T): Promise<MutationResult<T>> {
  const s = await db.subtask.findUniqueOrThrow({ where: { id: subtaskId } });
  return { data, nextAction: s.nextAction, nextOwner: s.nextOwner };
}

/* ---------------- Aktivering (R-01, BR-01) ---------------- */

export async function activate(actor: User, engagementId: string, source: ActivationSource) {
  return transaction(async (tx) => {
    await requirePermission(tx, actor, 'ACTIVATE_SUBTASK');
    await requireEngagementAccess(tx, actor, engagementId);
    const engagement = await tx.engagement.findUniqueOrThrow({ where: { id: engagementId } });
    const existing = await tx.subtask.findMany({ where: { engagementId } });
    const duplicate = findDuplicateSubtask(existing as unknown as BankConfirmationSubtask[], engagementId, engagement.periodEnd);
    if (duplicate) {
      throw new DomainError('CONFLICT', 'Der findes allerede en aktiv bankbekræftelsessubopgave for revisionsopgaven og perioden.', {
        existingId: duplicate.id,
        recovery: 'Åbn den eksisterende subopgave.',
      });
    }
    const id = newId('st');
    const at = now();
    await tx.subtask.create({
      data: {
        id, engagementId, periodEnd: engagement.periodEnd, activationSource: source, status: 'INITIATED_KERNE',
        nextAction: 'Klargør populationsforslag', nextOwner: 'Kerne', createdAt: at, updatedAt: at,
      },
    });
    await tx.populationVersion.create({ data: { id: newId('pv'), subtaskId: id, version: 1, kind: 'FULL', status: 'DRAFT', createdAt: at } });
    await appendEvent(tx, { objectType: 'SUBTASK', objectId: id, subtaskId: id, action: 'ACTIVATED', actorId: actor.id, change: `Kilde: ${source}` });
    await adapters.notifications.notify(tx, KERNE_QUEUE, 'POPULATION_READY', 'Ny bankbekræftelsessubopgave: klargør populationsforslag.', `/kerne/population/${id}`);
    return result(tx, id, { subtaskId: id });
  });
}

/* ---------------- Population ---------------- */

export async function getPopulation(actor: User, subtaskId: string) {
  const subtask = await loadSubtask(prisma, subtaskId);
  await requireEngagementAccess(prisma, actor, subtask.engagementId);
  const rows = await prisma.populationVersion.findMany({ where: { subtaskId }, include: { items: true }, orderBy: { version: 'asc' } });
  const versions = rows.map((r) => ({
    ...toVersion(r),
    items: r.items.map(toItem).sort((a, b) => CHANGE_ORDER[a.change] - CHANGE_ORDER[b.change] || a.bankName.localeCompare(b.bankName, 'da')),
    approvalSnapshot: json(r.approvalSnapshot, null),
    rejectionReason: r.rejectionReason,
  }));
  return { subtaskId, current: versions.at(-1), versions };
}

/** Returnerer en redigerbar version: kladde redigeres direkte; ellers oprettes ny kladdeversion. */
async function editableVersion(tx: Db, subtaskId: string, actor: User) {
  const latest = await tx.populationVersion.findFirst({ where: { subtaskId }, include: { items: true }, orderBy: { version: 'desc' } });
  if (!latest) throw new DomainError('INVALID_STATE', 'Populationen er ikke oprettet. Aktivér subopgaven først.');
  try {
    assertEditable(toVersion(latest));
  } catch (e) {
    throw new DomainError('INVALID_STATE', (e as Error).message, { recovery: 'Opret en delta-ændring.' });
  }
  if (latest.status === 'DRAFT') return latest;
  // Revisor redigerer → ny version klar til egen godkendelse; Kerne → ny kladde.
  const id = newId('pv');
  await tx.populationVersion.create({
    data: {
      id, subtaskId, version: latest.version + 1, kind: latest.kind, baseVersionId: latest.baseVersionId,
      status: actor.role === 'AUDITOR' ? 'SUBMITTED' : 'DRAFT', createdAt: now(),
      items: { create: latest.items.map(({ versionId: _v, id: _id, ...item }) => ({ ...item, id: newId('pi') })) },
    },
  });
  if (latest.status === 'SUBMITTED') {
    await tx.populationVersion.update({ where: { id: latest.id }, data: { status: 'REJECTED', rejectionReason: `Erstattet af version ${latest.version + 1}` } });
  }
  await appendEvent(tx, { objectType: 'POPULATION', objectId: id, subtaskId, action: 'VERSION_CREATED', actorId: actor.id, change: `Version ${latest.version} → ${latest.version + 1}` });
  return tx.populationVersion.findUniqueOrThrow({ where: { id }, include: { items: true } });
}

async function requirePopulationEditor(tx: Db, actor: User, subtask: { engagementId: string }) {
  if (actor.role === 'AUDITOR') await requirePermission(tx, actor, 'EDIT_POPULATION');
  else await requirePermission(tx, actor, 'PREPARE_POPULATION');
  await requireEngagementAccess(tx, actor, subtask.engagementId);
}

export interface ItemInput {
  bankId: string;
  relationType: string;
  sources: PopulationSource[];
  change?: PopulationChange;
  priorYearRelation?: boolean;
  customerConfirmed?: boolean;
}

export async function addItem(actor: User, subtaskId: string, input: ItemInput) {
  return transaction(async (tx) => {
    const subtask = await loadSubtask(tx, subtaskId);
    await requirePopulationEditor(tx, actor, subtask);
    const bank = await tx.bank.findUnique({ where: { id: input.bankId } });
    if (!bank) throw new DomainError('VALIDATION', 'Banken findes ikke i bankregisteret.', { recovery: 'Vælg en bank fra registeret eller bed Service Owner oprette den.' });
    const version = await editableVersion(tx, subtaskId, actor);
    if (version.items.some((i) => i.bankId === input.bankId && i.change !== 'REMOVED')) {
      throw new DomainError('CONFLICT', `${bank.name} findes allerede i populationen.`);
    }
    const item = await tx.populationItem.create({
      data: {
        id: newId('pi'), versionId: version.id, bankId: bank.id, bankName: bank.name, relationType: input.relationType,
        change: input.change ?? 'ADDED', sources: JSON.stringify(input.sources), priorYearRelation: input.priorYearRelation ?? false,
        customerConfirmed: input.customerConfirmed ?? false,
      },
    });
    await appendEvent(tx, { objectType: 'POPULATION', objectId: version.id, subtaskId, action: 'ITEM_ADDED', actorId: actor.id, change: bank.name });
    await refreshSubtask(tx, subtaskId, actor.id);
    return result(tx, subtaskId, { versionId: version.id, item: toItem(item) });
  });
}

export interface ItemPatch {
  relationType?: string;
  sources?: PopulationSource[];
  change?: PopulationChange;
  removalReason?: string;
  customerConfirmed?: boolean;
  auditorDecision?: string;
}

export async function patchItem(actor: User, subtaskId: string, itemId: string, patch: ItemPatch) {
  return transaction(async (tx) => {
    const subtask = await loadSubtask(tx, subtaskId);
    await requirePopulationEditor(tx, actor, subtask);
    const original = await tx.populationItem.findUnique({ where: { id: itemId } });
    if (!original) throw new DomainError('NOT_FOUND', 'Populationselementet findes ikke.');
    const version = await editableVersion(tx, subtaskId, actor);
    // Elementet kan være kopieret til en ny version – find det på bank-id.
    const target = version.items.find((i) => i.id === itemId) ?? version.items.find((i) => i.bankId === original.bankId);
    if (!target) throw new DomainError('NOT_FOUND', 'Populationselementet findes ikke i den redigerbare version.');
    const next = toItem({
      ...target,
      ...(patch.relationType !== undefined ? { relationType: patch.relationType } : {}),
      ...(patch.sources ? { sources: JSON.stringify(patch.sources) } : {}),
      ...(patch.change ? { change: patch.change } : {}),
      ...(patch.removalReason !== undefined ? { removalReason: patch.removalReason } : {}),
      ...(patch.customerConfirmed !== undefined ? { customerConfirmed: patch.customerConfirmed } : {}),
    });
    const blockers = validatePopulationItem(next);
    if (blockers.length) throw new DomainError('VALIDATION', blockers.join(' '), { reasons: blockers });
    const updated = await tx.populationItem.update({
      where: { id: target.id },
      data: {
        relationType: next.relationType, sources: JSON.stringify(next.sources), change: next.change,
        removalReason: next.removalReason ?? null, customerConfirmed: next.customerConfirmed,
        ...(patch.auditorDecision !== undefined ? { auditorDecision: patch.auditorDecision } : {}),
      },
    });
    await appendEvent(tx, {
      objectType: 'POPULATION', objectId: version.id, subtaskId, action: next.change === 'REMOVED' ? 'ITEM_REMOVED' : 'ITEM_CHANGED',
      actorId: actor.id, change: target.bankName, ...(next.removalReason ? { reason: next.removalReason } : {}),
    });
    await refreshSubtask(tx, subtaskId, actor.id);
    return result(tx, subtaskId, { versionId: version.id, item: toItem(updated) });
  });
}

export async function submit(actor: User, subtaskId: string) {
  return transaction(async (tx) => {
    const subtask = await loadSubtask(tx, subtaskId);
    await requirePermission(tx, actor, 'PREPARE_POPULATION');
    const draft = await tx.populationVersion.findFirst({ where: { subtaskId, status: 'DRAFT' }, include: { items: true }, orderBy: { version: 'desc' } });
    if (!draft) throw new DomainError('INVALID_STATE', 'Der er ingen kladde at indsende.');
    const blockers = toVersion(draft).items.flatMap(validatePopulationItem);
    if (draft.kind === 'FULL' && draft.items.filter((i) => i.change !== 'REMOVED').length === 0) {
      blockers.push('Populationen er tom. Indhent kundens samlede bankliste før indsendelse.');
    }
    assertOrThrow(blockers, 'Populationen kan ikke indsendes.', { owner: 'Kerne' });
    await tx.populationVersion.update({ where: { id: draft.id }, data: { status: 'SUBMITTED' } });
    await appendEvent(tx, { objectType: 'POPULATION', objectId: draft.id, subtaskId, action: 'SUBMITTED', actorId: actor.id, change: `Version ${draft.version}` });
    await refreshSubtask(tx, subtaskId, actor.id);
    await adapters.notifications.notify(tx, subtask.engagement.responsibleAuditorId, 'POPULATION_READY', `Verificér bankpopulation for ${subtask.engagement.customer.name}.`, `/auditflow/${subtask.engagementId}`);
    return result(tx, subtaskId, { versionId: draft.id });
  });
}

/* ---------------- Godkendelse (R-05) og delta (R-08) ---------------- */

export async function approve(actor: User, subtaskId: string, versionId: string, db?: Db) {
  const run = async (tx: Db) => {
    const subtask = await loadSubtask(tx, subtaskId);
    await requirePermission(tx, actor, 'APPROVE_POPULATION');
    await requireEngagementAccess(tx, actor, subtask.engagementId);
    const row = await tx.populationVersion.findUnique({ where: { id: versionId }, include: { items: true } });
    if (!row || row.subtaskId !== subtaskId) throw new DomainError('NOT_FOUND', 'Populationsversionen findes ikke.');
    let approved;
    try {
      approved = approvePopulation(toVersion(row), actor, now());
    } catch (e) {
      throw new DomainError('INVALID_STATE', (e as Error).message, { owner: 'Kerne' });
    }
    const timeline = timelineFor(subtask.engagement);
    const minimum = addWorkdays(today(), DEFAULT_CONFIG.deltaLeadWorkdays, calendar);
    const plannedSend = timeline.sendDate.date;
    const sendDate = row.kind === 'DELTA' || compareDates(plannedSend, today()) < 0
      ? (compareDates(plannedSend, minimum) < 0 ? minimum : plannedSend)
      : plannedSend;
    const existingTasks = (await tx.bankTask.findMany({ where: { subtaskId } })).map(toBankTask);
    const methods = (await tx.bankMethodVersion.findMany()).map(toMethod);
    const tasks = createBankTasks(approved, {
      subtask: { id: subtaskId, engagementId: subtask.engagementId } as BankConfirmationSubtask,
      customerId: subtask.engagement.customerId,
      sendDate,
      methods,
      existingTasks,
      newId: () => newId('bt'),
    });
    const snapshot = {
      version: row.version,
      kind: row.kind,
      banks: approved.items.filter((i) => i.change !== 'REMOVED').map((i) => ({ bankId: i.bankId, bankName: i.bankName, change: i.change, sources: i.sources })),
      removed: approved.items.filter((i) => i.change === 'REMOVED').map((i) => ({ bankName: i.bankName, reason: i.removalReason })),
      consequences: [`${tasks.length} BankTask(s) oprettes`, `Autorisation senest ${formatDanish(timeline.authorizationDeadline.date)}`, `Udsendelse ${formatDanish(sendDate)}`],
    };
    await tx.populationVersion.update({
      where: { id: versionId },
      data: { status: 'APPROVED', approvedBy: actor.id, approvedAt: approved.approvedAt ?? now(), approvalSnapshot: JSON.stringify(snapshot) },
    });
    const at = now();
    for (const t of tasks) {
      await tx.bankTask.create({
        data: {
          id: t.id, subtaskId, engagementId: t.engagementId, customerId: t.customerId, bankId: t.bankId, populationItemId: t.populationItemId,
          status: t.status, methodVersionId: t.methodVersionId, sendDate: t.sendDate, changedAfterApproval: t.changedAfterApproval,
          flagBlocked: t.flags.blocked, flagMissingAuthorization: t.flags.missingAuthorization, nextAction: t.nextAction, nextOwner: t.nextOwner,
          createdAt: at, updatedAt: at,
        },
      });
      const item = row.items.find((i) => i.id === t.populationItemId);
      if (item) await tx.populationItem.update({ where: { id: item.id }, data: { bankTaskId: t.id } });
      await appendEvent(tx, { objectType: 'BANK_TASK', objectId: t.id, subtaskId, action: 'CREATED', actorId: 'system', change: `${item?.bankName} · metode ${t.methodVersionId || 'mangler'}` });
      await recomputeTask(tx, t.id);
    }
    await appendEvent(tx, {
      objectType: 'POPULATION', objectId: versionId, subtaskId, action: 'APPROVED', actorId: actor.id,
      change: `Version ${row.version} (${row.kind === 'DELTA' ? 'delta' : 'fuld'}) · ${snapshot.banks.length} bank(er)`,
    });
    await adapters.notifications.notify(tx, KERNE_QUEUE, 'AUTHORIZATION_MISSING', `${tasks.length} nye bankopgaver for ${subtask.engagement.customer.name}: indhent autorisation.`, `/kerne?subtask=${subtaskId}`);
    await refreshSubtask(tx, subtaskId, actor.id);
    return result(tx, subtaskId, { versionId, createdBankTaskIds: tasks.map((t) => t.id), snapshot });
  };
  return db ? run(db) : transaction(run);
}

export async function reject(actor: User, subtaskId: string, versionId: string, reason: string) {
  return transaction(async (tx) => {
    const subtask = await loadSubtask(tx, subtaskId);
    await requirePermission(tx, actor, 'APPROVE_POPULATION');
    await requireEngagementAccess(tx, actor, subtask.engagementId);
    if (!reason.trim()) throw new DomainError('VALIDATION', 'Afvisning kræver begrundelse.');
    const row = await tx.populationVersion.findUnique({ where: { id: versionId } });
    if (!row || row.status !== 'SUBMITTED') throw new DomainError('INVALID_STATE', 'Kun en indsendt version kan afvises.');
    await tx.populationVersion.update({ where: { id: versionId }, data: { status: 'REJECTED', rejectionReason: reason } });
    await appendEvent(tx, { objectType: 'POPULATION', objectId: versionId, subtaskId, action: 'REJECTED', actorId: actor.id, reason });
    await adapters.notifications.notify(tx, KERNE_QUEUE, 'POPULATION_READY', `Population returneret: ${reason}`, `/kerne/population/${subtaskId}`);
    await refreshSubtask(tx, subtaskId, actor.id);
    return result(tx, subtaskId, { versionId });
  });
}

export async function createDelta(actor: User, subtaskId: string, items: ItemInput[]) {
  return transaction(async (tx) => {
    const subtask = await loadSubtask(tx, subtaskId);
    await requirePopulationEditor(tx, actor, subtask);
    if (await tx.populationVersion.findFirst({ where: { subtaskId, status: { in: ['DRAFT', 'SUBMITTED'] } } })) {
      throw new DomainError('CONFLICT', 'Der findes allerede en ikke-godkendt version.', { recovery: 'Færdiggør eller afvis den eksisterende version først.' });
    }
    const base = await tx.populationVersion.findFirst({ where: { subtaskId, status: 'APPROVED' }, include: { items: true }, orderBy: { version: 'desc' } });
    if (!base) throw new DomainError('INVALID_STATE', 'Delta kræver en godkendt population.');
    const banks = await tx.bank.findMany({ where: { id: { in: items.map((i) => i.bankId) } } });
    const newItems: BankPopulationItem[] = items.map((i) => {
      const bank = banks.find((b) => b.id === i.bankId);
      if (!bank) throw new DomainError('VALIDATION', `Ukendt bank: ${i.bankId}`);
      return { id: newId('pi'), bankId: bank.id, bankName: bank.name, relationType: i.relationType, change: 'ADDED', sources: i.sources, priorYearRelation: false, customerConfirmed: i.customerConfirmed ?? false };
    });
    // Bank-id'er fra alle tidligere godkendte versioner tæller som "allerede i populationen".
    const approvedAll = await tx.populationVersion.findMany({ where: { subtaskId, status: 'APPROVED' }, include: { items: true } });
    const combinedBase = { ...toVersion(base), items: approvedAll.flatMap((v) => v.items.map(toItem)) };
    let delta;
    try {
      delta = createDeltaVersion(combinedBase, newItems, newId('pv'));
    } catch (e) {
      throw new DomainError('VALIDATION', (e as Error).message);
    }
    const latestVersion = await tx.populationVersion.findFirstOrThrow({ where: { subtaskId }, orderBy: { version: 'desc' } });
    await tx.populationVersion.create({
      data: {
        id: delta.id, subtaskId, version: latestVersion.version + 1, kind: 'DELTA', baseVersionId: base.id, status: 'SUBMITTED', createdAt: now(),
        items: { create: delta.items.map((i) => ({ id: i.id, bankId: i.bankId, bankName: i.bankName, relationType: i.relationType, change: i.change, sources: JSON.stringify(i.sources), priorYearRelation: false, customerConfirmed: i.customerConfirmed })) },
      },
    });
    const sendDate = addWorkdays(today(), DEFAULT_CONFIG.deltaLeadWorkdays, calendar);
    const timeline = timelineFor(subtask.engagement);
    const consequence = {
      newBankTasks: delta.items.length,
      separateSendDate: compareDates(timeline.sendDate.date, sendDate) > 0 ? timeline.sendDate.date : sendDate,
      existingTasksUnchanged: (await tx.bankTask.count({ where: { subtaskId } })),
    };
    await appendEvent(tx, { objectType: 'POPULATION', objectId: delta.id, subtaskId, action: 'DELTA_CREATED', actorId: actor.id, change: delta.items.map((i) => i.bankName).join(', ') });
    await adapters.notifications.notify(tx, subtask.engagement.responsibleAuditorId, 'POPULATION_READY', `Godkend ændring: ny bank for ${subtask.engagement.customer.name}.`, `/auditflow/${subtask.engagementId}`);
    await refreshSubtask(tx, subtaskId, actor.id);
    return result(tx, subtaskId, { versionId: delta.id, version: latestVersion.version + 1, consequence });
  });
}

/* ---------------- Faglig konklusion og afslutning (R-11, BR-10) ---------------- */

export async function recordConclusion(actor: User, subtaskId: string, conclusion: string) {
  return transaction(async (tx) => {
    const subtask = await loadSubtask(tx, subtaskId);
    await requirePermission(tx, actor, 'RECORD_CONCLUSION');
    await requireEngagementAccess(tx, actor, subtask.engagementId);
    if (!conclusion.trim()) throw new DomainError('VALIDATION', 'Konklusionen må ikke være tom.');
    const tasks = (await tx.bankTask.findMany({ where: { subtaskId } })).map(toBankTask);
    const openDecisions = await tx.decision.count({ where: { subtaskId, status: 'OPEN' } });
    const reasons: string[] = [];
    const notReady = tasks.filter((t) => !isReviewReady(t));
    if (tasks.length === 0) reasons.push('Ingen bankopgaver er oprettet.');
    if (notReady.length) reasons.push(`${notReady.length} bank(er) mangler endelig status.`);
    if (openDecisions) reasons.push(`${openDecisions} faglig(e) beslutning(er) er ikke truffet.`);
    assertOrThrow(reasons, 'Den faglige konklusion kan ikke registreres endnu.', { owner: 'Revisor' });
    await tx.subtask.update({ where: { id: subtaskId }, data: { professionalConclusion: conclusion, conclusionBy: actor.id, conclusionAt: now() } });
    await appendEvent(tx, { objectType: 'SUBTASK', objectId: subtaskId, subtaskId, action: 'CONCLUSION_RECORDED', actorId: actor.id, change: conclusion });
    await refreshSubtask(tx, subtaskId, actor.id);
    return result(tx, subtaskId, { subtaskId });
  });
}

export async function completeSubtask(actor: User, subtaskId: string) {
  return transaction(async (tx) => {
    const subtask = await loadSubtask(tx, subtaskId);
    await requirePermission(tx, actor, 'WORK_BANK_TASK');
    const tasks = (await tx.bankTask.findMany({ where: { subtaskId } })).map(toBankTask);
    const blockers = subtaskCompletionBlockers(tasks, subtask.openReviewNotes, !!subtask.professionalConclusion);
    assertOrThrow(blockers, 'Subopgaven kan ikke fuldføres.', { owner: 'Kerne', recovery: 'Løs de angivne punkter.' });
    await refreshSubtask(tx, subtaskId, actor.id, 'COMPLETED');
    return result(tx, subtaskId, { subtaskId });
  });
}

/* ---------------- Læsemodeller: AuditFlow-visning og reviewpakke ---------------- */

export async function getForEngagement(actor: User, engagementId: string) {
  const db = prisma;
  await requireEngagementAccess(db, actor, engagementId);
  const engagement = await db.engagement.findUniqueOrThrow({ where: { id: engagementId }, include: { customer: true } });
  const subtask = await db.subtask.findFirst({ where: { engagementId, active: true } });
  const timeline = timelineFor(engagement);
  if (!subtask) return { engagement, subtask: null, timeline, canActivate: actor.role === 'AUDITOR' };
  const [population, tasks, decisions] = await Promise.all([
    getPopulation(actor, subtask.id),
    bankTaskViews(db, subtask.id),
    db.decision.findMany({ where: { subtaskId: subtask.id }, orderBy: { createdAt: 'asc' } }),
  ]);
  return {
    engagement,
    subtask: { ...subtask, statusLabel: STATUS_LABELS[subtask.status as SubtaskStatus] },
    timeline,
    population,
    tasks,
    summary: {
      banks: tasks.length,
      sent: tasks.filter((t) => t.sentAt).length,
      received: tasks.filter((t) => t.response).length,
      exceptions: tasks.filter((t) => t.flags.exception || t.openProfessionalDecision).length,
    },
    decisions: decisions.map((d) => ({ ...d, options: json(d.options, []), evidence: json(d.evidence, {}) })),
  };
}

export async function bankTaskViews(db: Db, subtaskId: string) {
  const rows = await db.bankTask.findMany({ where: { subtaskId }, include: { response: true }, orderBy: { createdAt: 'asc' } });
  const banks = await db.bank.findMany();
  const methods = await db.bankMethodVersion.findMany({ where: { id: { in: rows.map((r) => r.methodVersionId) } } });
  return rows.map((r) => {
    const t = toBankTask(r);
    const m = methods.find((x) => x.id === r.methodVersionId);
    return {
      ...t,
      bankName: banks.find((b) => b.id === r.bankId)?.name ?? r.bankId,
      statusLabel: STATUS_LABELS[t.status],
      method: m ? { id: m.id, version: m.version, channel: m.channel } : null,
      nextReminderDate: r.nextReminderDate,
      response: r.response
        ? {
            receivedAt: r.response.receivedAt,
            administrativeCheckStatus: r.response.administrativeCheckStatus,
            deviations: json<string[]>(r.response.deviations, []),
            sharePointDocumentId: r.response.sharePointDocumentId,
            sharePointUrl: r.response.sharePointUrl,
            integrityHash: r.response.integrityHash,
          }
        : null,
    };
  });
}

export async function getReviewPackage(actor: User, subtaskId: string) {
  const db = prisma;
  const subtask = await loadSubtask(db, subtaskId);
  await requireEngagementAccess(db, actor, subtask.engagementId);
  const tasks = await bankTaskViews(db, subtaskId);
  const decisions = await db.decision.findMany({ where: { subtaskId }, orderBy: { createdAt: 'asc' } });
  const domainTasks = (await db.bankTask.findMany({ where: { subtaskId } })).map(toBankTask);
  return {
    subtaskId,
    customer: subtask.engagement.customer.name,
    engagementId: subtask.engagementId,
    coverage: {
      banks: tasks.length,
      received: tasks.filter((t) => t.response).length,
      awaitingBank: tasks.filter((t) => t.status === 'AWAITING_BANK').length,
      exceptions: tasks.filter((t) => t.flags.exception || t.openProfessionalDecision).length,
    },
    banks: tasks.map((t) => ({
      bankTaskId: t.id,
      bank: t.bankName,
      status: t.statusLabel,
      administrativeCheck: t.response?.administrativeCheckStatus ?? null,
      sharePointUrl: t.response?.sharePointUrl ?? null,
      deviations: t.response?.deviations ?? [],
      reviewReady: isReviewReady(domainTasks.find((d) => d.id === t.id)!),
    })),
    openPoints: decisions
      .filter((d) => d.status === 'OPEN')
      .map((d) => ({ decisionId: d.id, bankTaskId: d.bankTaskId, question: d.question, options: json(d.options, []), ownerId: d.ownerId, deadline: d.deadline })),
    decided: decisions.filter((d) => d.status === 'DECIDED').map((d) => ({ decisionId: d.id, question: d.question, chosenOption: d.chosenOption, reason: d.reason, decidedBy: d.decidedBy, decidedAt: d.decidedAt })),
    conclusion: subtask.professionalConclusion,
    completionBlockers: subtaskCompletionBlockers(domainTasks, subtask.openReviewNotes, !!subtask.professionalConclusion),
  };
}

export { MISSING_RESPONSE_OPTIONS };
