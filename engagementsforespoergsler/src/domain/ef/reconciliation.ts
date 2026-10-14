import type { DeviationType, LineCategory, Severity } from './statuses';

/**
 * Afstemning af svar mod bogføringen (AR-05–AR-10) – erstatter afstemningen
 * i regneark. Beløb er hele øre. Bankens og bogføringens fortegn er ens
 * (gæld negativ), så difference = svar − bogføring.
 */
export const BALANCE_CATEGORIES: LineCategory[] = ['INDLAAN', 'UDLAAN', 'KREDIT', 'DEPOT', 'DERIVAT'];
export const NOTE_CATEGORIES: LineCategory[] = ['GARANTI', 'SIKKERHED_STILLET', 'SIKKERHED_MODTAGET'];

export interface ResponseLineIn {
  id: string;
  category: LineCategory;
  accountRef: string | null;
  description: string;
  amountDkkOre: number | null;
}

export interface BookedIn {
  id: string;
  accountRef: string;
  name: string;
  balanceOre: number;
}

export type MatchStatus = 'MATCH' | 'DIFFERENCE' | 'KUN_I_SVAR' | 'KUN_I_BOGFOERING';

export interface ReconResult {
  responseLineId: string | null;
  ledgerAccountId: string | null;
  bookedOre: number | null;
  differenceOre: number;
  matchStatus: MatchStatus;
}

export interface DeviationDraft {
  type: DeviationType;
  severity: Severity;
  description: string;
  amountOre: number;
  /** Index i `recon`, som afvigelsen hører til. */
  reconIndex: number | null;
  autoClosed: boolean;
}

/** Kontonumre sammenlignes på cifrene, så "4471-0412" og "44710412" matcher. */
export const normalizeAccount = (ref: string | null | undefined) => (ref ?? '').replace(/\D/g, '');

/** AR-10: beløb i fremmed valuta omregnes til DKK med kursen på balancedagen (DKK pr. enhed). */
export function toDkkOre(amountOre: number, currency: string, rates: Record<string, number>): number {
  if (currency === 'DKK') return amountOre;
  const rate = rates[currency];
  if (!rate) throw new Error(`Mangler kurs for ${currency} på balancedagen`);
  return Math.round(amountOre * rate);
}

export const kr = (ore: number) =>
  new Intl.NumberFormat('da-DK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(ore / 100);

export function reconcile(
  lines: ResponseLineIn[],
  booked: BookedIn[],
  opts: { toleranceOre: number; trivialOre: number },
): { recon: ReconResult[]; deviations: DeviationDraft[]; notes: ResponseLineIn[] } {
  const recon: ReconResult[] = [];
  const deviations: DeviationDraft[] = [];
  const used = new Set<string>();

  for (const line of lines.filter((l) => BALANCE_CATEGORIES.includes(l.category))) {
    const account = booked.find((b) => !used.has(b.id) && normalizeAccount(b.accountRef) === normalizeAccount(line.accountRef) && normalizeAccount(line.accountRef) !== '');
    const amount = line.amountDkkOre ?? 0;
    if (!account) {
      recon.push({ responseLineId: line.id, ledgerAccountId: null, bookedOre: null, differenceOre: amount, matchStatus: 'KUN_I_SVAR' });
      deviations.push({
        type: 'KUN_I_SVAR',
        severity: 'KRITISK',
        description: `${line.description} (${line.accountRef ?? 'uden konto'}) på ${kr(amount)} kr. findes ikke i bogføringen (AR-06).`,
        amountOre: amount,
        reconIndex: recon.length - 1,
        autoClosed: false,
      });
      continue;
    }
    used.add(account.id);
    const difference = amount - account.balanceOre;
    const matched = Math.abs(difference) <= opts.toleranceOre;
    recon.push({ responseLineId: line.id, ledgerAccountId: account.id, bookedOre: account.balanceOre, differenceOre: difference, matchStatus: matched ? 'MATCH' : 'DIFFERENCE' });
    if (!matched) {
      const trivial = Math.abs(difference) < opts.trivialOre;
      deviations.push({
        type: 'SALDODIFFERENCE',
        severity: trivial ? 'UVAESENTLIG' : 'VAESENTLIG',
        description: `${line.description} (${line.accountRef}): banken ${kr(amount)} kr., bogført ${kr(account.balanceOre)} kr., difference ${kr(difference)} kr. (AR-05).`,
        amountOre: difference,
        reconIndex: recon.length - 1,
        autoClosed: trivial,
      });
    }
  }

  for (const account of booked.filter((b) => !used.has(b.id))) {
    recon.push({ responseLineId: null, ledgerAccountId: account.id, bookedOre: account.balanceOre, differenceOre: -account.balanceOre, matchStatus: 'KUN_I_BOGFOERING' });
    deviations.push({
      type: 'KUN_I_BOGFOERING',
      severity: 'VAESENTLIG',
      description: `${account.name} (${account.accountRef}) på ${kr(account.balanceOre)} kr. fremgår ikke af svaret (AR-07).`,
      amountOre: -account.balanceOre,
      reconIndex: recon.length - 1,
      autoClosed: false,
    });
  }

  return { recon, deviations, notes: lines.filter((l) => NOTE_CATEGORIES.includes(l.category)) };
}

/** AR-09: tegningsret i banken mod CVR. Personer sammenlignes på navn. */
export function signingRightsDeviation(bankSigners: string[], cvrSigners: string[]): DeviationDraft | null {
  const norm = (s: string) => s.trim().toLowerCase();
  const extra = bankSigners.filter((b) => !cvrSigners.map(norm).includes(norm(b)));
  if (extra.length === 0) return null;
  return {
    type: 'TEGNINGSRET',
    severity: 'VAESENTLIG',
    description: `Banken har tegningsret registreret for ${extra.join(', ')}, som ikke kan tegne efter CVR (AR-09) – mulig kontrolsvaghed.`,
    amountOre: 0,
    reconIndex: null,
    autoClosed: false,
  };
}

/** Hvem må lukke en afvigelse (klassifikationstabellen og 10.3). */
export function canCloseDeviation(severity: Severity, role: string, isResponsibleAuditor: boolean): boolean {
  if (severity === 'KRITISK' || severity === 'VAESENTLIG') return role === 'OR' && isResponsibleAuditor;
  if (severity === 'FORKLARET') return role === 'OR' || role === 'RM';
  return true;
}
