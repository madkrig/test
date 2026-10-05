// Genereret af scripts/generate-routes.mjs – ret i scripts/routes.spec.json.
import { handler } from '@/app/api/_lib/handler';
import { bankRegister } from '@/services';

/** POST /api/bank-methods/[id]/activate – Aktivér godkendt metode */
export const POST = handler(undefined, ({ actor, params }) => bankRegister.activateMethod(actor, params.id!));
