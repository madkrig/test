/**
 * Roller og rettigheder (kap. 10). Agenter må kun læse og foreslå;
 * udfør kræver altid en bruger (10.5).
 */
export const ROLES = ['OR', 'RM', 'KM', 'KL', 'PE', 'ADMIN', 'AGENT', 'SYSTEM'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  OR: 'Opgaveansvarlig revisor',
  RM: 'Revisionsmedarbejder',
  KM: 'Kernemedarbejder',
  KL: 'Kerneteamleder',
  PE: 'Procesejer',
  ADMIN: 'Systemadministrator',
  AGENT: 'AI-agent',
  SYSTEM: 'EF-service',
};

export type Action =
  | 'SEE_QUEUE' | 'SEE_CASES' | 'APPROVE_BANKLIST' | 'EDIT_BANKLIST' | 'SEND_AUTH' | 'VERIFY_MANUAL_AUTH'
  | 'SEND_INQUIRY' | 'REGISTER_RESPONSE' | 'MARK_EXPLAINED' | 'CLOSE_CRITICAL' | 'CONCLUDE' | 'REOPEN'
  | 'CANCEL_INQUIRY' | 'EDIT_REGISTER' | 'APPROVE_CHANNEL_CHANGE' | 'EDIT_RULES' | 'SEE_KPI' | 'ADMIN_ROLES'
  | 'REQUEST_ADHOC' | 'RUN_JOBS' | 'DECIDE_ALTERNATIVES';

/** ✓ = Y · D = kun ved delegering · F = må foreslå (kladde) · L = må læse. */
type Grant = 'Y' | 'D' | 'F' | 'L';

const MATRIX: Record<Action, Partial<Record<Role, Grant>>> = {
  SEE_QUEUE: { KM: 'Y', KL: 'Y' },
  SEE_CASES: { OR: 'Y', RM: 'Y', KM: 'Y', KL: 'Y', PE: 'Y', AGENT: 'L' },
  APPROVE_BANKLIST: { OR: 'Y', RM: 'D' },
  EDIT_BANKLIST: { OR: 'Y', RM: 'Y', KM: 'Y', AGENT: 'F' },
  SEND_AUTH: { KM: 'Y', KL: 'Y', AGENT: 'F' },
  VERIFY_MANUAL_AUTH: { KM: 'Y', KL: 'Y' },
  SEND_INQUIRY: { KM: 'Y', KL: 'Y', AGENT: 'F' },
  REGISTER_RESPONSE: { KM: 'Y', KL: 'Y', AGENT: 'F' },
  MARK_EXPLAINED: { OR: 'Y', RM: 'Y', KM: 'Y', AGENT: 'F' },
  CLOSE_CRITICAL: { OR: 'Y' },
  CONCLUDE: { OR: 'Y' },
  REOPEN: { OR: 'Y' },
  CANCEL_INQUIRY: { OR: 'Y', KM: 'Y', KL: 'Y' },
  EDIT_REGISTER: { KM: 'Y', KL: 'Y' },
  APPROVE_CHANNEL_CHANGE: { KL: 'Y' },
  EDIT_RULES: { PE: 'Y' },
  SEE_KPI: { OR: 'Y', KM: 'Y', KL: 'Y', PE: 'Y', AGENT: 'L' },
  ADMIN_ROLES: { ADMIN: 'Y' },
  REQUEST_ADHOC: { OR: 'Y', RM: 'Y' },
  RUN_JOBS: { KL: 'Y', ADMIN: 'Y', SYSTEM: 'Y' },
  DECIDE_ALTERNATIVES: { OR: 'Y' },
};

/** Må rollen udføre handlingen? Delegering (D) kræver en aktiv delegering på sagen. */
export function can(role: Role, action: Action, opts: { delegated?: boolean } = {}): boolean {
  const grant = MATRIX[action][role];
  if (grant === 'Y') return true;
  if (grant === 'D') return !!opts.delegated;
  return false;
}

export function grantOf(role: Role, action: Action): Grant | null {
  return MATRIX[action][role] ?? null;
}

export interface CaseAccessInput {
  responsibleId: string | null;
  teamUserIds: string[];
  delegateId: string | null;
  conflictUserIds: string[];
  confidential: boolean;
  confidentialUserIds: string[];
}

/** Dataadgang på sagsniveau (10.4). */
export function canSeeCase(user: { id: string; role: Role }, c: CaseAccessInput): boolean {
  if (user.role === 'SYSTEM') return true;
  if (user.role === 'ADMIN') return false;
  if (c.conflictUserIds.includes(user.id)) return false; // habilitetsspærring
  if (c.confidential && !c.confidentialUserIds.includes(user.id)) return false;
  const onCase = c.responsibleId === user.id || c.teamUserIds.includes(user.id) || c.delegateId === user.id;
  if (user.role === 'KM' || user.role === 'KL') return true;
  return onCase; // OR, RM, PE og agenter kun med en rolle på sagen
}
