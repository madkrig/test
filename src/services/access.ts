import { can, type Action, type User } from '@/domain/bank-confirmations';
import { prisma, type Db } from './db';
import { DomainError } from './errors';
import { appendEvent } from './event-log';
import { json, toUser } from './mappers';

export async function loadActor(db: Db, userId: string | null | undefined): Promise<User> {
  if (!userId) throw new DomainError('FORBIDDEN', 'Bruger ikke angivet.', { recovery: 'Vælg en rolle (header x-user-id).' });
  const row = await db.user.findUnique({ where: { id: userId } });
  if (!row) throw new DomainError('FORBIDDEN', 'Ukendt bruger.');
  return toUser(row);
}

export async function logAccessDenied(actorId: string, action: string): Promise<void> {
  await appendEvent(prisma, { objectType: 'ACCESS', objectId: actorId, action: 'ACCESS_DENIED', actorId, change: action });
}

/**
 * Afvisninger logges uden følsomme objektdetaljer (brief afsnit 20).
 * Inde i en transaktion udskydes logningen til efter rollback (se db.transaction).
 */
async function deny(db: Db, actor: User, action: string): Promise<never> {
  const error = new DomainError('FORBIDDEN', 'Adgang nægtet.', { owner: 'Systemadministrator', recovery: 'Kontakt den ansvarlige for adgang.' });
  if (db === prisma) await logAccessDenied(actor.id, action);
  else Object.assign(error, { deniedAccess: { actorId: actor.id, action } });
  throw error;
}

export async function requirePermission(db: Db, actor: User, action: Action): Promise<void> {
  if (!can(actor.role, action)) await deny(db, actor, action);
}

/** Revisor: kun egne engagementer (ansvarlig eller team). Kerne/Service Owner/System: alle. */
export async function requireEngagementAccess(db: Db, actor: User, engagementId: string): Promise<void> {
  const engagement = await db.engagement.findUnique({ where: { id: engagementId } });
  if (!engagement) throw new DomainError('NOT_FOUND', 'Revisionsopgaven findes ikke.');
  if (actor.role === 'KERNE' || actor.role === 'SERVICE_OWNER' || actor.role === 'SYSTEM') return;
  if (actor.role === 'AUDITOR' && (engagement.responsibleAuditorId === actor.id || json<string[]>(engagement.team, []).includes(actor.id))) return;
  await deny(db, actor, `ENGAGEMENT:${engagementId}`);
}
