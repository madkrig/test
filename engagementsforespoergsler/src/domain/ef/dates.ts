/**
 * Datoer er kalenderdatoer uden klokkeslæt ("ÅÅÅÅ-MM-DD"). Det undgår
 * tidszonefejl i fristberegningen. Visning sker som dd.mm.åååå.
 */
export type IsoDate = string;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function toUtc(date: IsoDate): Date {
  if (!ISO_DATE.test(date)) throw new Error(`Ugyldig dato: ${date}`);
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const utc = new Date(Date.UTC(y, m - 1, d));
  if (utc.getUTCMonth() !== m - 1 || utc.getUTCDate() !== d) throw new Error(`Ugyldig dato: ${date}`);
  return utc;
}

const fromUtc = (utc: Date): IsoDate => utc.toISOString().slice(0, 10);

export function addDays(date: IsoDate, days: number): IsoDate {
  const utc = toUtc(date);
  utc.setUTCDate(utc.getUTCDate() + days);
  return fromUtc(utc);
}

/** Kalendermåneder; dagen klippes til månedens sidste dag. */
export function addMonths(date: IsoDate, months: number): IsoDate {
  const utc = toUtc(date);
  const day = utc.getUTCDate();
  const target = new Date(Date.UTC(utc.getUTCFullYear(), utc.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return fromUtc(target);
}

/** 0 = søndag … 6 = lørdag */
export function weekday(date: IsoDate): number {
  return toUtc(date).getUTCDay();
}

/** Antal kalenderdage fra a til b (positiv, når b ligger efter a). */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  return Math.round((toUtc(b).getTime() - toUtc(a).getTime()) / 86400000);
}

export function compareDates(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export const minDate = (a: IsoDate, b: IsoDate): IsoDate => (a < b ? a : b);
export const maxDate = (a: IsoDate, b: IsoDate): IsoDate => (a > b ? a : b);

/** ISO-uge og -år, fx { year: 2027, week: 1 }. */
export function isoWeek(date: IsoDate): { year: number; week: number } {
  const d = toUtc(date);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return { year: d.getUTCFullYear(), week: Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7) };
}

/** Mandagen i datoens uge. */
export function weekStart(date: IsoDate): IsoDate {
  return addDays(date, -((weekday(date) + 6) % 7));
}

export function formatDanish(date: IsoDate | null | undefined): string {
  if (!date) return '–';
  const [y, m, d] = date.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}
