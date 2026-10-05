import { handler } from '@/app/api/_lib/handler';
import { signing } from '@/services';

/** POST /api/signing-requests/[id]/archive – Genforsøg arkivering i SharePoint */
export const POST = handler(undefined, ({ actor, params }) => signing.retryArchive(actor, params.id!));
