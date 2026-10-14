import { now } from './clock';
import type { Db } from './db';

export interface EventInput {
  objectType: string;
  objectId: string;
  subtaskId?: string | null;
  action: string;
  actorId: string;
  change?: string;
  reason?: string;
}

let seq = 0;
/** Tidssorterbart id, så hændelser med samme tidsstempel bevarer rækkefølgen. */
const eventId = () => `ev-${Date.now().toString(36)}-${(seq++ % 1679616).toString(36).padStart(4, '0')}`;

/** Append-only: der findes bevidst ingen update/delete-funktion for hændelser. */
export async function appendEvent(db: Db, input: EventInput) {
  return db.event.create({
    data: {
      id: eventId(),
      objectType: input.objectType,
      objectId: input.objectId,
      subtaskId: input.subtaskId ?? null,
      action: input.action,
      actorId: input.actorId,
      at: now(),
      change: input.change ?? null,
      reason: input.reason ?? null,
    },
  });
}

export async function listEvents(db: Db, filter: { objectType?: string; objectId?: string; subtaskId?: string }) {
  return db.event.findMany({
    where: {
      ...(filter.objectType ? { objectType: filter.objectType } : {}),
      ...(filter.objectId ? { objectId: filter.objectId } : {}),
      ...(filter.subtaskId ? { subtaskId: filter.subtaskId } : {}),
    },
    orderBy: [{ at: 'asc' }, { id: 'asc' }],
  });
}
