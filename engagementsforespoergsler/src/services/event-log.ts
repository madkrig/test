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
  caseId?: string | null;
  action: string;
  actorId: string;
  onBehalfOf?: string;
  source?: 'BRUGER' | 'SYSTEM' | 'AGENT';
  before?: unknown;
  after?: unknown;
  reason?: string;
}

/** Append-only (K6): der findes bevidst ingen update/delete-funktion for hændelser. */
export async function appendEvent(db: Db, input: EventInput) {
  return db.event.create({
    data: {
      id: eventId(),
      objectType: input.objectType,
      objectId: input.objectId,
      caseId: input.caseId ?? null,
      action: input.action,
      actorId: input.actorId,
      onBehalfOf: input.onBehalfOf ?? null,
      source: input.source ?? (input.actorId === 'system' ? 'SYSTEM' : 'BRUGER'),
      at: await now(db),
      before: input.before === undefined ? null : JSON.stringify(input.before),
      after: input.after === undefined ? null : JSON.stringify(input.after),
      reason: input.reason ?? null,
    },
  });
}
