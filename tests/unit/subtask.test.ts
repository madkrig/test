import { describe, expect, it } from 'vitest';
import { createCalendar, deriveSubtaskStatus, isReviewReady, reminderSchedule } from '@/domain/bank-confirmations';
import { task } from './fixtures';

describe('påmindelsesdatoer', () => {
  it('første påmindelse efter forventet svartid fra statusdato; anden efter intervallet', () => {
    // 31.12.2026 + 10 arbejdsdage (1.1. er helligdag) = 15.01.2027; + 5 = 22.01.2027
    expect(reminderSchedule('2026-12-31', 10, createCalendar())).toEqual(['2027-01-15', '2027-01-22']);
  });
});

describe('subopgavens samlede status', () => {
  const base = { current: 'AWAITING_KERNE' as const, populationAwaitingApproval: false, openDecisions: 0, conclusionRecorded: false };
  const sent = { sentAt: '2026-12-03T09:00' };

  it('revisor først ved afventende godkendelse eller åben beslutning', () => {
    expect(deriveSubtaskStatus({ ...base, tasks: [task()], populationAwaitingApproval: true })).toBe('AWAITING_AUDITOR');
    expect(deriveSubtaskStatus({ ...base, tasks: [task({ status: 'AWAITING_BANK', ...sent })], openDecisions: 1 })).toBe('AWAITING_AUDITOR');
  });
  it('afventer bank, så længe en bank mangler svar', () => {
    expect(deriveSubtaskStatus({ ...base, tasks: [task({ status: 'AWAITING_BANK', ...sent }), task({ status: 'COMPLETED' })] })).toBe('AWAITING_BANK');
  });
  it('reviewpakke klar, når alle banker har endelig operationel status', () => {
    const ready = [task({ status: 'RECEIVED', responseId: 'r', administrativeCheckPassed: true, ...sent }), task({ status: 'COMPLETED' })];
    expect(deriveSubtaskStatus({ ...base, tasks: ready })).toBe('AWAITING_AUDITOR');
    expect(deriveSubtaskStatus({ ...base, tasks: ready, conclusionRecorded: true })).toBe('AWAITING_KERNE');
  });
  it('modtaget, mens administrativ kontrol mangler', () => {
    expect(deriveSubtaskStatus({ ...base, tasks: [task({ status: 'RECEIVED', responseId: 'r', ...sent })] })).toBe('RECEIVED');
  });
  it('alternativ håndtering uden svar tæller som klar efter revisors beslutning', () => {
    expect(isReviewReady(task({ status: 'AWAITING_KERNE', ...sent }))).toBe(true);
    expect(isReviewReady(task({ status: 'AWAITING_KERNE' }))).toBe(false);
  });
});
