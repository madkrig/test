// Genereret af scripts/generate-routes.mjs – ret i scripts/routes.spec.json.
import { handler } from '@/app/api/_lib/handler';
import { clarificationSchema } from '@/app/api/_lib/schemas';
import { completeness } from '@/services';

/** POST /api/completeness-items/[id]/decide – Tilvælg / fravælg med begrundelse */
export const POST = handler(clarificationSchema, ({ actor, body, params }) => completeness.decideItem(actor, params.id!, body.decision, body.reason));
