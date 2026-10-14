import type { IsoDate } from '@/domain/bank-confirmations';

/**
 * Prototypens ur. Kan fastlåses (DEMO_TODAY eller setClock) for demo og test.
 * Tidszone: Europe/Copenhagen.
 */
let fixed: { today: IsoDate; time?: string } | undefined = process.env.DEMO_TODAY
  ? { today: process.env.DEMO_TODAY }
  : undefined;

/** Fastlås datoen. Uden klokkeslæt bruges det aktuelle klokkeslæt, så hændelser stadig sorteres korrekt. */
export function setClock(today: IsoDate, time?: string): void {
  fixed = time ? { today, time } : { today };
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
  if (fixed?.time) return `${fixed.today}T${fixed.time}`;
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date());
  const live = parts.replace(' ', 'T');
  return fixed ? `${fixed.today}T${live.slice(11)}` : live;
}
