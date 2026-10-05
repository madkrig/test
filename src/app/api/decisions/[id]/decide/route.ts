// Genereret af scripts/generate-routes.mjs – ret i scripts/routes.spec.json.
import { handler } from '@/app/api/_lib/handler';
import { decideSchema } from '@/app/api/_lib/schemas';
import { bankTasks } from '@/services';

/** POST /api/decisions/[id]/decide – Revisor træffer faglig beslutning */
export const POST = handler(decideSchema, ({ actor, body, params }) => bankTasks.decide(actor, params.id!, body));
