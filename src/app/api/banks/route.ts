// Genereret af scripts/generate-routes.mjs – ret i scripts/routes.spec.json.
import { handler } from '@/app/api/_lib/handler';
import { bankRegister } from '@/services';

/** GET /api/banks – Bankregister (forældede/ufuldstændige først) */
export const GET = handler(undefined, ({ actor }) => bankRegister.listBanks(actor));
