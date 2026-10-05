// Genereret af scripts/generate-routes.mjs – ret i scripts/routes.spec.json.
import { handler } from '@/app/api/_lib/handler';
import { methodSchema } from '@/app/api/_lib/schemas';
import { bankRegister } from '@/services';

/** GET /api/banks/[id]/methods – Metodeversioner og påvirkede åbne BankTasks */
export const GET = handler(undefined, ({ actor, params }) => bankRegister.listMethods(actor, params.id!));

/** POST /api/banks/[id]/methods – Opret metodeudkast (kræver begrundelse) */
export const POST = handler(methodSchema, ({ actor, body, params }) => bankRegister.createMethodVersion(actor, params.id!, body));
