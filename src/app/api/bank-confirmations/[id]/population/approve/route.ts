// Genereret af scripts/generate-routes.mjs – ret i scripts/routes.spec.json.
import { handler } from '@/app/api/_lib/handler';
import { versionSchema } from '@/app/api/_lib/schemas';
import { bankConfirmations } from '@/services';

/** POST /api/bank-confirmations/[id]/population/approve – Revisor godkender konkret version → én BankTask pr. bank */
export const POST = handler(versionSchema, ({ actor, body, params }) => bankConfirmations.approve(actor, params.id!, body.versionId));
