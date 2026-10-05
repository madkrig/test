/**
 * Datoer håndteres som kalenderdatoer uden klokkeslæt ("YYYY-MM-DD").
 * Det undgår tidszonefejl ved fristberegning; visning sker i dd.mm.åååå
 * og tidszonen for tidsstempler er Europe/Copenhagen.
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

function fromUtc(utc: Date): IsoDate {
  return utc.toISOString().slice(0, 10);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const utc = toUtc(date);
  utc.setUTCDate(utc.getUTCDate() + days);
  return fromUtc(utc);
}

export function addWeeks(date: IsoDate, weeks: number): IsoDate {
  return addDays(date, weeks * 7);
}

/** Kalendermåneder; dag klippes til månedens sidste dag (31.03 − 1 md. = 28./29.02). */
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

export function compareDates(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function formatDanish(date: IsoDate): string {
  const [y, m, d] = date.split('-');
  return `${d}.${m}.${y}`;
}
