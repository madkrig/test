// Genereret af scripts/generate-routes.mjs – ret i scripts/routes.spec.json.
import { handler } from '@/app/api/_lib/handler';
import { authorizationPatchSchema } from '@/app/api/_lib/schemas';
import { authorizations } from '@/services';

/** PATCH /api/authorizations/[id] – Ret autorisation */
export const PATCH = handler(authorizationPatchSchema, ({ actor, body, params }) => authorizations.patchAuthorization(actor, params.id!, body));
