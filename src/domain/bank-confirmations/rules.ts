import { DEFAULT_CONFIG, type BankConfirmationConfig } from './config';
import { compareDates, type IsoDate } from './dates';
import type {
  Authorization,
  BankConfirmationSubtask,
  BankMethodVersion,
  BankPopulationItem,
  BankPopulationVersion,
  BankResponse,
  BankTask,
  DocumentType,
  User,
} from './entities';

/** Resultat af en regelkontrol: tom liste = tilladt; ellers konkrete årsager. */
export type Blockers = string[];

/* ---------------- BR-01: dubletkontrol ---------------- */

export function findDuplicateSubtask(
  existing: readonly BankConfirmationSubtask[],
  engagementId: string,
  periodEnd: IsoDate,
): BankConfirmationSubtask | undefined {
  return existing.find(
    (s) => s.active && s.engagementId === engagementId && s.periodEnd === periodEnd && s.procedureType === 'BANK_CONFIRMATIONS',
  );
}

/* ---------------- Population: redigering, godkendelse, delta (BR-03/04/05) ---------------- */

export function validatePopulationItem(item: BankPopulationItem): Blockers {
  const blockers: Blockers = [];
  if (item.change === 'REMOVED' && !item.removalReason?.trim()) blockers.push(`Fjernelse af ${item.bankName} kræver begrundelse.`);
  if (item.sources.length === 0 && item.change !== 'REMOVED') blockers.push(`${item.bankName} mangler datakilde.`);
  return blockers;
}

/** En godkendt version er låst. Ændringer kræver en ny (delta-)version. */
export function assertEditable(version: BankPopulationVersion): void {
  if (version.status === 'APPROVED') {
    throw new Error(`Version ${version.version} er godkendt og låst. Opret en ny version for at ændre populationen.`);
  }
}

export function activeItems(version: BankPopulationVersion): BankPopulationItem[] {
  return version.items.filter((i) => i.change !== 'REMOVED');
}

export function approvalBlockers(version: BankPopulationVersion): Blockers {
  const blockers: Blockers = [];
  if (version.status !== 'SUBMITTED') blockers.push('Kun en indsendt populationsversion kan godkendes.');
  version.items.forEach((i) => blockers.push(...validatePopulationItem(i)));
  if (version.kind === 'FULL' && activeItems(version).length === 0) {
    blockers.push('Populationen indeholder ingen banker. Fravælg bankbekræftelser med begrundelse i stedet.');
  }
  const ids = activeItems(version).map((i) => i.bankId);
  const dup = ids.find((id, idx) => ids.indexOf(id) !== idx);
  if (dup) blockers.push(`Banken ${dup} optræder flere gange i populationen.`);
  return blockers;
}

export function approvePopulation(version: BankPopulationVersion, approver: User, at: string): BankPopulationVersion {
  if (approver.role !== 'AUDITOR') throw new Error('Kun revisor kan godkende populationens fuldstændighed.');
  const blockers = approvalBlockers(version);
  if (blockers.length) throw new Error(blockers.join(' '));
  return { ...version, status: 'APPROVED', approvedBy: approver.id, approvedAt: at, items: version.items.map((i) => ({ ...i })) };
}

/** BR-05: en ny bank efter godkendelse skaber en delta-version med kun ændringen. */
export function createDeltaVersion(
  base: BankPopulationVersion,
  newItems: readonly BankPopulationItem[],
  id: string,
): BankPopulationVersion {
  if (base.status !== 'APPROVED') throw new Error('Delta kan kun oprettes oven på en godkendt version.');
  if (newItems.length === 0) throw new Error('Delta-versionen skal indeholde mindst én ændring.');
  const existing = new Set(activeItems(base).map((i) => i.bankId));
  const clash = newItems.find((i) => existing.has(i.bankId));
  if (clash) throw new Error(`${clash.bankName} findes allerede i den godkendte population.`);
  return {
    id,
    subtaskId: base.subtaskId,
    version: base.version + 1,
    kind: 'DELTA',
    baseVersionId: base.id,
    status: 'SUBMITTED',
    items: newItems.map((i) => ({ ...i, change: 'ADDED' as const })),
  };
}

/* ---------------- BR-02/03/06: én BankTask pr. godkendt bank med fastholdt metode ---------------- */

export function resolveMethodVersion(
  bankId: string,
  methods: readonly BankMethodVersion[],
  onDate: IsoDate,
): BankMethodVersion | undefined {
  return methods
    .filter((m) => m.bankId === bankId && m.status === 'ACTIVE' && compareDates(m.validFrom, onDate) <= 0)
    .sort((a, b) => b.version - a.version)[0];
}

