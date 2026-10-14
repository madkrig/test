// Genereret af scripts/generate-routes.mjs – ret i scripts/routes.spec.json.
import { handler } from '@/app/api/_lib/handler';
import { bankConfirmations } from '@/services';

/** GET /api/engagements – Revisorens egne revisionsopgaver med subopgavestatus */
export const GET = handler(undefined, ({ actor }) => bankConfirmations.myEngagements(actor));
