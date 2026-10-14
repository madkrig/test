import { createRouter } from '../_lib/handler';
import { ROUTES } from '../_lib/routes';

export const dynamic = 'force-dynamic';

const router = createRouter(ROUTES);
export const GET = router;
export const POST = router;
export const PATCH = router;
export const DELETE = router;
