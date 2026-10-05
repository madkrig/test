// Genereret af scripts/generate-routes.mjs – ret i scripts/routes.spec.json.
import { handler } from '@/app/api/_lib/handler';
import { conclusionSchema } from '@/app/api/_lib/schemas';
import { bankConfirmations } from '@/services';

/** POST /api/bank-confirmations/[id]/conclusion – Revisors faglige konklusion */
export const POST = handler(conclusionSchema, ({ actor, body, params }) => bankConfirmations.recordConclusion(actor, params.id!, body.conclusion));
