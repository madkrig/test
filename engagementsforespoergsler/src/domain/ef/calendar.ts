import { addDays, weekday, type IsoDate } from './dates';

/**
 * Hverdage regnes uden weekender og danske helligdage (afsnit 6.1).
 * Helligdagene beregnes ud fra påskedag, så kalenderen virker for alle år
 * (store bededag er afskaffet fra 2024).
 */
export interface WorkdayCalendar {
  isWorkday(date: IsoDate): boolean;
}

/** Påskedag efter den gregorianske beregning (Meeus/Jones/Butcher). */
export function easterSunday(year: number): IsoDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function danishHolidays(year: number): IsoDate[] {
  const easter = easterSunday(year);
  return [
    `${year}-01-01`,
    addDays(easter, -3), // skærtorsdag
    addDays(easter, -2), // langfredag
    easter,
    addDays(easter, 1), // 2. påskedag
    addDays(easter, 39), // Kristi himmelfart
    addDays(easter, 49), // pinsedag
    addDays(easter, 50), // 2. pinsedag
    `${year}-12-25`,
    `${year}-12-26`,
  ];
}

export function createCalendar(extraClosedDays: IsoDate[] = []): WorkdayCalendar {
  const cache = new Map<number, Set<IsoDate>>();
  const closed = (year: number) => {
    if (!cache.has(year)) cache.set(year, new Set([...danishHolidays(year), ...extraClosedDays]));
    return cache.get(year)!;
  };
  return {
    isWorkday(date) {
      const day = weekday(date);
      return day !== 0 && day !== 6 && !closed(Number(date.slice(0, 4))).has(date);
    },
  };
}

export const calendar = createCalendar();

/** Flytter en dato til nærmeste hverdag fremad ('next') eller bagud ('previous'). */
export function toWorkday(date: IsoDate, policy: 'next' | 'previous', cal: WorkdayCalendar = calendar): IsoDate {
  const step = policy === 'next' ? 1 : -1;
  let current = date;
  while (!cal.isWorkday(current)) current = addDays(current, step);
  return current;
}

/** Tæller hverdage frem (positiv) eller tilbage (negativ). */
export function addWorkdays(date: IsoDate, workdays: number, cal: WorkdayCalendar = calendar): IsoDate {
  const step = workdays < 0 ? -1 : 1;
  let remaining = Math.abs(workdays);
  let current = date;
  while (remaining > 0) {
    current = addDays(current, step);
    if (cal.isWorkday(current)) remaining -= 1;
  }
  return current;
}

/** Antal hverdage efter `from` til og med `to` (0, hvis `to` ikke ligger efter `from`). */
export function workdaysBetween(from: IsoDate, to: IsoDate, cal: WorkdayCalendar = calendar): number {
  let count = 0;
  for (let d = addDays(from, 1); d <= to; d = addDays(d, 1)) if (cal.isWorkday(d)) count++;
  return count;
}
