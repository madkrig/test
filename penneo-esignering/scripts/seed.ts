import { prisma } from '../src/services/db';
import { seed } from '../src/db/seed';

seed(prisma)
  .then((ids) => console.log('Seed færdig', ids))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