export interface CreateTasksContext {
  subtask: BankConfirmationSubtask;
  customerId: string;
  sendDate: IsoDate;
  methods: readonly BankMethodVersion[];
  existingTasks: readonly BankTask[];
  newId: (item: BankPopulationItem) => string;
}

export function createBankTasks(version: BankPopulationVersion, ctx: CreateTasksContext): BankTask[] {
  if (version.status !== 'APPROVED') throw new Error('BankTasks oprettes først, når revisor har godkendt populationen.');
  const alreadyCovered = new Set(ctx.existingTasks.filter((t) => t.subtaskId === ctx.subtask.id).map((t) => t.bankId));
  const items = version.kind === 'DELTA' ? version.items.filter((i) => i.change === 'ADDED') : activeItems(version);
  return items
    .filter((item) => !alreadyCovered.has(item.bankId))
    .map((item) => {
      const method = resolveMethodVersion(item.bankId, ctx.methods, ctx.sendDate);
      return {
        id: ctx.newId(item),
        subtaskId: ctx.subtask.id,
        engagementId: ctx.subtask.engagementId,
        customerId: ctx.customerId,
        bankId: item.bankId,
        populationItemId: item.id,
        status: 'AWAITING_KERNE' as const,
        methodVersionId: method?.id ?? '',
        sendDate: ctx.sendDate,
        reminderCount: 0,
        administrativeCheckPassed: false,
        fourEyesCompleted: false,
        changedAfterApproval: version.kind === 'DELTA',
        openProfessionalDecision: false,
        flags: {
          blocked: !method,
          deadlineExceeded: false,
          missingAuthorization: true,
          exception: false,
          professionalActionRequired: false,
          fourEyesRequired: false,
        },
        nextAction: method ? 'Indhent autorisation' : 'Bankmetode mangler i bankregisteret',
        nextOwner: method ? 'Kerne' : 'Kerne Service Owner',
      };
    });
}

/* ---------------- BR-07: fire-øjne-kontrol ---------------- */

export function fourEyesReasons(
  task: BankTask,
  method: BankMethodVersion | undefined,
  authorization: Authorization | undefined,
  config: BankConfirmationConfig = DEFAULT_CONFIG,
): string[] {
  const reasons: string[] = [];
  const c = config.fourEyes;
  if (c.manualEmail && method?.channel === 'EMAIL') reasons.push('Manuel e-mail til bank');
  if (c.newOrChangedMethod && method?.newOrChanged) reasons.push('Ny eller ændret bankmetode');
  if (c.changeAfterApprovalAffectingSend && task.changedAfterApproval) reasons.push('Ændring efter populationsgodkendelse');
  if (c.uncertainAuthorization && authorization && (authorization.status === 'UNCERTAIN' || authorization.atypical)) {
    reasons.push('Usikker eller atypisk autorisation');
  }
  return reasons;
}

export function validateFourEyesReviewer(performerId: string, reviewer: User): Blockers {
  const blockers: Blockers = [];
  if (reviewer.id === performerId) blockers.push('Reviewer må ikke være samme person som den, der udfører handlingen.');
  if (reviewer.role !== 'KERNE' && reviewer.role !== 'SERVICE_OWNER') blockers.push('Reviewer skal være Kerne-medarbejder eller Service Owner.');
  return blockers;
}

/* ---------------- Udsendelse (K-05/06/07) ---------------- */

export function authorizationCovers(auth: Authorization | undefined, task: BankTask, onDate: IsoDate): boolean {
  return (
    !!auth &&
    auth.status === 'VALID' &&
    auth.coveredBankTaskIds.includes(task.id) &&
    compareDates(auth.validFrom, onDate) <= 0 &&
    compareDates(onDate, auth.validTo) <= 0
  );
}

export function sendBlockers(
  task: BankTask,
  method: BankMethodVersion | undefined,
  authorization: Authorization | undefined,
  onDate: IsoDate,
  config: BankConfirmationConfig = DEFAULT_CONFIG,
): Blockers {
  const blockers: Blockers = [];
  if (task.sentAt) blockers.push('Anmodningen er allerede sendt (dobbelt udsendelse forhindret).');
  if (task.status !== 'AWAITING_KERNE') blockers.push('Anmodning kan kun sendes, når opgaven afventer Kerne.');
  if (!method || method.id !== task.methodVersionId) blockers.push('Gældende bankmetode mangler på opgaven.');
  if (!authorizationCovers(authorization, task, onDate)) blockers.push('Gyldig autorisation, der dækker banken, mangler.');
  if (fourEyesReasons(task, method, authorization, config).length > 0 && !task.fourEyesCompleted) {
    blockers.push('Fire-øjne-kontrol skal udføres før udsendelse.');
  }
  return blockers;
}

/* ---------------- BR-08: påmindelser og faglig eskalation ---------------- */

