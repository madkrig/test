import { describe, expect, it } from 'vitest';
import {
  addWorkdays, bankListCompleteness, can, canCloseDeviation, canSeeCase, canTransitionInquiry, caseTimeline, checkSigners,
  DEFAULT_PARAMS, deriveCaseStatus, easterSunday, evaluateAuthorization, followUpDates, paramsAt, parseSigningRule,
  proposeSigners, reconcile, resolveParams, responseDeadline, sendWindow, signingRightsDeviation, toDkkOre, trackingSteps,
  verifyBeforeSend, type AuthRecord, type Person,
} from '@/domain/ef';

const T = '2026-12-31';
const P = '2027-03-15';

describe('kalender og årshjul (afsnit 6.7, sæson 2026/27)', () => {
  it('beregner påske og helligdage for alle år', () => {
    expect(easterSunday(2026)).toBe('2026-04-05');
    expect(easterSunday(2027)).toBe('2027-03-28');
    expect(easterSunday(2028)).toBe('2028-04-16');
    expect(addWorkdays('2026-12-31', 1)).toBe('2027-01-04'); // 1.1 helligdag, 2.–3.1 weekend
  });

  it('giver designets konkrete datoer for balancedag 31.12.2026', () => {
    const t = caseTimeline(T, P, DEFAULT_PARAMS);
    expect(t.create).toBe('2026-11-02'); // T−60 = søndag 1.11 → mandag 2.11
    expect(t.proposal).toBe('2026-11-16'); // T−45
    expect(t.approvalDeadline).toBe('2026-12-01'); // T−30
    expect(t.authDeadline).toBe('2026-12-21'); // T−10
    expect(t.standardSend).toBe('2027-01-04'); // første hverdag efter T
    expect(t.bankListReminder).toBe('2026-11-26'); // T−35
    expect(t.bankListEscalation).toBe('2026-12-03'); // T−28
  });

  it('planlægger forudbestilling (Nordea 1.–15.12) og standardafsendelse (TR-10)', () => {
    expect(sendWindow(T, { earliestSendOffset: -30, latestSendOffset: -16, responseWorkdays: 20 }, DEFAULT_PARAMS))
      .toEqual({ planned: '2026-12-01', due: '2026-12-15', preorder: true });
    const standard = sendWindow(T, { earliestSendOffset: 1, responseWorkdays: 4 }, DEFAULT_PARAMS);
    expect(standard.planned).toBe('2027-01-04');
    expect(standard.preorder).toBe(false);
  });

  it('beregner svarfrist med sæsonfrist (ER-01) og rykkere/eskalering (ER-02, ER-03)', () => {
    expect(responseDeadline('2027-01-04', T, { earliestSendOffset: 1, responseWorkdays: 4 })).toBe('2027-01-08');
    expect(responseDeadline('2026-12-01', T, { earliestSendOffset: -30, responseWorkdays: 20, seasonDeadline: '02-26' })).toBe('2027-02-26');
    const f = followUpDates('2027-01-08', P, DEFAULT_PARAMS);
    expect(f).toEqual({ reminder1: '2027-01-13', reminder2: '2027-01-20', escalation: '2027-01-27' });
    // P−15 kommer før frist + 13 hverdage
    expect(followUpDates('2027-03-01', P, DEFAULT_PARAMS).escalation).toBe('2027-02-26');
  });

  it('bruger regelversionen, der gjaldt på datoen (6.8)', () => {
    const versions = [
      { ruleId: 'ER-02', version: 1, params: { rykker1Hverdage: 3, rykker2Hverdage: 8 }, activeFrom: '2026-01-01', activeTo: '2027-02-01' },
      { ruleId: 'ER-02', version: 2, params: { rykker1Hverdage: 2, rykker2Hverdage: 6 }, activeFrom: '2027-02-01', activeTo: null },
    ];
    expect(paramsAt(versions, 'ER-02', '2026-11-02')).toEqual({ rykker1Hverdage: 3, rykker2Hverdage: 8 });
    expect(resolveParams(versions, '2027-03-01').reminder1Workdays).toBe(2);
  });
});

