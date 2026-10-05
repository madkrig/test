// Genereret af scripts/generate-routes.mjs – ret i scripts/routes.spec.json.
import { handler } from '@/app/api/_lib/handler';
import { authorizationSchema } from '@/app/api/_lib/schemas';
import { authorizations } from '@/services';

/** GET /api/authorizations – Autorisationer */
export const GET = handler(undefined, ({ actor, query }) => authorizations.listAuthorizations(actor, query.get('customerId') ?? undefined));

/** POST /api/authorizations – Registrér autorisation, der dækker én eller flere BankTasks */
export const POST = handler(authorizationSchema, ({ actor, body }) => authorizations.createAuthorization(actor, body));
