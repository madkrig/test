import { handler } from '@/app/api/_lib/handler';
import { signing } from '@/services';

/** GET /api/clients – Revisors kunder (dropdown) */
export const GET = handler(undefined, ({ actor }) => signing.listClients(actor));
