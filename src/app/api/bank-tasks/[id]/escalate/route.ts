// Genereret af scripts/generate-routes.mjs – ret i scripts/routes.spec.json.
import { handler } from '@/app/api/_lib/handler';
import { escalateSchema } from '@/app/api/_lib/schemas';
import { bankTasks } from '@/services';

/** POST /api/bank-tasks/[id]/escalate – Eskalér undtagelse som beslutning til revisor */
export const POST = handler(escalateSchema, ({ actor, body, params }) => bankTasks.escalate(actor, params.id!, body));
