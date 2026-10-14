import { prisma } from '@/services';
import { DEMO_DATE, runScenario } from './seed/scenario';
import { seedWorld } from './seed/world';

/** Nulstiller databasen og afspiller sæsonen frem til demo-datoen. */
async function main() {
  const started = Date.now();
  await seedWorld(prisma, { startDate: '2026-05-01' });
  await runScenario(prisma, { log: (s) => console.log(s) });
  const [cases, inquiries, events] = await Promise.all([prisma.case.count(), prisma.inquiry.count(), prisma.event.count()]);
  console.log(`Demo-dato ${DEMO_DATE}: ${cases} sager, ${inquiries} forespørgsler, ${events} hændelser (${((Date.now() - started) / 1000).toFixed(1)} s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
