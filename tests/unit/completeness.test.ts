import { describe, expect, it } from 'vitest';
import { can, decideClarification, runCompletenessControl, type Customer, type Engagement } from '@/domain/bank-confirmations';
import { subtask } from './fixtures';

const customers: Customer[] = [
  { id: 'cust-nordhavn', name: 'Nordhavn Teknik A/S', cvr: '38472619', active: true, responsibleAuditorId: 'u-sofie', contactPerson: 'Peter Krogh' },
  { id: 'cust-fjord', name: 'Fjord & Form ApS', cvr: '29751468', active: true, responsibleAuditorId: 'u-sofie', contactPerson: 'Anne Fjord' },
  { id: 'cust-old', name: 'Lukket ApS', cvr: '11111111', active: false, responsibleAuditorId: 'u-martin', contactPerson: '–' },
];

const engagement = (id: string, customerId: string, statusDate: string, overrides: Partial<Engagement> = {}): Engagement => ({
  id,
  customerId,
  legalEntity: customerId,
  statementType: 'REVISION',
  periodStart: '2026-01-01',
  periodEnd: statusDate,
  statusDate,
  active: true,
  responsibleAuditorId: 'u-sofie',
  team: [],
  professionalDeadline: '2027-02-15',
  ...overrides,
});

const engagements = [
  engagement('eng-nordhavn-2026', 'cust-nordhavn', '2026-12-31'),
  engagement('eng-fjord-2026', 'cust-fjord', '2026-12-31'),
  engagement('eng-old-2026', 'cust-old', '2026-12-31'),
  engagement('eng-review', 'cust-nordhavn', '2026-12-31', { statementType: 'REVIEW', id: 'eng-review' }),
  engagement('eng-far', 'cust-nordhavn', '2027-06-30', { id: 'eng-far' }),
];

describe('månedlig fuldstændighedskontrol (brief afsnit 7)', () => {
  const run = runCompletenessControl('2026-11-01', customers, engagements, [subtask], new Set(['cust-nordhavn']));

  it('finder kun relevante revisioner uden subopgave i vinduet', () => {
    expect(run.items.map((i) => i.engagementId)).toEqual(['eng-fjord-2026']);
    expect(run.items[0]?.reason).toBe('NEW_CUSTOMER_NO_HISTORY');
    expect(run.withSubtask).toBe(1);
  });

  it('opretter afklaringer – ikke bankforespørgsler', () => {
    expect(run.items[0]?.decision).toBe('OPEN');
  });

  it('fravalg kræver begrundelse og logges på afklaringen', () => {
    const open = run.items[0]!;
    expect(() => decideClarification(open, 'OPT_OUT')).toThrow(/begrundelse/);
    expect(decideClarification(open, 'OPT_OUT', 'Ingen bankforbindelser').optOutReason).toBe('Ingen bankforbindelser');
    expect(decideClarification(open, 'OPT_IN').decision).toBe('OPT_IN');
  });
});

describe('rettigheder (brief afsnit 4)', () => {
  it('Kerne kan ikke godkende population; administrator har ingen faglig ret', () => {
    expect(can('KERNE', 'APPROVE_POPULATION')).toBe(false);
    expect(can('AUDITOR', 'APPROVE_POPULATION')).toBe(true);
    expect(can('SYSTEM_ADMIN', 'APPROVE_POPULATION')).toBe(false);
    expect(can('SERVICE_OWNER', 'APPROVE_BANK_METHOD')).toBe(true);
  });
});
