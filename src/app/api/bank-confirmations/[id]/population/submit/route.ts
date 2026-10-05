// Genereret af scripts/generate-routes.mjs – ret i scripts/routes.spec.json.
import { handler } from '@/app/api/_lib/handler';
import { bankConfirmations } from '@/services';

/** POST /api/bank-confirmations/[id]/population/submit – Kerne indsender populationsforslag til revisor */
export const POST = handler(undefined, ({ actor, params }) => bankConfirmations.submit(actor, params.id!));
