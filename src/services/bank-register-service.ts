import { addMonths, compareDates, DEFAULT_CONFIG, type User } from '@/domain/bank-confirmations';
import { requirePermission } from './access';
import { adapters, SERVICE_OWNER } from './adapters';
import { now, today } from './clock';
import { prisma, transaction } from './db';
import { DomainError } from './errors';
import { appendEvent } from './event-log';
import { newId } from './ids';
import { toMethod } from './mappers';

/** Bankregisteret er den styrende kilde for arbejdsmetoden pr. bank (SO-02). */
export async function listBanks(actor: User) {
  await requirePermission(prisma, actor, 'WORK_BANK_TASK');
  const banks = await prisma.bank.findMany({ include: { methods: true } });
  const reviewCutoff = addMonths(today(), -DEFAULT_CONFIG.bankMethods.reviewIntervalMonths);
  const openTasks = await prisma.bankTask.findMany({ where: { status: { not: 'COMPLETED' } }, select: { bankId: true, methodVersionId: true } });
  const rows = banks.map((b) => {
    const active = b.methods.filter((m) => m.status === 'ACTIVE').sort((a, c) => c.version - a.version)[0];
    const draft = b.methods.find((m) => m.status === 'DRAFT');
    const outdated = !active || !active.lastReviewed || compareDates(active.lastReviewed, reviewCutoff) < 0;
    return {
      id: b.id, name: b.name, country: b.country,
      activeMethod: active ? toMethod(active) : null,
      draft: draft ? { ...toMethod(draft), approvedBy: draft.approvedBy, createdBy: draft.createdBy } : null,
      outdated,
      incomplete: !active,
      openBankTasks: openTasks.filter((t) => t.bankId === b.id).length,
    };
  });
  // Forældede eller ufuldstændige metoder først.
  return rows.sort((a, b) => Number(b.incomplete || b.outdated) - Number(a.incomplete || a.outdated) || a.name.localeCompare(b.name, 'da'));
}

export async function listMethods(actor: User, bankId: string) {
  await requirePermission(prisma, actor, 'WORK_BANK_TASK');
  const methods = await prisma.bankMethodVersion.findMany({ where: { bankId }, orderBy: { version: 'desc' } });
  const tasks = await prisma.bankTask.findMany({ where: { bankId, status: { not: 'COMPLETED' } }, select: { id: true, methodVersionId: true } });
  return methods.map((m) => ({ ...toMethod(m), createdBy: m.createdBy, approvedBy: m.approvedBy, approvedAt: m.approvedAt, openBankTaskIds: tasks.filter((t) => t.methodVersionId === m.id).map((t) => t.id) }));
}

export interface MethodInput {
  channel: 'PLATFORM' | 'UPLOAD_PORTAL' | 'EMAIL' | 'OTHER';
  urlOrChannel: string;
  requiredFields: string[];
  authorizationRequirement: 'GENERAL' | 'BANK_SPECIFIC';
  expectedResponseWorkdays: number;
  reminderMethod: string;
  escalationContact: string;
  validFrom: string;
  changeReason: string;
}

export async function createMethodVersion(actor: User, bankId: string, input: MethodInput) {
  return transaction(async (tx) => {
    await requirePermission(tx, actor, 'MANAGE_BANK_REGISTER');
    if (!input.changeReason.trim()) throw new DomainError('VALIDATION', 'Ændringsbegrundelse er påkrævet.');
    if (await tx.bankMethodVersion.findFirst({ where: { bankId, status: 'DRAFT' } })) {
      throw new DomainError('CONFLICT', 'Banken har allerede et udkast til ny metode.', { recovery: 'Godkend eller kassér det eksisterende udkast.' });
    }
    const latest = await tx.bankMethodVersion.findFirst({ where: { bankId }, orderBy: { version: 'desc' } });
    const id = newId('m');
    await tx.bankMethodVersion.create({
      data: {
        id, bankId, version: (latest?.version ?? 0) + 1, ...input, requiredFields: JSON.stringify(input.requiredFields),
        status: 'DRAFT', owner: actor.name, newOrChanged: true, createdBy: actor.id,
      },
    });
    await appendEvent(tx, { objectType: 'BANK_METHOD', objectId: id, action: 'DRAFT_CREATED', actorId: actor.id, reason: input.changeReason });
    await adapters.notifications.notify(tx, SERVICE_OWNER, 'BANK_METHOD_APPROVAL', 'Ny bankmetode kræver fire-øjne-godkendelse.', `/admin/banks/${bankId}`);
    return { data: { id }, nextAction: 'Fire-øjne-godkendelse', nextOwner: 'Kerne Service Owner (anden person)' };
  });
}

/** Fire-øjne: godkender må ikke være den, der oprettede udkastet. */
export async function approveMethod(actor: User, methodId: string) {
  return transaction(async (tx) => {
    await requirePermission(tx, actor, 'APPROVE_BANK_METHOD');
    const m = await tx.bankMethodVersion.findUnique({ where: { id: methodId } });
    if (!m || m.status !== 'DRAFT') throw new DomainError('INVALID_STATE', 'Kun et udkast kan godkendes.');
    if (m.createdBy === actor.id) throw new DomainError('FORBIDDEN', 'Godkender må ikke være samme person som den, der oprettede metoden.', { recovery: 'Bed en anden Service Owner godkende.' });
    await tx.bankMethodVersion.update({ where: { id: methodId }, data: { approvedBy: actor.id, approvedAt: now() } });
    await appendEvent(tx, { objectType: 'BANK_METHOD', objectId: methodId, action: 'APPROVED', actorId: actor.id });
    return { data: { id: methodId }, nextAction: 'Aktivér metoden', nextOwner: 'Kerne Service Owner' };
  });
}

/** Aktivering udfaser den tidligere version. Åbne BankTasks bevarer deres fastholdte version (BR-06). */
export async function activateMethod(actor: User, methodId: string) {
  return transaction(async (tx) => {
    await requirePermission(tx, actor, 'MANAGE_BANK_REGISTER');
    const m = await tx.bankMethodVersion.findUnique({ where: { id: methodId } });
    if (!m || m.status !== 'DRAFT') throw new DomainError('INVALID_STATE', 'Kun et udkast kan aktiveres.');
    if (!m.approvedBy) throw new DomainError('INVALID_STATE', 'Metoden skal godkendes (fire-øjne) før aktivering.');
    const previous = await tx.bankMethodVersion.findMany({ where: { bankId: m.bankId, status: 'ACTIVE' } });
    await tx.bankMethodVersion.updateMany({ where: { bankId: m.bankId, status: 'ACTIVE' }, data: { status: 'RETIRED' } });
    await tx.bankMethodVersion.update({ where: { id: methodId }, data: { status: 'ACTIVE', lastReviewed: today() } });
    const affected = await tx.bankTask.findMany({ where: { methodVersionId: { in: previous.map((p) => p.id) }, status: { not: 'COMPLETED' } }, select: { id: true } });
    await appendEvent(tx, { objectType: 'BANK_METHOD', objectId: methodId, action: 'ACTIVATED', actorId: actor.id, change: `Udfaset: ${previous.map((p) => `v${p.version}`).join(', ') || 'ingen'}` });
    return { data: { id: methodId, affectedOpenBankTasks: affected.map((a) => a.id), note: 'Åbne opgaver beholder deres oprindelige metodeversion.' }, nextAction: '–', nextOwner: '–' };
  });
}
