// Genereret af scripts/generate-routes.mjs – ret i scripts/routes.spec.json.
import { handler } from '@/app/api/_lib/handler';
import { bankTasks } from '@/services';

/** POST /api/jobs/escalation-check – T-10-kontrol (system/Kerne) */
export const POST = handler(undefined, ({ actor }) => bankTasks.runEscalationCheck(actor));
