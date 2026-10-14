// Genereret af scripts/generate-routes.mjs – ret i scripts/routes.spec.json.
import { handler } from '@/app/api/_lib/handler';
import { bankConfirmations } from '@/services';

/** GET /api/population-work – Kernes populationsarbejde: kladder og returnerede versioner */
export const GET = handler(undefined, ({ actor }) => bankConfirmations.populationWork(actor));