describe('tegningsregler (FR-02, US-K-04)', () => {
  const mgmt: Person[] = [
    { unitNumber: 'p1', name: 'Mette Hansen', role: 'DIREKTOER' },
    { unitNumber: 'p2', name: 'Lars Holm', role: 'FORMAND' },
    { unitNumber: 'p3', name: 'Anne Kjær', role: 'BESTYRELSESMEDLEM' },
  ];
  const rule = 'Selskabet tegnes af to medlemmer af bestyrelsen i forening eller af en direktør i forening med et medlem af bestyrelsen.';

  it('fortolker standardformuleringer og afviser fritekst', () => {
    expect(parseSigningRule(rule)).toEqual([
      [{ group: 'BESTYRELSE', count: 2 }],
      [{ group: 'DIREKTOER', count: 1 }, { group: 'BESTYRELSE', count: 1 }],
    ]);
    expect(parseSigningRule('Selskabet tegnes af direktionen.')).toEqual([[{ group: 'DIREKTOER', count: 'ALLE' }]]);
    expect(parseSigningRule('Selskabet tegnes af bestyrelsesformanden alene.')).toEqual([[{ group: 'FORMAND', count: 1 }]]);
    expect(parseSigningRule('Selskabet tegnes af den administrerende direktør efter bestyrelsens nærmere bestemmelse.')).toBeNull();
  });

  it('kontrollerer underskriverne og siger, hvem der mangler', () => {
    expect(checkSigners(rule, ['p1', 'p3'], mgmt).status).toBe('OK');
    expect(checkSigners(rule, ['p2', 'p3'], mgmt).status).toBe('OK');
    const one = checkSigners(rule, ['p1'], mgmt);
    expect(one).toMatchObject({ status: 'MANGLER', missing: ['1 bestyrelsesmedlem'] });
    expect(checkSigners('Selskabet tegnes af direktionen.', [], mgmt)).toMatchObject({ status: 'MANGLER', missing: ['Mette Hansen'] });
    expect(checkSigners('Noget helt andet.', ['p1'], mgmt).status).toBe('MANUEL');
  });

  it('foreslår den mindste kreds af underskrivere', () => {
    expect(proposeSigners(rule, mgmt)!.map((p) => p.unitNumber).sort()).toEqual(['p1', 'p3']);
  });
});

describe('fuldmagtskontrol (FR-01–FR-06)', () => {
  const params = DEFAULT_PARAMS;
  const base: AuthRecord = { id: 'f1', status: 'GYLDIG', scope: 'GENEREL', instituteId: null, holderCvr: params.holderCvr, signedDate: '2024-03-01', signerUnits: ['p1'] };
  const ctx = { today: '2026-11-02', signingRuleChangedAt: '2020-01-01', management: [{ unitNumber: 'p1', from: '2019-01-01', to: null }] };

  it('mangler for førstegangskunder og ved bankspecifikt krav', () => {
    expect(evaluateAuthorization([], ctx, params)).toMatchObject({ result: 'MANGLER', ruleId: null });
    expect(evaluateAuthorization([base], { ...ctx, institute: { id: 'nyk', authRequirement: 'BANKSPECIFIK', authMaxAgeMonths: null } }, params))
      .toMatchObject({ result: 'MANGLER', ruleId: 'FR-01' });
  });

  it('kræver fornyelse ved tidligere enhed, ny tegningsregel og alder', () => {
    expect(evaluateAuthorization([{ ...base, holderCvr: '30000002' }], ctx, params)).toMatchObject({ result: 'SKAL_FORNYES', ruleId: 'FR-03' });
    expect(evaluateAuthorization([base], { ...ctx, signingRuleChangedAt: '2025-06-01' }, params)).toMatchObject({ result: 'SKAL_FORNYES', ruleId: 'FR-04' });
    expect(evaluateAuthorization([base], { ...ctx, institute: { id: 'x', authRequirement: 'GENEREL', authMaxAgeMonths: 24 } }, params)).toMatchObject({ result: 'SKAL_FORNYES', ruleId: 'FR-06' });
  });

  it('bør fornyes, når en underskriver er udtrådt (FR-05), ellers gyldig', () => {
    expect(evaluateAuthorization([base], { ...ctx, management: [{ unitNumber: 'p1', from: '2019-01-01', to: '2026-06-30' }] }, params)).toMatchObject({ result: 'BOER_FORNYES', ruleId: 'FR-05' });
    expect(evaluateAuthorization([base], ctx, params)).toMatchObject({ result: 'GYLDIG', authId: 'f1' });
  });
});