export function reminderBlockers(task: BankTask, config: BankConfirmationConfig = DEFAULT_CONFIG): Blockers {
  const blockers: Blockers = [];
  if (task.status !== 'AWAITING_BANK') blockers.push('Påmindelse kan kun sendes, mens opgaven afventer bank.');
  if (task.reminderCount >= config.reminders.maxStandardReminders) {
    blockers.push(`Maksimalt ${config.reminders.maxStandardReminders} standardpåmindelser. Videre håndtering kræver faglig beslutning.`);
  }
  return blockers;
}

/** T-10: fortsat manglende svar på/efter eskalationsdatoen skaber en revisorbeslutning. */
export function requiresProfessionalEscalation(task: BankTask, today: IsoDate, escalationDate: IsoDate): boolean {
  return task.status === 'AWAITING_BANK' && !task.responseId && compareDates(today, escalationDate) >= 0;
}

export const MISSING_RESPONSE_OPTIONS = [
  { id: 'WAIT', label: 'Afvent yderligere' },
  { id: 'ALTERNATIVE_CONTACT', label: 'Bed Kerne eskalere via alternativ kontakt' },
  { id: 'ALTERNATIVE_PROCEDURES', label: 'Iværksæt alternative revisionshandlinger' },
] as const;

/* ---------------- BR-09: dokumentplacering ---------------- */

export function documentLocation(type: DocumentType): 'SHAREPOINT' | 'KERNE' {
  return type === 'BANK_RESPONSE' ? 'SHAREPOINT' : 'KERNE';
}

export function assertSharePointUpload(type: DocumentType): void {
  if (documentLocation(type) !== 'SHAREPOINT') {
    throw new Error('Kun banksvaret må arkiveres i SharePoint. Øvrig dokumentation bliver i Kernesystemet.');
  }
}

/* ---------------- BR-10: afslutningsblokering ---------------- */

export function bankTaskCompletionBlockers(
  task: BankTask,
  response: BankResponse | undefined,
  method: BankMethodVersion | undefined,
  authorization: Authorization | undefined,
  config: BankConfirmationConfig = DEFAULT_CONFIG,
): Blockers {
  const blockers: Blockers = [];
  if (task.openProfessionalDecision || task.flags.professionalActionRequired) blockers.push('Faglig beslutning afventer revisor.');
  if (task.flags.exception) blockers.push('Åben undtagelse.');
  if (fourEyesReasons(task, method, authorization, config).length > 0 && !task.fourEyesCompleted) blockers.push('Påkrævet fire-øjne-kontrol mangler.');
  const alternativeHandled = task.status === 'AWAITING_KERNE' && !task.responseId;
  if (!alternativeHandled) {
    if (!response) blockers.push('Banksvar mangler.');
    else {
      if (response.administrativeCheckStatus !== 'PASSED') blockers.push('Administrativ kontrol er ikke bestået.');
      if (!response.sharePointDocumentId || !response.integrityHash) blockers.push('Banksvaret er ikke arkiveret korrekt i SharePoint.');
    }
  }
  return blockers;
}

export function subtaskCompletionBlockers(
  tasks: readonly BankTask[],
  openReviewNotes: number,
  professionalConclusionRecorded: boolean,
): Blockers {
  const blockers: Blockers = [];
  const notFinal = tasks.filter((t) => t.status !== 'COMPLETED');
  if (tasks.length === 0) blockers.push('Ingen bankopgaver er oprettet.');
  if (notFinal.length) blockers.push(`${notFinal.length} bank(er) mangler endelig status.`);
  if (tasks.some((t) => t.flags.exception || t.openProfessionalDecision)) blockers.push('Faglig undtagelse er ikke behandlet.');
  if (openReviewNotes > 0) blockers.push(`${openReviewNotes} åben(e) review note(r) blokerer afslutning.`);
  if (!professionalConclusionRecorded) blockers.push('Revisors faglige konklusion mangler.');
  return blockers;
}

/* ---------------- R-06: massegodkendelse ---------------- */

export interface BulkApprovalCandidate {
  version: BankPopulationVersion;
  responsibleAuditorId: string;
  openQuestions: number;
}

export function bulkApprovalBlockers(
  user: User,
  candidate: BulkApprovalCandidate,
  config: BankConfirmationConfig = DEFAULT_CONFIG,
): Blockers {
  const blockers: Blockers = [];
  if (!config.bulkApproval.allowedRoles.includes(user.role)) blockers.push('Rollen må ikke massegodkende.');
  if (candidate.responsibleAuditorId !== user.id) blockers.push('Du er ikke ansvarlig revisor på opgaven.');
  if (candidate.openQuestions > 0) blockers.push('Opgaven har åbne spørgsmål.');
  blockers.push(...approvalBlockers(candidate.version));
  return blockers;
}
