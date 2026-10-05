// Genereret af scripts/generate-routes.mjs – ret i scripts/routes.spec.json.
import { handler } from '@/app/api/_lib/handler';
import { bankTasks } from '@/services';

/** POST /api/bank-confirmations/[id]/review-notes/resolve – Luk én åben review note */
export const POST = handler(undefined, ({ actor, params }) => bankTasks.resolveReviewNote(actor, params.id!));
