import type { IsoDate } from './dates';
import { authUsable } from './fuldmagt';
import type { AuthCheck } from './statuses';

/**
 * Verifikationsregler før afsendelse (afsnit 6.3). En blokerende regel
 * forhindrer afsendelse; en advarsel kræver, at en person tager stilling.
 */
export interface Finding {
  ruleId: string;
  message: string;
}

export interface VerificationInput {
  today: IsoDate;
  cvrStatus: 'NORMAL' | 'KONKURS' | 'LIKVIDATION' | 'OPHOERT';
  balanceDate: IsoDate;
  periodEnd: IsoDate;
  bankListApproved: boolean;
  authCheck: AuthCheck;
  instituteKnown: boolean;
  duplicateOpen: boolean;
  replyTo: string;
  centralMailbox: string;
  plannedSendDate: IsoDate;
}

export function verifyBeforeSend(input: VerificationInput): { blockers: Finding[]; warnings: Finding[] } {
  const blockers: Finding[] = [];
  const warnings: Finding[] = [];
  if (input.cvrStatus === 'OPHOERT') blockers.push({ ruleId: 'VR-01', message: 'Virksomheden er ophørt i CVR – revisor vurderer.' });
  else if (input.cvrStatus !== 'NORMAL') warnings.push({ ruleId: 'VR-01', message: `Virksomheden er under ${input.cvrStatus === 'KONKURS' ? 'konkurs' : 'likvidation'} – fuldmagt fra kurator/likvidator.` });
  if (input.balanceDate !== input.periodEnd) warnings.push({ ruleId: 'VR-02', message: 'Balancedagen svarer ikke til periodens slutdato i Maconomy.' });
  if (!input.bankListApproved) blockers.push({ ruleId: 'VR-03', message: 'Banklisten er ikke godkendt af revisor.' });
  if (!authUsable(input.authCheck)) blockers.push({ ruleId: 'VR-04', message: 'Ingen gyldig fuldmagt for instituttet.' });
  if (!input.instituteKnown) blockers.push({ ruleId: 'VR-05', message: 'Instituttet findes ikke i bankregisteret med aktiv kanal.' });
  if (input.duplicateOpen) blockers.push({ ruleId: 'VR-06', message: 'Der findes allerede en åben forespørgsel for samme CVR, institut og dato.' });
  if (input.replyTo !== input.centralMailbox) blockers.push({ ruleId: 'VR-07', message: 'Svarmodtager skal være Cedras centrale funktionspostkasse.' });
  if (input.today < input.plannedSendDate) blockers.push({ ruleId: 'VR-09', message: 'Instituttets tidligste afsendelsestidspunkt er ikke nået.' });
  return { blockers, warnings };
}

/** VR-08: institutter fra sidste år eller bogføringen, der hverken er med eller fravalgt med begrundelse. */
export function bankListCompleteness(
  lines: { instituteId: string; included: boolean; deselectReason: string | null }[],
  expected: { lastYear: string[]; saft: string[] },
): string[] {
  const expectedIds = [...new Set([...expected.lastYear, ...expected.saft])];
  return expectedIds.filter((id) => {
    const line = lines.find((l) => l.instituteId === id);
    return !line || (!line.included && !line.deselectReason?.trim());
  });
}
