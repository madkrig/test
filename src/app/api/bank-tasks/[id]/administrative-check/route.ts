// Genereret af scripts/generate-routes.mjs – ret i scripts/routes.spec.json.
import { handler } from '@/app/api/_lib/handler';
import { checkSchema } from '@/app/api/_lib/schemas';
import { bankTasks } from '@/services';

/** POST /api/bank-tasks/[id]/administrative-check – Administrativ kontrol + upload til SharePoint (mock) */
export const POST = handler(checkSchema, ({ actor, body, params, idempotencyKey }) => bankTasks.administrativeCheck(actor, params.id!, body, idempotencyKey));
