import {
  addWorkdays,
  decideClarification,
  runCompletenessControl,
  type ClarificationItem,
  type Customer,
  type Engagement,
  type StatementType,
  type User,
} from '@/domain/bank-confirmations';
import { requireEngagementAccess, requirePermission } from './access';
import { adapters } from './adapters';
import { now, today } from './clock';
import { prisma, transaction } from './db';
import { DomainError } from './errors';
import { appendEvent } from './event-log';
import { newId } from './ids';
import { json } from './mappers';
import { activate } from './bank-confirmation-service';
import { calendar } from './state';

/** Separat månedlig kontrol (SO-01). Opretter afklaringer – aldrig bankforespørgsler. */
export async function runControl(actor: User, runDate = today()) {
  return transaction(async (tx) => {
    await requirePermission(tx, actor, 'RUN_COMPLETENESS_CONTROL');
    const customers = await tx.customer.findMany();
    const engagements = await tx.engagement.findMany();
    const subtasks = await tx.subtask.findMany();
    const run = runCompletenessControl(
      runDate,
      customers as Customer[],
      engagements.map((e) => ({ ...e, statementType: e.statementType as StatementType, team: json<string[]>(e.team, []) })) as Engagement[],
      subtasks.map((s) => ({ ...s, procedureType: 'BANK_CONFIRMATIONS' as const })) as never,
      new Set(customers.filter((c) => c.hasHistory).map((c) => c.id)),
    );
    // Allerede åbne afklaringer for samme engagement oprettes ikke igen.
    const open = await tx.completenessItem.findMany({ where: { decision: 'OPEN' } });
    const fresh = run.items.filter((i) => !open.some((o) => o.engagementId === i.engagementId));
    const runId = newId('cr');
    const deadline = addWorkdays(runDate, 10, calendar);
    await tx.completenessRun.create({
      data: {
        id: runId, runDate, windowEnd: run.windowEnd, populationSize: run.populationSize, inWindow: run.inWindow, withSubtask: run.withSubtask,
        createdBy: actor.id, createdAt: now(),
        items: { create: fresh.map((i) => ({ id: newId('ci'), ...i, deadline })) },
      },
    });
    await appendEvent(tx, { objectType: 'COMPLETENESS_RUN', objectId: runId, action: 'RUN', actorId: actor.id, change: `${run.inWindow} i vindue · ${fresh.length} nye afklaringer` });
    for (const i of fresh) {
      await adapters.notifications.notify(tx, i.responsibleAuditorId, 'CLARIFICATION_REQUIRED', 'Tag stilling til bankbekræftelser på en revisionsopgave.', `/auditflow/${i.engagementId}/clarification`);
    }
    return { data: { runId, ...run, newClarifications: fresh.length }, nextAction: fresh.length ? 'Revisorer afklarer' : '–', nextOwner: fresh.length ? 'Revisor' : '–' };
  });
}

export async function listRuns(actor: User) {
  await requirePermission(prisma, actor, 'RUN_COMPLETENESS_CONTROL');
  const runs = await prisma.completenessRun.findMany({ include: { items: true }, orderBy: { createdAt: 'desc' } });
  const engagements = await prisma.engagement.findMany({ include: { customer: true } });
  return runs.map((r) => ({
    ...r,
    items: r.items.map((i) => {
      const e = engagements.find((x) => x.id === i.engagementId);
      return { ...i, customerName: e?.customer.name, statusDate: e?.statusDate };
    }),
  }));
}

export async function decideItem(actor: User, itemId: string, decision: 'OPT_IN' | 'OPT_OUT', reason?: string) {
  const outcome = await transaction(async (tx) => {
    const item = await tx.completenessItem.findUnique({ where: { id: itemId } });
    if (!item) throw new DomainError('NOT_FOUND', 'Afklaringen findes ikke.');
    await requirePermission(tx, actor, 'ACTIVATE_SUBTASK');
    await requireEngagementAccess(tx, actor, item.engagementId);
    let decided: ClarificationItem;
    try {
      decided = decideClarification(item as ClarificationItem, decision, reason);
    } catch (e) {
      throw new DomainError('VALIDATION', (e as Error).message);
    }
    await tx.completenessItem.update({ where: { id: itemId }, data: { decision: decided.decision, optOutReason: decided.optOutReason ?? null, decidedBy: actor.id, decidedAt: now() } });
    await appendEvent(tx, { objectType: 'COMPLETENESS_ITEM', objectId: itemId, action: decision, actorId: actor.id, ...(reason ? { reason } : {}) });
    return item;
  });
  // Tilvalg aktiverer subopgaven med kilde "månedlig kontrol" – stadig ingen BankTasks før populationsgodkendelse.
  if (decision === 'OPT_IN') {
    const activated = await activate(actor, outcome.engagementId, 'MONTHLY_CONTROL');
    return { data: { itemId, subtaskId: activated.data.subtaskId }, nextAction: activated.nextAction, nextOwner: activated.nextOwner };
  }
  return { data: { itemId }, nextAction: '–', nextOwner: '–' };
}
