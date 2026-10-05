// Genereret af scripts/generate-routes.mjs – ret i scripts/routes.spec.json.
import { handler } from '@/app/api/_lib/handler';
import { bulkApproveSchema } from '@/app/api/_lib/schemas';
import { reviewer } from '@/services';

/** POST /api/reviewer/bulk-approve – Massegodkendelse (separat approval event pr. engagement) */
export const POST = handler(bulkApproveSchema, ({ actor, body }) => reviewer.bulkApprove(actor, body.items, body.confirmed));
