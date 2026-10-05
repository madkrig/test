// Genereret af scripts/generate-routes.mjs – ret i scripts/routes.spec.json.
import { handler } from '@/app/api/_lib/handler';
import { activateSchema } from '@/app/api/_lib/schemas';
import { bankConfirmations } from '@/services';

/** POST /api/engagements/[id]/bank-confirmations/activate – Aktivér bankbekræftelser (dublet → 409 med existingId) */
export const POST = handler(activateSchema, ({ actor, body, params }) => bankConfirmations.activate(actor, params.id!, body.source));
