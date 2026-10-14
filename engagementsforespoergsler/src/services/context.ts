import {
  can, canSeeCase, grantOf, ROLE_LABELS, resolveParams, type Action, type IsoDate, type Role, type RuleParams, type RuleVersion,
} from '@/domain/ef';
import { today } from './clock';
import type { Db } from './db';
import { DomainError } from './errors';

/** Cedras centrale funktionspostkasse (VR-07). Fast værdi – kan ikke ændres i brugerfladen. */
export const CENTRAL_MAILBOX = 'ef-svar@cedra.example';

export interface Actor {
  id: string;
  name: string;
  initials: string;
  role: Role;
  department: string;
}

export const SYSTEM_ACTOR: Actor = { id: 'system', name: 'EF-service', initials: 'EF', role: 'SYSTEM', department: 'Kerneteam' };

/** Prototype-login: brugeren kommer fra Entra ID-gruppen (her: User-tabellen). */
export async function loadActor(db: Db, userId: string | null): Promise<Actor> {
  if (!userId) throw new DomainError('FORBIDDEN', 'Ingen bruger valgt.', { recovery: 'Vælg en bruger i rollevælgeren.' });
  if (userId === 'system') return SYSTEM_ACTOR;
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new DomainError('FORBIDDEN', `Ukendt bruger "${userId}".`, { recovery: 'Vælg en bruger i rollevælgeren.' });
  return { ...user, role: user.role as Role };
}

/**
 * Rettighedsmatrix (10.3). Agenter må kun læse og foreslå (10.5) – derfor
 * får de en særskilt fejl, der forklarer, at en bruger skal udføre handlingen.
 */
export function assertCan(actor: Actor, action: Action, opts: { delegated?: boolean; proposal?: boolean } = {}): void {
  if (can(actor.role, action, opts)) return;
  if (opts.proposal && grantOf(actor.role, action) === 'F') return; // F = må foreslå (kladde)
  if (actor.role === 'AGENT') {
    throw new DomainError('FORBIDDEN', 'Agenter må kun læse og foreslå. En bruger skal udføre handlingen (10.5).', {
      owner: 'Bruger med rollen i rettighedsmatrixen', recovery: 'Læg forslaget i arbejdskøen, så en bruger kan godkende det.',
    });
  }
  throw new DomainError('FORBIDDEN', `${ROLE_LABELS[actor.role]} må ikke udføre denne handling.`, {
    reasons: [`Handlingen ${action} kræver en anden rolle (rettighedsmatrix 10.3).`],
  });
}

export async function ruleVersions(db: Db): Promise<RuleVersion[]> {
  const rows = await db.rule.findMany();
  return rows.map((r) => ({ ruleId: r.ruleId, version: r.version, params: JSON.parse(r.params), activeFrom: r.activeFrom, activeTo: r.activeTo }));
}

/** Parametre pr. dato. En sag evalueres med det regelsæt, der gjaldt ved oprettelsen (6.8). */
export async function paramsAt(db: Db, date: IsoDate): Promise<RuleParams> {
  return resolveParams(await ruleVersions(db), date);
}

export interface CaseRow {
  id: string;
  customerId: string;
  engagementId: string;
  responsibleId: string | null;
  delegateId: string | null;
  lockedAt: string | null;
}

/** Dataadgang på sagsniveau (10.4): team, habilitet og fortrolighed. */
export async function caseAccessInput(db: Db, c: CaseRow) {
  const [team, conflicts, customer] = await Promise.all([
    db.srcTeamMember.findMany({ where: { engagementId: c.engagementId } }),
    db.srcConflict.findMany({ where: { customerId: c.customerId } }),
    db.srcCustomer.findUnique({ where: { id: c.customerId } }),
  ]);
  return {
    responsibleId: c.responsibleId,
    teamUserIds: team.map((t) => t.userId),
    delegateId: c.delegateId,
    conflictUserIds: conflicts.map((x) => x.userId),
    confidential: customer?.confidential ?? false,
    confidentialUserIds: JSON.parse(customer?.confidentialUserIds ?? '[]') as string[],
  };
}

export async function canActorSeeCase(db: Db, actor: Actor, c: CaseRow): Promise<boolean> {
  return canSeeCase(actor, await caseAccessInput(db, c));
}

/** Henter sagen og afviser, hvis brugeren ikke må se den. Ukendt og skjult giver samme svar. */
export async function loadCaseFor(db: Db, actor: Actor, caseId: string) {
  const c = await db.case.findUnique({ where: { id: caseId } });
  if (!c || !(await canActorSeeCase(db, actor, c))) {
    throw new DomainError('NOT_FOUND', 'Sagen findes ikke, eller du har ikke adgang til den.', {
      recovery: 'Adgang kræver en rolle på sagen og ingen habilitetsspærring (10.4).',
    });
  }
  return c;
}

/** Låste sager er revisionsbevis (P11). Ændringer kræver genåbning. */
export function assertNotLocked(c: { status: string; lockedAt: string | null }): void {
  if (c.lockedAt || c.status === 'LAAST' || c.status === 'KONKLUDERET') {
    throw new DomainError('INVALID_STATE', 'Sagen er konkluderet og låst.', {
      owner: 'Opgaveansvarlig revisor', recovery: 'Genåbn sagen med begrundelse, hvis den skal ændres.',
    });
  }
}

/** Revisor (eller den delegerede revisionsmedarbejder) på sagen pr. dags dato. */
export async function isDelegate(db: Db, actor: Actor, c: { delegateId: string | null; delegateUntil: string | null }) {
  return c.delegateId === actor.id && (!c.delegateUntil || c.delegateUntil >= (await today(db)));
}
