import type { Prisma } from '@prisma/client';
import type {
  Authorization,
  BankMethodVersion,
  BankPopulationItem,
  BankPopulationVersion,
  BankResponse,
  BankTask,
  BankTaskStatus,
  MethodChannel,
  PopulationChange,
  PopulationSource,
  PopulationVersionStatus,
  User,
} from '@/domain/bank-confirmations';

type TaskRow = Prisma.BankTaskGetPayload<object>;
type MethodRow = Prisma.BankMethodVersionGetPayload<object>;
type AuthRow = Prisma.AuthorizationGetPayload<{ include: { coverage: true } }>;
type ResponseRow = Prisma.BankResponseGetPayload<object>;
type VersionRow = Prisma.PopulationVersionGetPayload<{ include: { items: true } }>;
type ItemRow = Prisma.PopulationItemGetPayload<object>;

export const json = <T>(value: string | null | undefined, fallback: T): T => (value ? (JSON.parse(value) as T) : fallback);

export function toUser(row: { id: string; name: string; role: string }): User {
  return { id: row.id, name: row.name, role: row.role as User['role'] };
}

export function toBankTask(row: TaskRow): BankTask {
  return {
    id: row.id,
    subtaskId: row.subtaskId,
    engagementId: row.engagementId,
    customerId: row.customerId,
    bankId: row.bankId,
    populationItemId: row.populationItemId,
    status: row.status as BankTaskStatus,
    methodVersionId: row.methodVersionId,
    ...(row.kerneOwnerId ? { kerneOwnerId: row.kerneOwnerId } : {}),
    sendDate: row.sendDate,
    ...(row.sentAt ? { sentAt: row.sentAt } : {}),
    reminderCount: row.reminderCount,
    ...(row.responseId ? { responseId: row.responseId } : {}),
    administrativeCheckPassed: row.administrativeCheckPassed,
    fourEyesCompleted: row.fourEyesCompleted,
    changedAfterApproval: row.changedAfterApproval,
    openProfessionalDecision: row.openProfessionalDecision,
    flags: {
      blocked: row.flagBlocked,
      deadlineExceeded: row.flagDeadlineExceeded,
      missingAuthorization: row.flagMissingAuthorization,
      exception: row.flagException,
      professionalActionRequired: row.flagProfessionalAction,
      fourEyesRequired: row.flagFourEyesRequired,
    },
    nextAction: row.nextAction,
    nextOwner: row.nextOwner,
  };
}

export function toMethod(row: MethodRow): BankMethodVersion {
  return {
    id: row.id,
    bankId: row.bankId,
    version: row.version,
    channel: row.channel as MethodChannel,
    urlOrChannel: row.urlOrChannel,
    requiredFields: json<string[]>(row.requiredFields, []),
    authorizationRequirement: row.authorizationRequirement as BankMethodVersion['authorizationRequirement'],
    expectedResponseWorkdays: row.expectedResponseWorkdays,
    reminderMethod: row.reminderMethod,
    escalationContact: row.escalationContact,
    validFrom: row.validFrom,
    status: row.status as BankMethodVersion['status'],
    owner: row.owner,
    ...(row.lastReviewed ? { lastReviewed: row.lastReviewed } : {}),
    changeReason: row.changeReason,
    newOrChanged: row.newOrChanged,
  };
}

export function toAuthorization(row: AuthRow): Authorization {
  return {
    id: row.id,
    customerId: row.customerId,
    signer: row.signer,
    validFrom: row.validFrom,
    validTo: row.validTo,
    coveredBankTaskIds: row.coverage.map((c) => c.bankTaskId),
    ...(row.bankRequirement ? { bankRequirement: row.bankRequirement } : {}),
    status: row.status as Authorization['status'],
    atypical: row.atypical,
    ...(row.kerneDocumentRef ? { kerneDocumentRef: row.kerneDocumentRef } : {}),
  };
}

export function toResponse(row: ResponseRow): BankResponse {
  return {
    id: row.id,
    bankTaskId: row.bankTaskId,
    receivedAt: row.receivedAt,
    channel: row.channel as MethodChannel,
    originalFileName: row.originalFileName,
    administrativeCheckStatus: row.administrativeCheckStatus as BankResponse['administrativeCheckStatus'],
    deviations: json<string[]>(row.deviations, []),
    ...(row.sharePointDocumentId ? { sharePointDocumentId: row.sharePointDocumentId } : {}),
    ...(row.sharePointUrl ? { sharePointUrl: row.sharePointUrl } : {}),
    ...(row.integrityHash ? { integrityHash: row.integrityHash } : {}),
  };
}

export function toItem(row: ItemRow): BankPopulationItem {
  return {
    id: row.id,
    bankId: row.bankId,
    bankName: row.bankName,
    relationType: row.relationType,
    change: row.change as PopulationChange,
    sources: json<PopulationSource[]>(row.sources, []),
    priorYearRelation: row.priorYearRelation,
    customerConfirmed: row.customerConfirmed,
    ...(row.removalReason ? { removalReason: row.removalReason } : {}),
    ...(row.bankTaskId ? { bankTaskId: row.bankTaskId } : {}),
  };
}

export function toVersion(row: VersionRow): BankPopulationVersion {
  return {
    id: row.id,
    subtaskId: row.subtaskId,
    version: row.version,
    kind: row.kind as BankPopulationVersion['kind'],
    ...(row.baseVersionId ? { baseVersionId: row.baseVersionId } : {}),
    status: row.status as PopulationVersionStatus,
    items: row.items.map(toItem),
    ...(row.approvedBy ? { approvedBy: row.approvedBy } : {}),
    ...(row.approvedAt ? { approvedAt: row.approvedAt } : {}),
  };
}

/** Domæneopgave → kolonner (kun felter, der kan ændres efter oprettelse). */
export function taskUpdate(task: BankTask): Prisma.BankTaskUpdateInput {
  return {
    status: task.status,
    reminderCount: task.reminderCount,
    administrativeCheckPassed: task.administrativeCheckPassed,
    fourEyesCompleted: task.fourEyesCompleted,
    openProfessionalDecision: task.openProfessionalDecision,
    flagBlocked: task.flags.blocked,
    flagDeadlineExceeded: task.flags.deadlineExceeded,
    flagMissingAuthorization: task.flags.missingAuthorization,
    flagException: task.flags.exception,
    flagProfessionalAction: task.flags.professionalActionRequired,
    flagFourEyesRequired: task.flags.fourEyesRequired,
    nextAction: task.nextAction,
    nextOwner: task.nextOwner,
  };
}
