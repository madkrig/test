import type { IsoDate } from './dates';
import type { BankTaskStatus, SubtaskStatus } from './statuses';

/** Domæneobjekter (brief afsnit 5). Alle data i prototypen er syntetiske. */

export type Role = 'AUDITOR' | 'KERNE' | 'SERVICE_OWNER' | 'METHOD_QUALITY' | 'SYSTEM_ADMIN';

export interface User {
  id: string;
  name: string;
  role: Role;
}

export interface Customer {
  id: string;
  name: string;
  cvr: string;
  active: boolean;
  responsibleAuditorId: string;
  contactPerson: string;
  groupReference?: string;
}

export type StatementType = 'REVISION' | 'UDVIDET_GENNEMGANG' | 'REVIEW' | 'ANDEN';

export interface Engagement {
  id: string;
  customerId: string;
  legalEntity: string;
  statementType: StatementType;
  periodStart: IsoDate;
  periodEnd: IsoDate;
  statusDate: IsoDate;
  active: boolean;
  responsibleAuditorId: string;
  team: string[];
  professionalDeadline: IsoDate;
}

export type ActivationSource = 'AUDITFLOW' | 'MONTHLY_CONTROL' | 'AD_HOC';

/** Bankbekræftelsessubopgaven – det objekt revisoren ser i AuditFlow. */
export interface BankConfirmationSubtask {
  id: string;
  engagementId: string;
  procedureType: 'BANK_CONFIRMATIONS';
  periodEnd: IsoDate;
  activationSource: ActivationSource;
  status: SubtaskStatus;
  active: boolean;
  currentPopulationVersionId?: string;
  nextAction: string;
  nextOwner: string;
}

export type PopulationChange = 'PROPOSED' | 'ADDED' | 'CHANGED' | 'REMOVED' | 'UNCHANGED';
export type PopulationSource = 'PRIOR_YEAR' | 'R75' | 'ERP' | 'CUSTOMER' | 'AUDITOR';

export interface BankPopulationItem {
  id: string;
  bankId: string;
  bankName: string;
  relationType: string;
  change: PopulationChange;
  sources: PopulationSource[];
  /** Kun historisk reference – aldrig bevis for årets fuldstændighed. */
  priorYearRelation: boolean;
  customerConfirmed: boolean;
  /** Påkrævet når change = REMOVED. */
  removalReason?: string;
  /** Sættes når BankTask er oprettet efter godkendelse. */
  bankTaskId?: string;
}

export type PopulationVersionStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';

export interface BankPopulationVersion {
  id: string;
  subtaskId: string;
  version: number;
  /** Delta-versioner indeholder kun ændringen i forhold til basisversionen. */
  kind: 'FULL' | 'DELTA';
  baseVersionId?: string;
  status: PopulationVersionStatus;
  items: BankPopulationItem[];
  approvedBy?: string;
  approvedAt?: string;
}

export type MethodChannel = 'PLATFORM' | 'UPLOAD_PORTAL' | 'EMAIL' | 'OTHER';
export type MethodVersionStatus = 'DRAFT' | 'ACTIVE' | 'RETIRED';

export interface BankMethodVersion {
  id: string;
  bankId: string;
  version: number;
  channel: MethodChannel;
  urlOrChannel: string;
  requiredFields: string[];
  authorizationRequirement: 'GENERAL' | 'BANK_SPECIFIC';
  expectedResponseWorkdays: number;
  reminderMethod: string;
  escalationContact: string;
  validFrom: IsoDate;
  status: MethodVersionStatus;
  owner: string;
  lastReviewed?: IsoDate;
  changeReason: string;
  /** Sand for en ny eller nyligt ændret metode, der endnu ikke er indkørt. */
  newOrChanged: boolean;
}

export interface Bank {
  id: string;
  name: string;
  country: string;
}

export type AuthorizationStatus = 'MISSING' | 'REQUESTED' | 'RECEIVED' | 'VALID' | 'UNCERTAIN' | 'EXPIRED';

export interface Authorization {
  id: string;
  customerId: string;
  signer: string;
  validFrom: IsoDate;
  validTo: IsoDate;
  coveredBankTaskIds: string[];
  bankRequirement?: string;
  status: AuthorizationStatus;
  /** Atypisk autorisation udløser fire-øjne-kontrol. */
  atypical: boolean;
  /** Dokumentreference i Kernesystemet – ikke SharePoint i MVP. */
  kerneDocumentRef?: string;
}

export interface BankTaskFlags {
  blocked: boolean;
  deadlineExceeded: boolean;
  missingAuthorization: boolean;
  exception: boolean;
  professionalActionRequired: boolean;
  fourEyesRequired: boolean;
}

export interface BankTask {
  id: string;
  subtaskId: string;
  engagementId: string;
  customerId: string;
  bankId: string;
  populationItemId: string;
  status: BankTaskStatus;
  /** Fastholdt metodeversion – ændres ikke, når registeret ændres. */
  methodVersionId: string;
  kerneOwnerId?: string;
  sendDate: IsoDate;
  sentAt?: string;
  reminderCount: number;
  responseId?: string;
  administrativeCheckPassed: boolean;
  fourEyesCompleted: boolean;
  /** Ændring efter godkendelse, der påvirker udsendelsesgrundlaget. */
  changedAfterApproval: boolean;
  /** Revisorbeslutning ved manglende svar eller faglig undtagelse. */
  openProfessionalDecision: boolean;
  flags: BankTaskFlags;
  nextAction: string;
  nextOwner: string;
}

export interface BankResponse {
  id: string;
  bankTaskId: string;
  receivedAt: string;
  channel: MethodChannel;
  originalFileName: string;
  administrativeCheckStatus: 'PENDING' | 'PASSED' | 'FAILED';
  deviations: string[];
  sharePointDocumentId?: string;
  sharePointUrl?: string;
  integrityHash?: string;
}

export type DocumentType = 'BANK_RESPONSE' | 'REQUEST' | 'AUTHORIZATION' | 'EVENT_LOG' | 'DECISION';

export interface EventLogEntry {
  id: string;
  objectType: string;
  objectId: string;
  action: string;
  actor: string;
  at: string;
  change?: string;
  reason?: string;
}
