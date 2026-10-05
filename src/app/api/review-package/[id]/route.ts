// Genereret af scripts/generate-routes.mjs – ret i scripts/routes.spec.json.
import { handler } from '@/app/api/_lib/handler';
import { bankConfirmations } from '@/services';

/** GET /api/review-package/[id] – Beslutningsklar reviewpakke */
export const GET = handler(undefined, ({ actor, params }) => bankConfirmations.getReviewPackage(actor, params.id!));
