import type { IsoDate } from '@/domain/bank-confirmations';

/**
 * Prototypens ur. Kan fastlåses (DEMO_TODAY eller setClock) for demo og test.
 * Tidszone: Europe/Copenhagen.
 */
let fixed: { today: IsoDate; time: string } | undefined = process.env.DEMO_TODAY
  ? { today: process.env.DEMO_TODAY, time: '09:00:00' }
  : undefined;

export function setClock(today: IsoDate, time = '09:00:00'): void {
  fixed = { today, time };
}

export function resetClock(): void {
  fixed = undefined;
}

export function today(): IsoDate {
  if (fixed) return fixed.today;
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Copenhagen' }).format(new Date());
}

/** Tidsstempel uden tidszonesuffiks, i københavnsk lokaltid. */
export function now(): string {
  if (fixed) return `${fixed.today}T${fixed.time}`;
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date());
  return parts.replace(' ', 'T');
}
