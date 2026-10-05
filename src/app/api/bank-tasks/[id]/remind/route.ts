// Genereret af scripts/generate-routes.mjs – ret i scripts/routes.spec.json.
import { handler } from '@/app/api/_lib/handler';
import { bankTasks } from '@/services';

/** POST /api/bank-tasks/[id]/remind – Standardpåmindelse (maks. 2, kræver Idempotency-Key) */
export const POST = handler(undefined, ({ actor, params, idempotencyKey }) => bankTasks.remind(actor, params.id!, idempotencyKey));
