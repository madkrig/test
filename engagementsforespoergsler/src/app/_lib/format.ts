import { formatDanish } from '@/domain/ef';

export const fmtDate = (d: string | null | undefined) => formatDanish(d ?? null);

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '–';
  const [date, time] = iso.split('T');
  return `${formatDanish(date)}${time ? ` ${time.slice(0, 5)}` : ''}`;
}

const nf = new Intl.NumberFormat('da-DK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Beløb i øre → "1.250.000,00" med rigtigt minustegn. */
export function fmtKr(ore: number | null | undefined): string {
  if (ore === null || ore === undefined) return '–';
  return nf.format(ore / 100).replace('-', '−');
}

export const fmtPct = (v: number | null | undefined) => (v === null || v === undefined ? '–' : `${String(v).replace('.', ',')} %`);

/** Statusfarver efter stylingbriefen: venter (gul), arbejder (grå), handling (rød), færdig (grøn). */
export function tagClass(tone: string): string {
  if (tone === 'ok') return 'tag ok';
  if (tone === 'failed') return 'tag failed';
  if (tone === 'waiting' || tone === 'warn') return 'tag waiting';
  return 'tag neutral';
}
