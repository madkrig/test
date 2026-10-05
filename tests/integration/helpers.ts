import { NextRequest } from 'next/server';
import { seed, type SeedState } from '@/db/seed';
import { prisma } from '@/services';
import { loadActor } from '@/services/access';
import { setClock } from '@/services/clock';

export async function reseed(state: SeedState = 'start') {
  const ids = await seed(prisma, state);
  setClock(state === 'brief' ? '2027-01-15' : '2026-11-12');
  return ids;
}

export const actor = (id: string) => loadActor(prisma, id);

/** Kalder en rigtig route handler, som Next.js ville gøre det. */
export async function call(
  mod: Record<string, unknown>,
  method: string,
  url: string,
  opts: { user: string; body?: unknown; params?: Record<string, string>; idempotencyKey?: string },
) {
  const headers: Record<string, string> = { 'x-user-id': opts.user, 'content-type': 'application/json' };
  if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;
  const req = new NextRequest(`http://test${url}`, { method, headers, ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}) });
  const fn = mod[method] as (r: NextRequest, c: { params: Promise<Record<string, string>> }) => Promise<Response>;
  const res = await fn(req, { params: Promise.resolve(opts.params ?? {}) });
  return { status: res.status, json: (await res.json()) as any };
}

export const allChecks = { entity: true, bank: true, statusDate: true, reference: true, readable: true, complete: true };
