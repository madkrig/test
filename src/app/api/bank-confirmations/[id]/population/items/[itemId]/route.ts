// Genereret af scripts/generate-routes.mjs – ret i scripts/routes.spec.json.
import { handler } from '@/app/api/_lib/handler';
import { itemPatchSchema } from '@/app/api/_lib/schemas';
import { bankConfirmations } from '@/services';

/** PATCH /api/bank-confirmations/[id]/population/items/[itemId] – Ret eller fjern bank (fjernelse kræver begrundelse) */
export const PATCH = handler(itemPatchSchema, ({ actor, body, params }) => bankConfirmations.patchItem(actor, params.id!, params.itemId!, body));
