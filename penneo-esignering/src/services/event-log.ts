import { randomUUID } from 'node:crypto';
import { now } from './clock';
import type { Db } from './db';

let seq = 0;
/** Sorterbart id, så hændelser i samme sekund bevarer deres rækkefølge. */
function eventId(): string {
  seq = (seq + 1) % 1000;
  return `ev-${Date.now().toString(36)}-${String(seq).padStart(3, '0')}-${randomUUID().slice(0, 4)}`;
}

export interface EventInput {
  objectType: string;
  objectId: string;
  requestId?: string | null;
  action: string;
  actorId: string;
  change?: string;
  reason?: string;
}

/** Append-only: der findes bevidst ingen update/delete-funktion for hændelser. */
export async function appendEvent(db: Db, input: EventInput) {
  return db.event.create({
    data: {
      id: eventId(),
      objectType: input.objectType,
      objectId: input.objectId,
      requestId: input.requestId ?? null,
      action: input.action,
      actorId: input.actorId,
      at: now(),
      change: input.change ?? null,
      reason: input.reason ?? null,
    },
  });
}

export async function listEvents(db: Db, filter: { requestId: string }) {
  return db.event.findMany({ where: { requestId: filter.requestId }, orderBy: [{ at: 'asc' }, { id: 'asc' }] });
}
