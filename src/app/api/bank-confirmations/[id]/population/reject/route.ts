// Genereret af scripts/generate-routes.mjs – ret i scripts/routes.spec.json.
import { handler } from '@/app/api/_lib/handler';
import { rejectSchema } from '@/app/api/_lib/schemas';
import { bankConfirmations } from '@/services';

/** POST /api/bank-confirmations/[id]/population/reject – Revisor returnerer version med begrundelse */
export const POST = handler(rejectSchema, ({ actor, body, params }) => bankConfirmations.reject(actor, params.id!, body.versionId, body.reason));
