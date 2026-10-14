import { addWorkdays, calendar, toWorkday, type WorkdayCalendar } from './calendar';
import { addDays, minDate, type IsoDate } from './dates';
import type { RuleParams } from './rules';

/**
 * Årshjulets relative tidslinje (afsnit 6.7). T = balancedag, P = planlagt
 * påtegning. Datoer relativt til T flyttes til næste hverdag (som i
 * designets eksempel: T−60 = søndag 1.11 → mandag 2.11). Frister relativt
 * til P flyttes til forrige hverdag, så de ikke falder efter påtegningen.
 */
export interface CaseTimeline {
  create: IsoDate; // T−60 (TR-02)
  authCheck: IsoDate; // T−60 (TR-04)
  proposal: IsoDate; // T−45 (TR-05)
  bankListReminder: IsoDate; // T−35 (ER-06)
  approvalDeadline: IsoDate; // T−30 (TR-05)
  bankListEscalation: IsoDate; // T−28 (ER-06)
  authDeadline: IsoDate; // T−10 (TR-04)
  standardSend: IsoDate; // første hverdag efter T (TR-10)
  standardSendDeadline: IsoDate; // T+5 hverdage (SOP-EF-04)
  alternativesDeadline: IsoDate; // P−10
  conclusionDeadline: IsoDate; // P−5 (ER-08)
}

export function caseTimeline(T: IsoDate, P: IsoDate, params: RuleParams, cal: WorkdayCalendar = calendar): CaseTimeline {
  const beforeT = (days: number) => toWorkday(addDays(T, -days), 'next', cal);
  const beforeP = (days: number) => toWorkday(addDays(P, -days), 'previous', cal);
  return {
    create: beforeT(params.createDaysBeforeT),
    authCheck: beforeT(params.authCheckDaysBeforeT),
    proposal: beforeT(params.proposalDaysBeforeT),
    bankListReminder: beforeT(params.bankListReminderDaysBeforeT),
    approvalDeadline: beforeT(params.approvalDaysBeforeT),
    bankListEscalation: beforeT(params.bankListEscalationDaysBeforeT),
    authDeadline: beforeT(params.authDeadlineDaysBeforeT),
    standardSend: addWorkdays(T, params.sendWorkdaysAfterT, cal),
    standardSendDeadline: addWorkdays(T, 5, cal),
    alternativesDeadline: beforeP(10),
    conclusionDeadline: beforeP(params.concludeWarningDaysBeforeP),
  };
}

export interface InstituteTiming {
  earliestSendOffset: number;
  latestSendOffset?: number | null;
  responseWorkdays: number;
  seasonDeadline?: string | null; // "MM-DD" efter balancedag 31.12
}

/** TR-10: planlagt afsendelse og frist for at sende (forudbestilling eller T+5 hverdage). */
export function sendWindow(T: IsoDate, inst: InstituteTiming, params: RuleParams, cal: WorkdayCalendar = calendar): { planned: IsoDate; due: IsoDate; preorder: boolean } {
  const standard = addWorkdays(T, params.sendWorkdaysAfterT, cal);
  if (inst.earliestSendOffset < 0) {
    const planned = toWorkday(addDays(T, inst.earliestSendOffset), 'next', cal);
    const due = inst.latestSendOffset != null ? toWorkday(addDays(T, inst.latestSendOffset), 'previous', cal) : addWorkdays(T, 5, cal);
    return { planned, due, preorder: true };
  }
  const offsetDate = toWorkday(addDays(T, inst.earliestSendOffset), 'next', cal);
  const planned = offsetDate > standard ? offsetDate : standard;
  return { planned, due: addWorkdays(planned, 4, cal), preorder: false };
}

/**
 * ER-01: svarfrist = afsendelse + svartid; ved årsskiftet sæsonfristen, hvis
 * den er længere. En forudbestilling kan først besvares efter balancedagen,
 * så svartiden regnes fra T, hvis forespørgslen er sendt før.
 */
