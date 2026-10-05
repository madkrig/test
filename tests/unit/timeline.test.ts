import { describe, expect, it } from 'vitest';
import { addWorkdays, computeTimeline, createCalendar, formatDanish } from '@/domain/bank-confirmations';

const calendar = createCalendar();

describe('tidsplan (brief afsnit 6)', () => {
  const tl = computeTimeline('2026-12-31', '2027-02-15', calendar);

  it('beregner T-2 måneder og flytter lørdag til forudgående arbejdsdag', () => {
    expect(tl.activation.ruleDate).toBe('2026-10-31');
    expect(tl.activation.date).toBe('2026-10-30');
    expect(tl.activation.adjusted).toBe(true);
    expect(tl.activation.rule).toBe('T-2 måneder');
  });

  it('beregner T-6, T-5 og T-4 uger', () => {
    expect(tl.populationDeadline.date).toBe('2026-11-19');
    expect(tl.authorizationDeadline.date).toBe('2026-11-26');
    expect(tl.sendDate.date).toBe('2026-12-03');
    expect(tl.sendDate.adjusted).toBe(false);
  });

  it('beregner T-10 arbejdsdage fra revisors faglige deadline', () => {
    expect(tl.professionalEscalation.date).toBe('2027-02-01');
  });

  it('springer helligdage over ved arbejdsdagsberegning', () => {
    // 2027-03-30 (tirsdag) minus 3 arbejdsdage: 29/3, 28/3, 26/3, 25/3 er helligdage
    expect(addWorkdays('2027-03-30', -3, calendar)).toBe('2027-03-22');
  });

  it('klipper måneder til månedens sidste dag (30.04 − 2 mdr. = 28.02, søndag → 26.02)', () => {
    const t = computeTimeline('2027-04-30', '2027-06-15', calendar);
    expect(t.activation.ruleDate).toBe('2027-02-28');
    expect(t.activation.date).toBe('2027-02-26');
  });

  it('formaterer datoer som dd.mm.åååå', () => {
    expect(formatDanish('2026-12-03')).toBe('03.12.2026');
  });
});
