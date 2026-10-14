import { PrismaClient } from '@prisma/client';
import { seed, type SeedState } from '../src/db/seed';
import { today } from '../src/services/clock';

const state = (process.argv.find((a) => a.startsWith('--state='))?.split('=')[1] ?? 'start') as SeedState;
const db = new PrismaClient();

seed(db, state)
  // Demodatoen følger seedens sidste tidspunkt, så appen viser samme "i dag" som scenariet.
  .then(async (ids) => {
    await db.setting.create({ data: { key: 'demoToday', value: today() } });
    console.log(`Seed færdig (tilstand: ${state}, demodato ${today()})`, ids);
  })
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
