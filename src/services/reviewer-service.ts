import { bulkApprovalBlockers, formatDanish, type User } from '@/domain/bank-confirmations';
import { requirePermission } from './access';
import { approve } from './bank-confirmation-service';
import { prisma, transaction } from './db';
import { DomainError } from './errors';
import { toVersion } from './mappers';
import { timelineFor } from './state';

/** Porteføljevisning (R-06): egne populationer, der afventer godkendelse. */
export async function portfolio(actor: User) {
  await requirePermission(prisma, actor, 'BULK_APPROVE');
  const engagements = await prisma.engagement.findMany({ where: { responsibleAuditorId: actor.id, active: true }, include: { customer: true, subtasks: true } });
  const rows = [];
  for (const e of engagements) {
    const subtask = e.subtasks.find((s) => s.active);
    if (!subtask) continue;
    const pending = await prisma.populationVersion.findFirst({ where: { subtaskId: subtask.id, status: 'SUBMITTED' }, include: { items: true } });
    if (!pending) continue;
    const version = toVersion(pending);
    const blockers = bulkApprovalBlockers(actor, { version, responsibleAuditorId: e.responsibleAuditorId, openQuestions: subtask.openQuestions });
    rows.push({
      subtaskId: subtask.id,
      versionId: pending.id,
      customer: e.customer.name,
      engagement: `${e.statementType === 'REVISION' ? 'Revision' : 'Udvidet gennemgang'} ${e.periodEnd.slice(0, 4)}`,
      statusDate: formatDanish(e.statusDate),
      banks: version.items.filter((i) => i.change !== 'REMOVED').length,
      changes: version.items.filter((i) => i.change !== 'UNCHANGED').map((i) => `${i.bankName}: ${i.change}`),
      openQuestions: subtask.openQuestions,
      deadline: formatDanish(timelineFor(e).populationDeadline.date),
      kind: version.kind,
      ready: blockers.length === 0,
      blockers,
    });
  }
  return rows;
}

/**
 * Massegodkendelse: én handling, separat approval event pr. engagement.
 * Delvise fejl rapporteres pr. record; gyldige records godkendes alligevel.
 */
export async function bulkApprove(actor: User, items: { subtaskId: string; versionId: string }[], confirmed: boolean) {
  await requirePermission(prisma, actor, 'BULK_APPROVE');
  if (!confirmed) throw new DomainError('VALIDATION', 'Bekræft konsekvensen før massegodkendelse.');
  if (items.length === 0) throw new DomainError('VALIDATION', 'Vælg mindst én population.');
  const results: { subtaskId: string; ok: boolean; createdBankTasks?: number; error?: string }[] = [];
  for (const item of items) {
    try {
      const out = await transaction(async (tx) => {
        const subtask = await tx.subtask.findUniqueOrThrow({ where: { id: item.subtaskId }, include: { engagement: true } });
        const version = await tx.populationVersion.findUniqueOrThrow({ where: { id: item.versionId }, include: { items: true } });
        const blockers = bulkApprovalBlockers(actor, { version: toVersion(version), responsibleAuditorId: subtask.engagement.responsibleAuditorId, openQuestions: subtask.openQuestions });
        if (blockers.length) throw new DomainError('INVALID_STATE', blockers.join(' '));
        return approve(actor, item.subtaskId, item.versionId, tx);
      });
      results.push({ subtaskId: item.subtaskId, ok: true, createdBankTasks: out.data.createdBankTaskIds.length });
    } catch (e) {
      results.push({ subtaskId: item.subtaskId, ok: false, error: (e as Error).message });
    }
  }
  return { data: { results, approved: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length }, nextAction: '–', nextOwner: 'Kerne' };
}
