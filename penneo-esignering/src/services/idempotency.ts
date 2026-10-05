import { now } from './clock';
import type { Db } from './db';
import { DomainError } from './errors';

/**
 * Idempotency for igangsætning og webhooks: samme nøgle giver samme
 * svar uden at gentage handlingen (dobbeltklik/retry).
 */
export async function withIdempotency<T>(db: Db, key: string | undefined, operation: string, fn: () => Promise<T>): Promise<T> {
  if (!key) throw new DomainError('VALIDATION', 'Idempotency-Key mangler for denne handling.', { recovery: 'Send headeren Idempotency-Key.' });
  const scoped = `${operation}:${key}`;
  const existing = await db.idempotencyKey.findUnique({ where: { key: scoped } });
  if (existing) return JSON.parse(existing.response) as T;
  const result = await fn();
  await db.idempotencyKey.create({ data: { key: scoped, operation, response: JSON.stringify(result), createdAt: now() } });
  return result;
}
