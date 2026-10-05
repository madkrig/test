import { handler } from '@/app/api/_lib/handler';
import { signing } from '@/services';

/** GET /api/signing-requests/[id] – Opgave med underskrivere og hændelseslog */
export const GET = handler(undefined, ({ actor, params }) => signing.getSigningRequest(actor, params.id!));
