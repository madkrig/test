// Genereret af scripts/generate-routes.mjs – ret i scripts/routes.spec.json.
import { handler } from '@/app/api/_lib/handler';
import { patchTaskSchema } from '@/app/api/_lib/schemas';
import { bankTasks } from '@/services';

/** GET /api/bank-tasks/[id] – Workbench: opgave, metode, autorisation, svar, log */
export const GET = handler(undefined, ({ actor, params }) => bankTasks.getBankTask(actor, params.id!));

/** PATCH /api/bank-tasks/[id] – Tildel ejer */
export const PATCH = handler(patchTaskSchema, ({ actor, body, params }) => bankTasks.assign(actor, [params.id!], body.kerneOwnerId));
