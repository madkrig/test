import type { User } from '@/domain/bank-confirmations';
import { requirePermission } from './access';
import { prisma, transaction, type Db } from './db';
import { DomainError } from './errors';
import { appendEvent } from './event-log';
import { newId } from './ids';
import { toAuthorization } from './mappers';
import { recomputeTask, refreshSubtask } from './state';

/** Autorisation er et selvstændigt objekt, der kan dække én eller flere bankopgaver (K-05). */
export interface AuthorizationInput {
  customerId: string;
  signer: string;
  validFrom: string;
  validTo: string;
  coveredBankTaskIds: string[];
  status: 'REQUESTED' | 'RECEIVED' | 'VALID' | 'UNCERTAIN' | 'EXPIRED';
  bankRequirement?: string;
  atypical?: boolean;
  validationResult?: string;
  kerneDocumentRef?: string;
}

async function validateCoverage(db: Db, customerId: string, taskIds: string[]) {
  const tasks = await db.bankTask.findMany({ where: { id: { in: taskIds } } });
  if (tasks.length !== taskIds.length) throw new DomainError('VALIDATION', 'En eller flere bankopgaver findes ikke.');
  if (tasks.some((t) => t.customerId !== customerId)) throw new DomainError('VALIDATION', 'Autorisationen kan kun dække kundens egne bankopgaver.');
  return tasks;
}

async function afterChange(db: Db, taskIds: string[], actorId: string) {
  const subtasks = new Set<string>();
  for (const id of taskIds) subtasks.add((await recomputeTask(db, id)).subtaskId);
  for (const s of subtasks) await refreshSubtask(db, s, actorId);
}

export async function listAuthorizations(actor: User, customerId?: string) {
  await requirePermission(prisma, actor, 'WORK_BANK_TASK');
  const rows = await prisma.authorization.findMany({ where: customerId ? { customerId } : {}, include: { coverage: true } });
  return rows.map((r) => ({ ...toAuthorization(r), obtainedAt: r.obtainedAt, validationResult: r.validationResult }));
}

export async function createAuthorization(actor: User, input: AuthorizationInput) {
  return transaction(async (tx) => {
    await requirePermission(tx, actor, 'WORK_BANK_TASK');
    if (input.validTo < input.validFrom) throw new DomainError('VALIDATION', 'Gyldighedsperioden er ugyldig.');
    await validateCoverage(tx, input.customerId, input.coveredBankTaskIds);
    const id = newId('aut');
    await tx.authorization.create({
      data: {
        id, customerId: input.customerId, signer: input.signer, validFrom: input.validFrom, validTo: input.validTo, status: input.status,
        bankRequirement: input.bankRequirement ?? null, atypical: input.atypical ?? false, validationResult: input.validationResult ?? null,
        kerneDocumentRef: input.kerneDocumentRef ?? `KERNE-DOC-${id}`, obtainedAt: input.status === 'VALID' || input.status === 'RECEIVED' ? input.validFrom : null,
        coverage: { create: input.coveredBankTaskIds.map((bankTaskId) => ({ bankTaskId })) },
      },
    });
    await appendEvent(tx, { objectType: 'AUTHORIZATION', objectId: id, action: 'CREATED', actorId: actor.id, change: `${input.status} · dækker ${input.coveredBankTaskIds.join(', ')}` });
    await afterChange(tx, input.coveredBankTaskIds, actor.id);
    const row = await tx.authorization.findUniqueOrThrow({ where: { id }, include: { coverage: true } });
    return { data: toAuthorization(row), nextAction: input.status === 'VALID' ? 'Send anmodning' : 'Validér autorisation', nextOwner: 'Kerne' };
  });
}

export async function patchAuthorization(actor: User, id: string, patch: Partial<Omit<AuthorizationInput, 'customerId'>>) {
  return transaction(async (tx) => {
    await requirePermission(tx, actor, 'WORK_BANK_TASK');
    const existing = await tx.authorization.findUnique({ where: { id }, include: { coverage: true } });
    if (!existing) throw new DomainError('NOT_FOUND', 'Autorisationen findes ikke.');
    const before = existing.coverage.map((c) => c.bankTaskId);
    if (patch.coveredBankTaskIds) {
      await validateCoverage(tx, existing.customerId, patch.coveredBankTaskIds);
      await tx.authorizationCoverage.deleteMany({ where: { authorizationId: id } });
      await tx.authorizationCoverage.createMany({ data: patch.coveredBankTaskIds.map((bankTaskId) => ({ authorizationId: id, bankTaskId })) });
    }
    const { coveredBankTaskIds: _c, ...fields } = patch;
    await tx.authorization.update({ where: { id }, data: fields });
    await appendEvent(tx, { objectType: 'AUTHORIZATION', objectId: id, action: 'CHANGED', actorId: actor.id, change: JSON.stringify(patch) });
    await afterChange(tx, [...new Set([...before, ...(patch.coveredBankTaskIds ?? [])])], actor.id);
    const row = await tx.authorization.findUniqueOrThrow({ where: { id }, include: { coverage: true } });
    return { data: toAuthorization(row), nextAction: '–', nextOwner: 'Kerne' };
  });
}
