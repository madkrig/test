import { describe, expect, it } from 'vitest';
import {
  approvePopulation,
  assertEditable,
  createBankTasks,
  createDeltaVersion,
  findDuplicateSubtask,
  resolveMethodVersion,
} from '@/domain/bank-confirmations';
import { item, jonas, methods, population, sofie, subtask } from './fixtures';

const ctx = (existingTasks = [] as ReturnType<typeof createBankTasks>) => ({
  subtask,
  customerId: 'cust-nordhavn',
  sendDate: '2026-12-03',
  methods,
  existingTasks,
  newId: (i: { bankId: string }) => `bt-${i.bankId}`,
});

describe('BR-01 dubletkontrol', () => {
  it('finder eksisterende aktiv subopgave for samme revision og periode', () => {
    expect(findDuplicateSubtask([subtask], 'eng-nordhavn-2026', '2026-12-31')).toBe(subtask);
  });
  it('ignorerer inaktive subopgaver og andre perioder', () => {
    expect(findDuplicateSubtask([{ ...subtask, active: false }], 'eng-nordhavn-2026', '2026-12-31')).toBeUndefined();
    expect(findDuplicateSubtask([subtask], 'eng-nordhavn-2026', '2027-12-31')).toBeUndefined();
  });
});

describe('populationsgodkendelse (BR-03/04)', () => {
  it('kræver revisor', () => {
    expect(() => approvePopulation(population(), jonas, '2026-11-12T10:00')).toThrow(/Kun revisor/);
  });
  it('kræver begrundelse ved fjernelse', () => {
    const p = population({ items: [item('danske', 'Danske Bank'), item('nordea', 'Nordea', { change: 'REMOVED' })] });
    expect(() => approvePopulation(p, sofie, 'x')).toThrow(/kræver begrundelse/);
  });
  it('låser den godkendte version', () => {
    const approved = approvePopulation(population(), sofie, '2026-11-12T10:00');
    expect(approved.status).toBe('APPROVED');
    expect(approved.approvedBy).toBe(sofie.id);
    expect(() => assertEditable(approved)).toThrow(/låst/);
  });
  it('opretter ingen BankTasks før godkendelse', () => {
    expect(() => createBankTasks(population(), ctx())).toThrow(/først, når revisor har godkendt/);
  });
});

describe('BR-02 én BankTask pr. bank', () => {
  it('opretter præcis én opgave pr. godkendt bank', () => {
    const tasks = createBankTasks(approvePopulation(population(), sofie, 't'), ctx());
    expect(tasks.map((t) => t.bankId).sort()).toEqual(['danske', 'jyske', 'sydbank']);
    expect(new Set(tasks.map((t) => t.id)).size).toBe(3);
  });
  it('udelader fjernede banker', () => {
    const p = population({ items: [item('danske', 'Danske Bank'), item('nordea', 'Nordea', { change: 'REMOVED', removalReason: 'Konto lukket 2025' })] });
    const tasks = createBankTasks(approvePopulation(p, sofie, 't'), ctx());
    expect(tasks.map((t) => t.bankId)).toEqual(['danske']);
  });
  it('afviser populationer med samme bank to gange', () => {
    const p = population({ items: [item('danske', 'Danske Bank'), { ...item('danske', 'Danske Bank'), id: 'pi-2' }] });
    expect(() => approvePopulation(p, sofie, 't')).toThrow(/flere gange/);
  });
});

describe('BR-05 delta-versionering', () => {
  const v1 = approvePopulation(population(), sofie, 't');
  const v1Tasks = createBankTasks(v1, ctx());

  it('opretter version 2 med kun den nye bank', () => {
    const v2 = createDeltaVersion(v1, [item('nordea', 'Nordea', { sources: ['R75'], priorYearRelation: false })], 'pv-2');
    expect(v2.version).toBe(2);
    expect(v2.kind).toBe('DELTA');
    expect(v2.items).toHaveLength(1);
    expect(v2.items[0]?.change).toBe('ADDED');
  });

  it('opretter kun én ny BankTask og lader eksisterende være uændrede', () => {
    const v2 = approvePopulation(createDeltaVersion(v1, [item('nordea', 'Nordea')], 'pv-2'), sofie, 't2');
    const newTasks = createBankTasks(v2, ctx(v1Tasks));
    expect(newTasks.map((t) => t.bankId)).toEqual(['nordea']);
    expect(newTasks[0]?.changedAfterApproval).toBe(true);
  });

  it('afviser delta for en bank, der allerede er i populationen', () => {
    expect(() => createDeltaVersion(v1, [item('danske', 'Danske Bank')], 'pv-2')).toThrow(/findes allerede/);
  });

  it('kræver en godkendt basisversion', () => {
    expect(() => createDeltaVersion(population(), [item('nordea', 'Nordea')], 'pv-2')).toThrow(/godkendt version/);
  });
});

describe('BR-06 bankmetodeversion', () => {
  it('vælger højeste gældende version og fastholder den på opgaven', () => {
    expect(resolveMethodVersion('danske', methods, '2026-12-03')?.id).toBe('m-danske-3');
    const tasks = createBankTasks(approvePopulation(population(), sofie, 't'), ctx());
    expect(tasks.find((t) => t.bankId === 'danske')?.methodVersionId).toBe('m-danske-3');
  });
  it('blokerer opgaven, når metode mangler', () => {
    const p = population({ items: [item('ukendt', 'Ukendt Bank')] });
    const [t] = createBankTasks(approvePopulation(p, sofie, 't'), ctx());
    expect(t?.flags.blocked).toBe(true);
    expect(t?.nextOwner).toBe('Kerne Service Owner');
  });
});
