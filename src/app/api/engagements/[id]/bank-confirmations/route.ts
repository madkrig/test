// Genereret af scripts/generate-routes.mjs – ret i scripts/routes.spec.json.
import { handler } from '@/app/api/_lib/handler';
import { bankConfirmations } from '@/services';

/** GET /api/engagements/[id]/bank-confirmations – AuditFlow-visning: subopgave, population, bankopgaver, beslutninger */
export const GET = handler(undefined, ({ actor, params }) => bankConfirmations.getForEngagement(actor, params.id!));
