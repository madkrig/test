import type { IsoDate } from '@/domain/ef';
import type { Db } from './db';

/**
 * Systemets dato. I demo og test kan den stilles (indstillingen "today"), så
 * årshjulets frister, rykkere og eskaleringer kan vises uden at vente.
 * Tidszone: Europe/Copenhagen.
 */
function realToday(): IsoDate {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Copenhagen' }).format(new Date());
}

function realTime(): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Copenhagen', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date());
}

export async function today(db: Db): Promise<IsoDate> {
  const row = await db.setting.findUnique({ where: { key: 'today' } });
  return row?.value ?? realToday();
}

/** Tidsstempel uden tidszonesuffiks: systemdatoen + det faktiske klokkeslæt. */
export async function now(db: Db): Promise<string> {
  return `${await today(db)}T${realTime()}`;
}

export async function setToday(db: Db, date: IsoDate): Promise<void> {
  await db.setting.upsert({ where: { key: 'today' }, update: { value: date }, create: { key: 'today', value: date } });
}
