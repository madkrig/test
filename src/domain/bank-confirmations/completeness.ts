import { DEFAULT_CONFIG, type BankConfirmationConfig } from './config';
import { addMonths, compareDates, type IsoDate } from './dates';
import type { BankConfirmationSubtask, Customer, Engagement } from './entities';

/**
 * Separat månedlig fuldstændighedskontrol (brief afsnit 7).
 * Resultatet er afklaringsopgaver til revisor – aldrig automatiske bankforespørgsler.
 */
export interface ClarificationItem {
  engagementId: string;
  customerId: string;
  responsibleAuditorId: string;
  reason: 'NO_SUBTASK' | 'NEW_CUSTOMER_NO_HISTORY';
  decision: 'OPEN' | 'OPT_IN' | 'OPT_OUT';
  optOutReason?: string;
}

export interface CompletenessRun {
  runDate: IsoDate;
  windowEnd: IsoDate;
  populationSize: number;
  inWindow: number;
  withSubtask: number;
  items: ClarificationItem[];
}

export function runCompletenessControl(
  runDate: IsoDate,
  customers: readonly Customer[],
  engagements: readonly Engagement[],
  subtasks: readonly BankConfirmationSubtask[],
  customersWithHistory: ReadonlySet<string>,
  config: BankConfirmationConfig = DEFAULT_CONFIG,
): CompletenessRun {
  const activeCustomers = new Set(customers.filter((c) => c.active).map((c) => c.id));
  const windowEnd = addMonths(runDate, config.completenessControl.lookaheadMonths);
  const population = engagements.filter(
    (e) => e.active && activeCustomers.has(e.customerId) && config.completenessControl.statementTypes.includes(e.statementType),
  );
  const inWindow = population.filter((e) => compareDates(e.statusDate, runDate) >= 0 && compareDates(e.statusDate, windowEnd) <= 0);
  const covered = new Set(subtasks.filter((s) => s.active).map((s) => s.engagementId));
  const missing = inWindow.filter((e) => !covered.has(e.id));
  return {
    runDate,
    windowEnd,
    populationSize: population.length,
    inWindow: inWindow.length,
    withSubtask: inWindow.length - missing.length,
    items: missing.map((e) => ({
      engagementId: e.id,
      customerId: e.customerId,
      responsibleAuditorId: e.responsibleAuditorId,
      reason: customersWithHistory.has(e.customerId) ? 'NO_SUBTASK' : 'NEW_CUSTOMER_NO_HISTORY',
      decision: 'OPEN',
    })),
  };
}

/** Revisorens aktive valg: tilvalg, eller fravalg med begrundelse. */
export function decideClarification(
  item: ClarificationItem,
  decision: 'OPT_IN' | 'OPT_OUT',
  reason?: string,
): ClarificationItem {
  if (item.decision !== 'OPEN') throw new Error('Afklaringen er allerede besluttet.');
  if (decision === 'OPT_OUT' && !reason?.trim()) throw new Error('Fravalg kræver begrundelse.');
  return { ...item, decision, ...(decision === 'OPT_OUT' ? { optOutReason: reason } : {}) };
}
