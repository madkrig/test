import { describe, expect, it } from 'vitest';
import {
  canTransition,
  defaultDocumentTitle,
  eventKey,
  findService,
  nextStep,
  progress,
  signersFor,
  type SigningPerson,
} from '@/domain/e-signing';

const person = (id: string, role: SigningPerson['role'], extra: Partial<SigningPerson> = {}): SigningPerson => ({
  id, name: id, email: `${id}@kunde.example`, role, active: true, ...extra,
});

const annualReport = findService('ANNUAL_REPORT')!;
const representation = findService('MANAGEMENT_REPRESENTATION')!;
const protocol = findService('AUDIT_PROTOCOL')!;

describe('statusmodel', () => {
  it('tillader kun forløbet afventer → underskrevet → fuldført eller afvist', () => {
    expect(canTransition('AWAITING_SIGNATURES', 'SIGNED')).toEqual({ ok: true });
    expect(canTransition('AWAITING_SIGNATURES', 'REJECTED')).toEqual({ ok: true });
    expect(canTransition('SIGNED', 'COMPLETED')).toEqual({ ok: true });
  });

  it('afviser spring og overgange fra endelige statusser med en forklaring', () => {
    const skip = canTransition('AWAITING_SIGNATURES', 'COMPLETED');
    expect(skip.ok).toBe(false);
    expect(!skip.ok && skip.reason).toContain('Tilladt: Underskrevet – arkiveres, Afvist');
    const final = canTransition('COMPLETED', 'SIGNED');
    expect(!final.ok && final.reason).toContain('ingen (endelig status)');
  });
});

describe('underskrivere fra stamdata', () => {
  const persons = [
    person('Bo', 'BOARD_MEMBER'),
    person('Anna', 'BOARD_MEMBER'),
    person('Carl', 'CHAIR'),
    person('Dorte', 'DIRECTOR'),
    person('Erik', 'BOARD_MEMBER', { active: false }),
  ];

  it('vælger ydelsens roller, udelader fratrådte og sorterer efter rolle og navn', () => {
    expect(signersFor(annualReport, persons).signers.map((s) => s.id)).toEqual(['Dorte', 'Carl', 'Anna', 'Bo']);
    expect(signersFor(representation, persons).signers.map((s) => s.id)).toEqual(['Dorte']);
    expect(signersFor(protocol, persons).signers.map((s) => s.id)).toEqual(['Carl', 'Anna', 'Bo']);
  });

  it('blokerer ved manglende e-mail', () => {
    const { blockers } = signersFor(representation, [person('Dorte', 'DIRECTOR', { email: null })]);
    expect(blockers).toEqual(['Dorte (Direktør) mangler e-mail i stamdata.']);
  });

  it('blokerer, når kunden ikke har nogen med de krævede roller', () => {
    const { signers, blockers } = signersFor(protocol, [person('Dorte', 'DIRECTOR')]);
    expect(signers).toHaveLength(0);
    expect(blockers).toEqual(['Kunden har ingen aktive underskrivere med rollen bestyrelsesformand eller bestyrelsesmedlem i stamdata.']);
  });
});

describe('næste handling i Opgaver', () => {
  const signers = [
    { name: 'Mette', status: 'SIGNED' as const },
    { name: 'Lars', status: 'PENDING' as const },
    { name: 'Anne', status: 'PENDING' as const },
  ];
  const ctx = { archiveFailed: false, auditorName: 'Sofie Lund' };

  it('viser fremdrift og hvem der mangler at underskrive', () => {
    expect(progress(signers)).toEqual({ signed: 1, total: 3 });
    expect(nextStep('AWAITING_SIGNATURES', signers, ctx)).toEqual({ nextAction: 'Afventer underskrift (1/3)', nextOwner: 'Lars, Anne' });
  });

  it('sender en fejlet arkivering tilbage til revisor', () => {
    expect(nextStep('SIGNED', signers, ctx).nextOwner).toBe('System');
    expect(nextStep('SIGNED', signers, { ...ctx, archiveFailed: true })).toEqual({
      nextAction: 'Arkivering i SharePoint fejlede – prøv igen',
      nextOwner: 'Sofie Lund',
    });
    expect(nextStep('REJECTED', signers, ctx).nextOwner).toBe('Sofie Lund');
    expect(nextStep('COMPLETED', signers, ctx)).toEqual({ nextAction: '–', nextOwner: '–' });
  });
});

describe('katalog og Penneo', () => {
  it('foreslår regnskabsåret før underskriftsåret i titlen', () => {
    expect(defaultDocumentTitle(annualReport, 'Nordhavn Teknik A/S', '2026-10-05')).toBe('Årsrapport 2025 – Nordhavn Teknik A/S');
  });

  it('nøgler webhooks på topic og eventType', () => {
    expect(eventKey({ topic: 'casefile', eventType: 'completed' })).toBe('casefile.completed');
  });
});
