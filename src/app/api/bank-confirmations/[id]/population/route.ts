// Genereret af scripts/generate-routes.mjs – ret i scripts/routes.spec.json.
import { handler } from '@/app/api/_lib/handler';
import { bankConfirmations } from '@/services';

/** GET /api/bank-confirmations/[id]/population – Populationsversioner; ændringer sorteret først */
export const GET = handler(undefined, ({ actor, params }) => bankConfirmations.getPopulation(actor, params.id!));
