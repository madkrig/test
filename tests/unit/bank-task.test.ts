import { describe, expect, it } from 'vitest';
import {
  assertSharePointUpload,
  bankTaskCompletionBlockers,
  bulkApprovalBlockers,
  canTransitionBankTask,
  canTransitionSubtask,
  documentLocation,
  fourEyesReasons,
  reminderBlockers,
  requiresProfessionalEscalation,
  sendBlockers,
  subtaskCompletionBlockers,
  validateFourEyesReviewer,
} from '@/domain/bank-confirmations';
import { amalie, authorization, jonas, martin, method, methods, population, response, sofie, task } from './fixtures';

const sydbank = methods.find((m) => m.id === 'm-sydbank-2');
const danske = methods.find((m) => m.id === 'm-danske-3');

describe('statusovergange', () => {
  it('tillader den definerede kæde og forklarer afvisning', () => {
    expect(canTransitionSubtask('INITIATED_KERNE', 'AWAITING_AUDITOR').ok).toBe(true);
    const bad = canTransitionSubtask('INITIATED_KERNE', 'COMPLETED');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toMatch(/Ugyldig overgang.*Tilladt: Afventer revisor/);
    expect(canTransitionBankTask('AWAITING_BANK', 'RECEIVED').ok).toBe(true);
    expect(canTransitionBankTask('COMPLETED', 'AWAITING_KERNE').ok).toBe(false);
  });
});

describe('BR-07 fire-øjne-kontrol', () => {
  it('kræves ved manuel e-mail', () => {
    expect(fourEyesReasons(task({ bankId: 'danske' }), danske, authorization())).toContain('Manuel e-mail til bank');
  });
  it('kræves ikke ved standard portaludsendelse', () => {
    expect(fourEyesReasons(task(), sydbank, authorization())).toEqual([]);
  });
  it('kræves ved ny metode, ændring efter godkendelse og atypisk autorisation', () => {
    const reasons = fourEyesReasons(
      task({ changedAfterApproval: true }),
      method('sydbank', { newOrChanged: true }),
      authorization({ atypical: true }),
    );
    expect(reasons).toHaveLength(3);
  });
  it('reviewer må ikke være performer', () => {
    expect(validateFourEyesReviewer(jonas.id, jonas)).toHaveLength(1);
    expect(validateFourEyesReviewer(jonas.id, amalie)).toEqual([]);
  });
});

describe('udsendelse', () => {
  it('tillades med gældende metode og gyldig autorisation', () => {
    expect(sendBlockers(task(), sydbank, authorization(), '2026-12-03')).toEqual([]);
  });
  it('blokeres indtil fire-øjne er udført', () => {
    const t = task({ id: 'bt-danske', bankId: 'danske', methodVersionId: 'm-danske-3' });
    expect(sendBlockers(t, danske, authorization(), '2026-12-03')).toContain('Fire-øjne-kontrol skal udføres før udsendelse.');
    expect(sendBlockers({ ...t, fourEyesCompleted: true }, danske, authorization(), '2026-12-03')).toEqual([]);
  });
  it('blokeres uden dækkende autorisation og ved dobbelt udsendelse', () => {
    expect(sendBlockers(task(), sydbank, authorization({ coveredBankTaskIds: [] }), '2026-12-03')).toHaveLength(1);
    expect(sendBlockers(task({ sentAt: '2026-12-03T09:00' }), sydbank, authorization(), '2026-12-03')[0]).toMatch(/allerede sendt/);
  });
});

describe('BR-08 påmindelser og T-10', () => {
  it('tillader højst to standardpåmindelser', () => {
    expect(reminderBlockers(task({ status: 'AWAITING_BANK', reminderCount: 1 }))).toEqual([]);
    expect(reminderBlockers(task({ status: 'AWAITING_BANK', reminderCount: 2 }))[0]).toMatch(/Maksimalt 2/);
  });
  it('kræver faglig eskalation ved manglende svar på eskalationsdatoen', () => {
    const t = task({ status: 'AWAITING_BANK', reminderCount: 2 });
    expect(requiresProfessionalEscalation(t, '2027-01-29', '2027-02-01')).toBe(false);
    expect(requiresProfessionalEscalation(t, '2027-02-01', '2027-02-01')).toBe(true);
    expect(requiresProfessionalEscalation({ ...t, responseId: 'r1' }, '2027-02-01', '2027-02-01')).toBe(false);
  });
});

describe('BR-09 dokumentplacering', () => {
  it('arkiverer kun banksvaret i SharePoint', () => {
    expect(documentLocation('BANK_RESPONSE')).toBe('SHAREPOINT');
    expect(documentLocation('AUTHORIZATION')).toBe('KERNE');
    expect(() => assertSharePointUpload('AUTHORIZATION')).toThrow(/Kun banksvaret/);
    expect(() => assertSharePointUpload('BANK_RESPONSE')).not.toThrow();
  });
});

describe('BR-10 afslutningsblokering', () => {
  it('bankopgave kan afsluttes med bestået kontrol og arkiveret svar', () => {
    expect(bankTaskCompletionBlockers(task({ status: 'RECEIVED', responseId: 'resp-1' }), response(), sydbank, authorization())).toEqual([]);
  });
  it('blokeres af manglende arkivering, åben undtagelse og manglende fire-øjne', () => {
    const t = task({ status: 'RECEIVED', responseId: 'resp-1', bankId: 'danske', methodVersionId: 'm-danske-3', flags: { ...task().flags, exception: true } });
    const blockers = bankTaskCompletionBlockers(t, response({ sharePointDocumentId: undefined }), danske, authorization());
    expect(blockers).toEqual(expect.arrayContaining(['Åben undtagelse.', 'Påkrævet fire-øjne-kontrol mangler.', 'Banksvaret er ikke arkiveret korrekt i SharePoint.']));
  });
  it('subopgaven kan ikke fuldføres med åben faglig undtagelse', () => {
    const tasks = [task({ status: 'COMPLETED' }), task({ id: 'bt-jyske', status: 'AWAITING_AUDITOR', flags: { ...task().flags, exception: true } })];
    const blockers = subtaskCompletionBlockers(tasks, 0, false);
    expect(blockers).toEqual(expect.arrayContaining(['1 bank(er) mangler endelig status.', 'Faglig undtagelse er ikke behandlet.', 'Revisors faglige konklusion mangler.']));
    expect(subtaskCompletionBlockers([task({ status: 'COMPLETED' })], 0, true)).toEqual([]);
  });
});

describe('R-06 massegodkendelse', () => {
  it('kun egne, undtagelsesfrie og indsendte populationer', () => {
    const ok = { version: population(), responsibleAuditorId: sofie.id, openQuestions: 0 };
    expect(bulkApprovalBlockers(sofie, ok)).toEqual([]);
    expect(bulkApprovalBlockers(martin, ok)).toContain('Du er ikke ansvarlig revisor på opgaven.');
    expect(bulkApprovalBlockers(sofie, { ...ok, openQuestions: 1 })).toContain('Opgaven har åbne spørgsmål.');
    expect(bulkApprovalBlockers(jonas, ok)).toContain('Rollen må ikke massegodkende.');
  });
});
