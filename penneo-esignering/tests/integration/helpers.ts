import { NextRequest } from 'next/server';
import { seed } from '@/db/seed';
import { prisma } from '@/services';
import { setPenneoFailure, setSharePointFailure } from '@/services/adapters';
import { setClock } from '@/services/clock';
import * as webhookRoute from '@/app/api/webhooks/penneo/route';

export async function reseed() {
  setPenneoFailure(false);
  setSharePointFailure(false);
  const ids = await seed(prisma);
  setClock('2026-10-05', '09:00:00');
  return ids;
}

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

/** Sender en webhook, som Penneo ville sende den (ingen bruger, headers x-event-*). */
export async function penneoWebhook(body: unknown, opts: { eventId?: string; query?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.eventId) headers['x-event-id'] = opts.eventId;
  const req = new NextRequest(`http://test/api/webhooks/penneo${opts.query ?? ''}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const res = await webhookRoute.POST(req);
  return { status: res.status, json: (await res.json()) as any };
}

export const signerSigned = (id: number) => ({ topic: 'signer', eventType: 'signed', eventTime: { date: '2026-10-05 09:00:00', timezone: 'UTC' }, payload: { id, status: 1 } });
export const caseFile = (eventType: 'completed' | 'rejected', id: number) => ({ topic: 'casefile', eventType, payload: { id, status: eventType === 'completed' ? 5 : 2 } });
