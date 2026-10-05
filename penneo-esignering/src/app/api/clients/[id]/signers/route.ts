import { handler } from '@/app/api/_lib/handler';
import { signing } from '@/services';

/** GET /api/clients/[id]/signers?service=ANNUAL_REPORT – Underskrivere fra kundens stamdata */
export const GET = handler(undefined, ({ actor, params, query }) => signing.getSigners(actor, params.id!, query.get('service') ?? ''));
