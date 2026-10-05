// Genereret af scripts/generate-routes.mjs – ret i scripts/routes.spec.json.
import { handler } from '@/app/api/_lib/handler';
import { bankTasks } from '@/services';

/** POST /api/bank-tasks/[id]/complete – Afslut operationel bankopgave */
export const POST = handler(undefined, ({ actor, params }) => bankTasks.complete(actor, params.id!));
