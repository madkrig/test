import { PrismaClient } from '@prisma/client';
import { seed, type SeedState } from '../src/db/seed';

const state = (process.argv.find((a) => a.startsWith('--state='))?.split('=')[1] ?? 'start') as SeedState;
const db = new PrismaClient();

seed(db, state)
  .then((ids) => console.log(`Seed færdig (tilstand: ${state})`, ids))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
