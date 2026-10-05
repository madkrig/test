import { handler } from '@/app/api/_lib/handler';
import { createSigningRequestSchema } from '@/app/api/_lib/schemas';
import { demo, signing } from '@/services';

const SCOPES = ['active', 'completed', 'all'] as const;

/** GET /api/signing-requests?scope=active|completed|all – Opgaver */
export const GET = handler(undefined, async ({ actor, query }) => {
  const scope = SCOPES.find((s) => s === query.get('scope')) ?? 'all';
  return { ...(await signing.listSigningRequests(actor, scope)), demo: demo.demoEnabled() };
});

/** POST /api/signing-requests – Start underskriftsforløb i Penneo (kræver Idempotency-Key) */
export const POST = handler(createSigningRequestSchema, ({ actor, body, idempotencyKey }) => signing.createSigningRequest(actor, body, idempotencyKey));
