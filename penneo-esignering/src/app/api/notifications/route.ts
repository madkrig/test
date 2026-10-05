import { handler } from '@/app/api/_lib/handler';
import { signing } from '@/services';

/** GET /api/notifications – Notifikationer for aktuel bruger */
export const GET = handler(undefined, ({ actor }) => signing.listNotifications(actor));
