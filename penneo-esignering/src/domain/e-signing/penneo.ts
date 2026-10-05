/**
 * Penneos begreber (developer.penneo.com, "Penneo core concepts"):
 * en case file samler dokumenter og underskrivere; signaturlinjer kobler en
 * underskriver til et dokument med en rolle; signing requests er e-mailen til
 * underskriveren. Status på en case file er et tal.
 */
export const PENNEO_CASEFILE_STATUS = {
  NEW: 0,
  PENDING: 1,
  REJECTED: 2,
  DELETED: 3,
  SIGNED: 4,
  COMPLETED: 5,
} as const;

export const PENNEO_STATUS_LABELS: Record<number, string> = {
  0: 'new',
  1: 'pending',
  2: 'rejected',
  3: 'deleted',
  4: 'signed',
  5: 'completed',
};

/** Webhook-payload som Penneo sender den (topic + eventType, id og status). */
export interface PenneoWebhook {
  topic: string;
  eventType: string;
  eventTime?: unknown;
  payload: { id: number; status?: number };
}

/**
 * De hændelser, prototypen reagerer på; øvrige logges og ignoreres. Vi styrer
 * efter eventType frem for payload.status, da status-feltet i Penneos
 * eksempler ikke altid svarer til hændelsen.
 */
export const HANDLED_EVENTS = ['signer.signed', 'casefile.completed', 'casefile.rejected'] as const;
export type PenneoEventKey = (typeof HANDLED_EVENTS)[number];

export function eventKey(event: Pick<PenneoWebhook, 'topic' | 'eventType'>): string {
  return `${event.topic}.${event.eventType}`;
}
