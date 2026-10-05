import { handler } from '@/app/api/_lib/handler';
import { signing } from '@/services';

/** POST /api/notifications/read – Markér alle notifikationer som læst */
export const POST = handler(undefined, ({ actor }) => signing.markNotificationsRead(actor));
