// Genereret af scripts/generate-routes.mjs – ret i scripts/routes.spec.json.
import { handler } from '@/app/api/_lib/handler';
import { fourEyesSchema } from '@/app/api/_lib/schemas';
import { bankTasks } from '@/services';

/** POST /api/bank-tasks/[id]/four-eyes – Fire-øjne-kontrol (reviewer ≠ performer) */
export const POST = handler(fourEyesSchema, ({ actor, body, params }) => bankTasks.performFourEyes(actor, params.id!, body.performerId));
