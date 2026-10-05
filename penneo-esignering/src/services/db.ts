import { PrismaClient, type Prisma } from '@prisma/client';

/** Én PrismaClient pr. proces (genbruges ved Next.js hot reload). */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export type Db = PrismaClient | Prisma.TransactionClient;

/** Kør en mutation atomisk, så objektændring og hændelseslog altid følges ad. */
export function transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(fn);
}
