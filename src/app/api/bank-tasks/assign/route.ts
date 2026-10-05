// Genereret af scripts/generate-routes.mjs – ret i scripts/routes.spec.json.
import { handler } from '@/app/api/_lib/handler';
import { assignSchema } from '@/app/api/_lib/schemas';
import { bankTasks } from '@/services';

/** POST /api/bank-tasks/assign – Bulk-tildeling */
export const POST = handler(assignSchema, ({ actor, body }) => bankTasks.assign(actor, body.ids, body.ownerId));
