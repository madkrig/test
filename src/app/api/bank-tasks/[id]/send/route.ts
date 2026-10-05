// Genereret af scripts/generate-routes.mjs – ret i scripts/routes.spec.json.
import { handler } from '@/app/api/_lib/handler';
import { bankTasks } from '@/services';

/** POST /api/bank-tasks/[id]/send – Send anmodning (kræver Idempotency-Key) */
export const POST = handler(undefined, ({ actor, params, idempotencyKey }) => bankTasks.send(actor, params.id!, idempotencyKey));
