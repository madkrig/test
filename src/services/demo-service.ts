import type { IsoDate, User } from '@/domain/bank-confirmations';
import { seed, type SeedState } from '@/db/seed';
import { resetClock, setClock, today } from './clock';
import { prisma, type Db } from './db';
import { DomainError } from './errors';
import { appendEvent } from './event-log';

/**
 * Demoværktøjer (kun prototype): fælles demodato og nulstilling af syntetiske data.
 * Demodatoen gemmes i databasen, så alle brugere og faner ser samme "i dag".
 */
const KEY = 'demoToday';

export async function syncDemoClock(db: Db = prisma): Promise<IsoDate> {
  const row = await db.setting.findUnique({ where: { key: KEY } });
  if (row) setClock(row.value);
  else if (process.env.DEMO_TODAY) setClock(process.env.DEMO_TODAY);
  else resetClock();
  return today();
}

export async function setDemoDate(actor: User, date: IsoDate, db: Db = prisma) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new DomainError('VALIDATION', 'Dato skal være ÅÅÅÅ-MM-DD.');
  await db.setting.upsert({ where: { key: KEY }, create: { key: KEY, value: date }, update: { value: date } });
  setClock(date);
  await appendEvent(db, { objectType: 'DEMO', objectId: KEY, action: 'DEMO_DATE_SET', actorId: actor.id, change: date });
  return { data: { today: date }, nextAction: '–', nextOwner: '–' };
}

export async function resetDemo(actor: User, state: SeedState) {
  const ids = await seed(prisma, state);
  await prisma.setting.create({ data: { key: KEY, value: today() } });
  await appendEvent(prisma, { objectType: 'DEMO', objectId: KEY, action: 'DEMO_RESET', actorId: actor.id, change: state });
  return { data: { state, today: today(), ids }, nextAction: '–', nextOwner: '–' };
}
