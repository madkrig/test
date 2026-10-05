// Genereret af scripts/generate-routes.mjs – ret i scripts/routes.spec.json.
import { handler } from '@/app/api/_lib/handler';
import { reviewer } from '@/services';

/** GET /api/reviewer/portfolio – Revisorens populationer til godkendelse */
export const GET = handler(undefined, ({ actor }) => reviewer.portfolio(actor));
