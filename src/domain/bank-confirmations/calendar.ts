import { addDays, weekday, type IsoDate } from './dates';

/**
 * Udskiftelig arbejdsdagskalender (brief afsnit 20 + 23).
 * Produktionsversionen kan hente helligdage fra en central kilde.
 */
export interface WorkdayCalendar {
  isWorkday(date: IsoDate): boolean;
}

/** Danske officielle helligdage 2026–2027 (store bededag er afskaffet fra 2024). */
export const DANISH_PUBLIC_HOLIDAYS: readonly IsoDate[] = [
  '2026-01-01', '2026-04-02', '2026-04-03', '2026-04-05', '2026-04-06',
  '2026-05-14', '2026-05-24', '2026-05-25', '2026-12-25', '2026-12-26',
  '2027-01-01', '2027-03-25', '2027-03-26', '2027-03-28', '2027-03-29',
  '2027-05-06', '2027-05-16', '2027-05-17', '2027-12-25', '2027-12-26',
];

export function createCalendar(holidays: readonly IsoDate[] = DANISH_PUBLIC_HOLIDAYS): WorkdayCalendar {
  const closed = new Set(holidays);
  return {
    isWorkday(date) {
      const day = weekday(date);
      return day !== 0 && day !== 6 && !closed.has(date);
    },
  };
}

export type NonWorkdayPolicy = 'previous' | 'next';

/** Flytter en dato til nærmeste arbejdsdag i den angivne retning. */
export function adjustToWorkday(date: IsoDate, calendar: WorkdayCalendar, policy: NonWorkdayPolicy): IsoDate {
  const step = policy === 'previous' ? -1 : 1;
  let current = date;
  while (!calendar.isWorkday(current)) current = addDays(current, step);
  return current;
}

/** Tæller arbejdsdage frem (positiv) eller tilbage (negativ) fra en dato. */
export function addWorkdays(date: IsoDate, workdays: number, calendar: WorkdayCalendar): IsoDate {
  const step = workdays < 0 ? -1 : 1;
  let remaining = Math.abs(workdays);
  let current = date;
  while (remaining > 0) {
    current = addDays(current, step);
    if (calendar.isWorkday(current)) remaining -= 1;
  }
  return current;
}
