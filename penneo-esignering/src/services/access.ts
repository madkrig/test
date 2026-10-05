import type { User, UserRole } from '@/domain/e-signing';
import type { Db } from './db';
import { DomainError } from './errors';
import { appendEvent } from './event-log';

export const SYSTEM_ACTOR = 'system';

export async function loadActor(db: Db, userId: string | null | undefined): Promise<User> {
  if (!userId) throw new DomainError('FORBIDDEN', 'Bruger ikke angivet.', { recovery: 'Vælg en bruger (header x-user-id).' });
  const row = await db.user.findUnique({ where: { id: userId } });
  if (!row) throw new DomainError('FORBIDDEN', 'Ukendt bruger.');
  return { id: row.id, name: row.name, email: row.email, role: row.role as UserRole };
}

/** Afvisninger logges uden følsomme objektdetaljer. */
async function deny(db: Db, actor: User, action: string): Promise<never> {
  await appendEvent(db, { objectType: 'ACCESS', objectId: actor.id, action: 'ACCESS_DENIED', actorId: actor.id, change: action });
  throw new DomainError('FORBIDDEN', 'Adgang nægtet.', { owner: 'Systemadministrator', recovery: 'Kontakt den ansvarlige for adgang.' });
}

/** Revisor: kun kunder, hvor revisor er ansvarlig. */
export async function requireClientAccess(db: Db, actor: User, clientId: string) {
  const client = await db.client.findUnique({ where: { id: clientId } });
  if (!client) throw new DomainError('NOT_FOUND', 'Kunden findes ikke.');
  if (actor.role === 'AUDITOR' && client.responsibleAuditorId === actor.id) return client;
  return deny(db, actor, `CLIENT:${clientId}`);
}

/** Kun revisorer bruger markedspladsen og Opgaver i prototypen. */
export function requireAuditor(actor: User): void {
  if (actor.role !== 'AUDITOR') throw new DomainError('FORBIDDEN', 'Kun revisorer kan bruge e-signering.');
}
