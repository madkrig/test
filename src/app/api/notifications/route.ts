// Genereret af scripts/generate-routes.mjs – ret i scripts/routes.spec.json.
import { handler } from '@/app/api/_lib/handler';
import { prisma } from '@/services';

/** GET /api/notifications – Notifikationer for aktuel bruger/rolle */
export const GET = handler(undefined, ({ actor }) => prisma.notification.findMany({ where: { recipient: { in: [actor.id, `ROLE:${actor.role}`] } }, orderBy: { createdAt: 'desc' } }));
