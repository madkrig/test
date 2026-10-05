import { handler } from '@/app/api/_lib/handler';
import { signing } from '@/services';

/** GET /api/signing-services – Ydelser, der kan sendes til e-signering */
export const GET = handler(undefined, async () => signing.listServices());
