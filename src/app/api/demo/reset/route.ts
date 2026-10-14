// Genereret af scripts/generate-routes.mjs – ret i scripts/routes.spec.json.
import { handler } from '@/app/api/_lib/handler';
import { demoResetSchema } from '@/app/api/_lib/schemas';
import { demo } from '@/services';

/** POST /api/demo/reset – Nulstil syntetiske demodata til start- eller brief-tilstand (kun prototype) */
export const POST = handler(demoResetSchema, ({ actor, body }) => demo.resetDemo(actor, body.state));
