// Genereret af scripts/generate-routes.mjs – ret i scripts/routes.spec.json.
import { handler } from '@/app/api/_lib/handler';
import { bankConfirmations } from '@/services';

/** POST /api/bank-confirmations/[id]/complete – Kerne fuldfører subopgaven (afslutningsblokering) */
export const POST = handler(undefined, ({ actor, params }) => bankConfirmations.completeSubtask(actor, params.id!));