describe('verifikation før afsendelse (VR) og bankliste (VR-08)', () => {
  const ok = {
    today: '2027-01-04', cvrStatus: 'NORMAL' as const, balanceDate: T, periodEnd: T, bankListApproved: true, authCheck: 'GYLDIG' as const,
    instituteKnown: true, duplicateOpen: false, replyTo: 'ef@cedra.example', centralMailbox: 'ef@cedra.example', plannedSendDate: '2027-01-04',
  };

  it('blokerer, til alle forudsætninger er opfyldt', () => {
    expect(verifyBeforeSend(ok)).toEqual({ blockers: [], warnings: [] });
    const blocked = verifyBeforeSend({ ...ok, bankListApproved: false, authCheck: 'SKAL_FORNYES', today: '2026-12-20', cvrStatus: 'KONKURS' });
    expect(blocked.blockers.map((b) => b.ruleId)).toEqual(['VR-03', 'VR-04', 'VR-09']);
    expect(blocked.warnings.map((w) => w.ruleId)).toEqual(['VR-01']);
  });

  it('advarer om institutter fra sidste år eller SAF-T uden begrundet fravalg', () => {
    const lines = [
      { instituteId: 'danske', included: true, deselectReason: null },
      { instituteId: 'nordea', included: false, deselectReason: 'Alle engagementer ophørt før balancedagen' },
      { instituteId: 'jyske', included: false, deselectReason: '' },
    ];
    expect(bankListCompleteness(lines, { lastYear: ['danske', 'nordea', 'jyske'], saft: ['al'] })).toEqual(['jyske', 'al']);
  });
});

describe('afstemning (AR-05–AR-10) – figur 9', () => {
  const lines = [
    { id: 'l1', category: 'INDLAAN' as const, accountRef: '••••0412', description: 'Indlån', amountDkkOre: 48523017 },
    { id: 'l2', category: 'INDLAAN' as const, accountRef: '••••0498', description: 'Indlån (EUR)', amountDkkOre: 9247624 },
    { id: 'l3', category: 'KREDIT' as const, accountRef: '••••7731', description: 'Kassekredit', amountDkkOre: -125000000 },
    { id: 'l4', category: 'UDLAAN' as const, accountRef: '••••5520', description: 'Lån', amountDkkOre: -312000000 },
    { id: 'l5', category: 'DEPOT' as const, accountRef: '••••9001', description: 'Depot', amountDkkOre: 31000000 },
    { id: 'l6', category: 'GARANTI' as const, accountRef: null, description: 'Huslejegaranti', amountDkkOre: 15000000 },
  ];
  const booked = [
    { id: 'b1', accountRef: '0412', name: 'Bank, drift', balanceOre: 48523017 },
    { id: 'b2', accountRef: '0498', name: 'Bank, EUR', balanceOre: 9247624 },
    { id: 'b3', accountRef: '5520', name: 'Prioritetslån', balanceOre: -310000000 },
    { id: 'b4', accountRef: '9001', name: 'Depot', balanceOre: 31000000 },
    { id: 'b5', accountRef: '0455', name: 'Opsparing', balanceOre: 1260000 },
  ];

  it('matcher 3 af 6 og finder de tre afvigelser fra skitsen', () => {
    const { recon, deviations, notes } = reconcile(lines, booked, { toleranceOre: 0, trivialOre: 500000 });
    expect(recon.filter((r) => r.matchStatus === 'MATCH')).toHaveLength(3);
    expect(recon.map((r) => r.matchStatus)).toEqual(['MATCH', 'MATCH', 'KUN_I_SVAR', 'DIFFERENCE', 'MATCH', 'KUN_I_BOGFOERING']);
    expect(deviations.map((d) => [d.type, d.severity])).toEqual([
      ['KUN_I_SVAR', 'KRITISK'], ['SALDODIFFERENCE', 'VAESENTLIG'], ['KUN_I_BOGFOERING', 'VAESENTLIG'],
    ]);
    expect(recon[3]!.differenceOre).toBe(-2000000);
    expect(notes.map((n) => n.description)).toEqual(['Huslejegaranti']);
  });

  it('lukker differencer under grænsen for klart ubetydelige beløb automatisk', () => {
    const { deviations } = reconcile([{ ...lines[0]!, amountDkkOre: 48523117 }], [booked[0]!], { toleranceOre: 0, trivialOre: 500000 });
    expect(deviations[0]).toMatchObject({ severity: 'UVAESENTLIG', autoClosed: true });
  });

  it('omregner valuta (AR-10) og sammenligner tegningsret (AR-09)', () => {
    expect(toDkkOre(1239700, 'EUR', { EUR: 7.4597 })).toBe(9247790);
    expect(signingRightsDeviation(['Mette Hansen', 'Jens Ex'], ['Mette Hansen'])).toMatchObject({ type: 'TEGNINGSRET', severity: 'VAESENTLIG' });
    expect(signingRightsDeviation(['Mette Hansen'], ['Mette Hansen'])).toBeNull();
  });

  it('lader kun opgaveansvarlig revisor lukke kritiske og væsentlige afvigelser', () => {
    expect(canCloseDeviation('KRITISK', 'OR', true)).toBe(true);
    expect(canCloseDeviation('KRITISK', 'OR', false)).toBe(false);
    expect(canCloseDeviation('VAESENTLIG', 'KM', false)).toBe(false);
    expect(canCloseDeviation('FORKLARET', 'RM', false)).toBe(true);
  });
});

