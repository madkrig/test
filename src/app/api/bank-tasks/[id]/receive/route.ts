// Genereret af scripts/generate-routes.mjs – ret i scripts/routes.spec.json.
import { handler } from '@/app/api/_lib/handler';
import { receiveSchema } from '@/app/api/_lib/schemas';
import { bankTasks } from '@/services';

/** POST /api/bank-tasks/[id]/receive – Registrér banksvar (kræver Idempotency-Key) */
export const POST = handler(receiveSchema, ({ actor, body, params, idempotencyKey }) => bankTasks.receive(actor, params.id!, body, idempotencyKey));
