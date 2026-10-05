import { PrismaClient, type Prisma } from '@prisma/client';

/** Én PrismaClient pr. proces (genbruges ved Next.js hot reload). */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Kør en mutation atomisk, så objektændring og hændelseslog altid følges ad.
 * En adgangsafvisning logges efter rollback, så den ikke forsvinder med transaktionen.
 */
export async function transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  try {
    return await prisma.$transaction(fn);
  } catch (e) {
    const denied = (e as { deniedAccess?: { actorId: string; action: string } }).deniedAccess;
    if (denied) {
      const { logAccessDenied } = await import('./access');
      await logAccessDenied(denied.actorId, denied.action);
    }
    throw e;
  }
}
