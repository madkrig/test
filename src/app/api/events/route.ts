// Genereret af scripts/generate-routes.mjs – ret i scripts/routes.spec.json.
import { handler } from '@/app/api/_lib/handler';
import { listEvents, prisma } from '@/services';

/** GET /api/events – Uforanderlig hændelseslog */
export const GET = handler(undefined, ({ actor, query }) => listEvents(prisma, { objectType: query.get('objectType') ?? undefined, objectId: query.get('objectId') ?? undefined, subtaskId: query.get('subtaskId') ?? undefined }));