export function responseDeadline(sent: IsoDate, T: IsoDate, inst: InstituteTiming, cal: WorkdayCalendar = calendar): IsoDate {
  const sla = addWorkdays(sent > T ? sent : T, inst.responseWorkdays, cal);
  if (inst.seasonDeadline && T.endsWith('-12-31')) {
    const season = `${Number(T.slice(0, 4)) + 1}-${inst.seasonDeadline}`;
    if (season > sla) return season;
  }
  return sla;
}

/** ER-02 og ER-03: rykkere og eskalering for en sendt forespørgsel. */
export function followUpDates(deadline: IsoDate, P: IsoDate, params: RuleParams, cal: WorkdayCalendar = calendar) {
  const escalationByP = toWorkday(addDays(P, -params.escalationDaysBeforeP), 'previous', cal);
  return {
    reminder1: addWorkdays(deadline, params.reminder1Workdays, cal),
    reminder2: addWorkdays(deadline, params.reminder2Workdays, cal),
    escalation: minDate(addWorkdays(deadline, params.escalationWorkdays, cal), escalationByP),
  };
}

/** ER-05: påmindelser og eskalering for en fuldmagt sendt til signering. */
export function authFollowUp(sentForSigning: IsoDate, params: RuleParams) {
  return {
    reminders: params.authReminderDays.map((d) => addDays(sentForSigning, d)),
    escalation: addDays(sentForSigning, params.authEscalationDay),
  };
}

/** Den relative tidslinje som tabel – vist i årshjulet (S08). */
export function relativeTimeline(T: IsoDate, P: IsoDate, params: RuleParams) {
  const t = caseTimeline(T, P, params);
  return [
    { when: `T−${params.createDaysBeforeT}`, date: t.create, activity: 'Sag oprettes, fuldmagtskontrol; fuldmagtsanmodninger sendes', owner: 'EF-service · kernemedarbejder', rules: 'TR-01, TR-02, TR-04' },
    { when: `T−${params.proposalDaysBeforeT}`, date: t.proposal, activity: 'Forslag til bankliste klar til revisor', owner: 'EF-service', rules: 'TR-05' },
    { when: `T−${params.bankListReminderDaysBeforeT}`, date: t.bankListReminder, activity: 'Påmindelse, hvis banklisten ikke er godkendt', owner: 'EF-service', rules: 'ER-06' },
    { when: `T−${params.approvalDaysBeforeT}`, date: t.approvalDeadline, activity: 'Bankliste godkendt', owner: 'Opgaveansvarlig revisor', rules: 'VR-03' },
    { when: `T−${params.bankListEscalationDaysBeforeT}`, date: t.bankListEscalation, activity: 'Eskalering til kerneteamleder, hvis banklisten ikke er godkendt', owner: 'EF-service', rules: 'ER-06' },
    { when: `T−${params.authDeadlineDaysBeforeT}`, date: t.authDeadline, activity: 'Fuldmagter underskrevet og verificeret', owner: 'Kernemedarbejder · kunde', rules: 'VR-04' },
    { when: `T+${params.sendWorkdaysAfterT} → T+5 hverdage`, date: t.standardSend, activity: 'Afsendelse til øvrige institutter', owner: 'Kernemedarbejder', rules: 'TR-10' },
    { when: `Frist +${params.reminder1Workdays} / +${params.reminder2Workdays}`, date: null, activity: '1. og 2. rykker', owner: 'Kernemedarbejder', rules: 'ER-02' },
    { when: `Frist +${params.escalationWorkdays} eller P−${params.escalationDaysBeforeP}`, date: null, activity: 'Eskalering til revisor', owner: 'EF-service · revisor', rules: 'ER-03' },
    { when: 'P−10', date: t.alternativesDeadline, activity: 'Afvigelser og alternative handlinger afsluttet', owner: 'Revisor', rules: '–' },
    { when: `P−${params.concludeWarningDaysBeforeP}`, date: t.conclusionDeadline, activity: 'Konklusion', owner: 'Opgaveansvarlig revisor', rules: 'ER-08' },
  ];
}
