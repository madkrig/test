// Genereret af scripts/generate-routes.mjs – ret i scripts/routes.spec.json.
import { handler } from '@/app/api/_lib/handler';
import { runSchema } from '@/app/api/_lib/schemas';
import { completeness } from '@/services';

/** POST /api/completeness-runs/run – Kør månedlig fuldstændighedskontrol */
export const POST = handler(runSchema, ({ actor, body }) => completeness.runControl(actor, body.runDate));
