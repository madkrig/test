// Genereret af scripts/generate-routes.mjs – ret i scripts/routes.spec.json.
import { handler } from '@/app/api/_lib/handler';
import { demoClockSchema } from '@/app/api/_lib/schemas';
import { demo } from '@/services';

/** POST /api/demo/clock – Sæt fælles demodato (kun prototype) */
export const POST = handler(demoClockSchema, ({ actor, body }) => demo.setDemoDate(actor, body.date));
