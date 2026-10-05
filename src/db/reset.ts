import type { PrismaClient } from '@prisma/client';

/** Tømmer alle tabeller i fremmednøgle-sikker rækkefølge (seed og tests). */
export async function resetDatabase(db: PrismaClient): Promise<void> {
  await db.$transaction([
    db.authorizationCoverage.deleteMany(),
    db.authorization.deleteMany(),
    db.bankResponse.deleteMany(),
    db.decision.deleteMany(),
    db.bankTask.deleteMany(),
    db.populationItem.deleteMany(),
    db.populationVersion.deleteMany(),
    db.subtask.deleteMany(),
    db.completenessItem.deleteMany(),
    db.completenessRun.deleteMany(),
    db.engagement.deleteMany(),
    db.customer.deleteMany(),
    db.bankMethodVersion.deleteMany(),
    db.bank.deleteMany(),
    db.event.deleteMany(),
    db.notification.deleteMany(),
    db.idempotencyKey.deleteMany(),
    db.integrationCall.deleteMany(),
    db.user.deleteMany(),
  ]);
}