describe('statusmodel og pakkesporing', () => {
  it('følger figur 4 og afviser spring', () => {
    expect(canTransitionInquiry('KLADDE', 'KLAR')).toEqual({ ok: true });
    expect(canTransitionInquiry('AFVIST', 'SENDT')).toEqual({ ok: true });
    expect(canTransitionInquiry('KLADDE', 'SENDT').ok).toBe(false);
    expect(canTransitionInquiry('AFSLUTTET', 'SENDT').ok).toBe(false);
  });

  it('afleder sagens status af forespørgslerne', () => {
    const d = (inquiries: Parameters<typeof deriveCaseStatus>[0]['inquiries'], extra = {}) =>
      deriveCaseStatus({ current: 'FORBEREDES', bankListApproved: true, inquiries, openDeviationsForAuditor: 0, ...extra });
    expect(deriveCaseStatus({ current: 'PLANLAGT', bankListApproved: false, inquiries: [], openDeviationsForAuditor: 0 })).toBe('PLANLAGT');
    expect(d(['KLAR', 'KLADDE'])).toBe('FORBEREDES');
    expect(d(['SENDT', 'KLAR'])).toBe('AFSENDT');
    expect(d(['SVAR_MODTAGET', 'SENDT'])).toBe('SVAR_DELVIST');
    expect(d(['AFSLUTTET', 'SENDT'], { openDeviationsForAuditor: 1 })).toBe('AFVENTER_REVISOR');
    expect(d(['AFSLUTTET', 'AFSLUTTET', 'ANNULLERET'])).toBe('KLAR_TIL_KONKLUSION');
  });

  it('viser pakkesporing med tællere som i skitsen (Svar 2/3)', () => {
    const steps = trackingSteps({ status: 'SVAR_DELVIST', bankListApproved: true, authValid: true, inquiries: ['SVAR_MODTAGET', 'AFSLUTTET', 'SENDT'] });
    expect(steps.map((s) => `${s.label}${s.counter ? ` (${s.counter})` : ''}:${s.state}`)).toEqual([
      'Sag oprettet:done', 'Bankliste godkendt:done', 'Fuldmagt gyldig:done', 'Sendt (3/3):done', 'Svar (2/3):current', 'Afstemt (1/3):todo', 'Konkluderet:todo',
    ]);
  });
});

describe('rettigheder og dataadgang (kap. 10)', () => {
  it('følger rettighedsmatricen', () => {
    expect(can('OR', 'APPROVE_BANKLIST')).toBe(true);
    expect(can('RM', 'APPROVE_BANKLIST')).toBe(false);
    expect(can('RM', 'APPROVE_BANKLIST', { delegated: true })).toBe(true);
    expect(can('KM', 'CLOSE_CRITICAL')).toBe(false);
    expect(can('AGENT', 'SEND_INQUIRY')).toBe(false); // agenter foreslår kun
    expect(can('KL', 'APPROVE_CHANNEL_CHANGE')).toBe(true);
    expect(can('KM', 'EDIT_RULES')).toBe(false);
  });

  it('håndhæver habilitet, fortrolighed og team på sagsniveau', () => {
    const c = { responsibleId: 'or1', teamUserIds: ['rm1'], delegateId: null, conflictUserIds: ['km2'], confidential: false, confidentialUserIds: [] };
    expect(canSeeCase({ id: 'or1', role: 'OR' }, c)).toBe(true);
    expect(canSeeCase({ id: 'or2', role: 'OR' }, c)).toBe(false);
    expect(canSeeCase({ id: 'km1', role: 'KM' }, c)).toBe(true);
    expect(canSeeCase({ id: 'km2', role: 'KM' }, c)).toBe(false);
    expect(canSeeCase({ id: 'admin', role: 'ADMIN' }, c)).toBe(false);
    expect(canSeeCase({ id: 'km1', role: 'KM' }, { ...c, confidential: true, confidentialUserIds: ['or1'] })).toBe(false);
  });
});
