// Genereret af scripts/generate-routes.mjs – ret i scripts/routes.spec.json.
import { handler } from '@/app/api/_lib/handler';
import { bankTasks } from '@/services';

/** GET /api/bank-tasks – Prioriteret arbejdskø (server-side filtrering/pagination) */
export const GET = handler(undefined, ({ actor, query }) => bankTasks.listBankTasks(actor, { status: (query.get('status') ?? undefined) as never, ownerId: query.get('ownerId') ?? undefined, bankId: query.get('bankId') ?? undefined, flag: (query.get('flag') ?? undefined) as never, includeCompleted: query.get('includeCompleted') === 'true', page: Number(query.get('page') ?? 1), pageSize: Number(query.get('pageSize') ?? 50) }));
