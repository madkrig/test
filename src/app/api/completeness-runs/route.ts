// Genereret af scripts/generate-routes.mjs – ret i scripts/routes.spec.json.
import { handler } from '@/app/api/_lib/handler';
import { completeness } from '@/services';

/** GET /api/completeness-runs – Kørsler af fuldstændighedskontrol */
export const GET = handler(undefined, ({ actor }) => completeness.listRuns(actor));
