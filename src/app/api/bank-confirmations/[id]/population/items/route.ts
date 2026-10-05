// Genereret af scripts/generate-routes.mjs – ret i scripts/routes.spec.json.
import { handler } from '@/app/api/_lib/handler';
import { itemSchema } from '@/app/api/_lib/schemas';
import { bankConfirmations } from '@/services';

/** POST /api/bank-confirmations/[id]/population/items – Tilføj bank (ny kladdeversion hvis nødvendigt) */
export const POST = handler(itemSchema, ({ actor, body, params }) => bankConfirmations.addItem(actor, params.id!, body));
