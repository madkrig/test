// Genereret af scripts/generate-routes.mjs – ret i scripts/routes.spec.json.
import { handler } from '@/app/api/_lib/handler';
import { deltaSchema } from '@/app/api/_lib/schemas';
import { bankConfirmations } from '@/services';

/** POST /api/bank-confirmations/[id]/population/delta – Ny bank efter godkendelse → delta-version */
export const POST = handler(deltaSchema, ({ actor, body, params }) => bankConfirmations.createDelta(actor, params.id!, body.items));
