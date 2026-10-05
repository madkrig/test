import { handler } from '@/app/api/_lib/handler';
import { simulateSignSchema } from '@/app/api/_lib/schemas';
import { demo } from '@/services';

/** POST /api/demo/penneo/sign – Demo: simulér at en underskriver underskriver i Penneo (kun PENNEO_MODE=mock) */
export const POST = handler(simulateSignSchema, ({ actor, body }) => demo.simulateSignature(actor, body.requestId, body.signerId));
