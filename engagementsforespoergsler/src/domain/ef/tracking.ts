import { ANSWERED_INQUIRY, SENT_INQUIRY, type CaseStatus, type InquiryStatus } from './statuses';

/**
 * Pakkesporing (US-R-04, S03): de samme trin vises for revisor, kerneteam og
 * ledelse. Hvert trin er gjort, aktuelt eller kommende – med tællere.
 */
export interface TrackingStep {
  key: string;
  label: string;
  state: 'done' | 'current' | 'todo';
  counter?: string;
}

export function trackingSteps(input: {
  status: CaseStatus;
  bankListApproved: boolean;
  authValid: boolean;
  inquiries: InquiryStatus[];
}): TrackingStep[] {
  const active = input.inquiries.filter((s) => s !== 'ANNULLERET');
  const total = active.length;
  const sent = active.filter((s) => SENT_INQUIRY.includes(s)).length;
  const answered = active.filter((s) => ANSWERED_INQUIRY.includes(s)).length;
  const reconciled = active.filter((s) => s === 'AFSLUTTET').length;
  const concluded = input.status === 'KONKLUDERET' || input.status === 'LAAST';
  const raw: (Omit<TrackingStep, 'state'> & { done: boolean })[] = [
    { key: 'oprettet', label: 'Sag oprettet', done: true },
    { key: 'bankliste', label: 'Bankliste godkendt', done: input.bankListApproved },
    { key: 'fuldmagt', label: 'Fuldmagt gyldig', done: input.authValid },
    { key: 'sendt', label: 'Sendt', counter: total ? `${sent}/${total}` : undefined, done: total > 0 && sent === total },
    { key: 'svar', label: 'Svar', counter: total ? `${answered}/${total}` : undefined, done: total > 0 && answered === total },
    { key: 'afstemt', label: 'Afstemt', counter: total ? `${reconciled}/${total}` : undefined, done: total > 0 && reconciled === total },
    { key: 'konkluderet', label: 'Konkluderet', done: concluded },
  ];
  const firstOpen = raw.findIndex((s) => !s.done);
  return raw.map(({ done, ...s }, i) => ({ ...s, state: done ? 'done' : i === firstOpen ? 'current' : 'todo' }));
}
