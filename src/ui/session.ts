import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Role, User } from '@/domain/bank-confirmations';
import { DomainError, loadActor, prisma } from '@/services';
import { syncDemoClock } from '@/services/demo-service';

/** Prototype-auth: den valgte bruger gemmes i cookien cedra-user (samme som API'et læser). */
export const USER_COOKIE = 'cedra-user';

export function homeFor(role: Role): string {
  if (role === 'AUDITOR') return '/auditflow';
  if (role === 'KERNE' || role === 'SERVICE_OWNER') return '/kerne';
  return '/';
}

export interface Session {
  actor: User;
  today: string;
  users: { id: string; name: string; role: string }[];
  name: (id: string | null | undefined) => string;
}

export async function session(allowed?: Role[]): Promise<Session> {
  const today = await syncDemoClock();
  const id = (await cookies()).get(USER_COOKIE)?.value;
  let actor: User | null = null;
  if (id) actor = await loadActor(prisma, id).catch(() => null);
  if (!actor) redirect('/');
  if (allowed && !allowed.includes(actor.role)) redirect(homeFor(actor.role));
  const users = await prisma.user.findMany({ orderBy: { name: 'asc' } });
  const byId = new Map(users.map((u) => [u.id, u.name]));
  return { actor, today, users, name: (uid) => (uid ? byId.get(uid) ?? uid : '–') };
}

/** Læs data via services; forretningsfejl (fx adgang nægtet) vises i stedet for at crashe siden. */
export async function load<T>(fn: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; error: { code: string; message: string; recovery?: string } }> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof DomainError) return { ok: false, error: { code: e.code, message: e.message, ...(e.details.recovery ? { recovery: e.details.recovery } : {}) } };
    throw e;
  }
}
