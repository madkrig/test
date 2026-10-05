/**
 * Statusmodel (brief afsnit 11). Briefet bruger de samme seks hovedstatusser
 * for subopgaven og bankopgaven; overgangene er forskellige, så de holdes
 * som to separate maskiner. Flag (blokeret, undtagelse, …) er separate felter.
 */
export const MAIN_STATUSES = [
  'INITIATED_KERNE',
  'AWAITING_AUDITOR',
  'AWAITING_KERNE',
  'AWAITING_BANK',
  'RECEIVED',
  'COMPLETED',
] as const;

export type SubtaskStatus = (typeof MAIN_STATUSES)[number];
export type BankTaskStatus = Exclude<SubtaskStatus, 'INITIATED_KERNE'>;

export const STATUS_LABELS: Record<SubtaskStatus, string> = {
  INITIATED_KERNE: 'Initieret – Kerne',
  AWAITING_AUDITOR: 'Afventer revisor',
  AWAITING_KERNE: 'Afventer Kerne',
  AWAITING_BANK: 'Afventer bank',
  RECEIVED: 'Modtaget',
  COMPLETED: 'Fuldført',
};

type TransitionMap<S extends string> = Record<S, Partial<Record<S, string>>>;

/** Subopgaven: værdien beskriver den forudsætning, der skal være opfyldt. */
export const SUBTASK_TRANSITIONS: TransitionMap<SubtaskStatus> = {
  INITIATED_KERNE: { AWAITING_AUDITOR: 'Populationen er klar til godkendelse' },
  AWAITING_AUDITOR: {
    AWAITING_KERNE: 'Revisor har godkendt populationen eller truffet faglig beslutning',
    AWAITING_BANK: 'Faglig beslutning er truffet; banker afventer fortsat svar',
    RECEIVED: 'Faglig beslutning er truffet; svar afventer administrativ kontrol',
    INITIATED_KERNE: 'Revisor har returneret populationen',
  },
  AWAITING_KERNE: {
    AWAITING_BANK: 'Mindst én anmodning er afsendt',
    AWAITING_AUDITOR: 'Faglig undtagelse eller ny delta-version kræver revisor',
    COMPLETED: 'Alle afslutningskontroller er opfyldt',
  },
  AWAITING_BANK: {
    RECEIVED: 'Alle afsendte banker har svaret',
    AWAITING_AUDITOR: 'Manglende svar eller undtagelse kræver faglig beslutning',
  },
  RECEIVED: {
    AWAITING_AUDITOR: 'Reviewpakken er klar eller en undtagelse kræver revisor',
    AWAITING_BANK: 'En ny bank (delta) er sendt og afventer svar',
  },
  COMPLETED: {},
};

export const BANK_TASK_TRANSITIONS: TransitionMap<BankTaskStatus> = {
  AWAITING_KERNE: {
    AWAITING_BANK: 'Anmodningen er afsendt efter bankmetoden',
    COMPLETED: 'Faglig beslutning om alternativ håndtering er truffet og kontrollerne er opfyldt',
    AWAITING_AUDITOR: 'Kerne har eskaleret en undtagelse, fx uklar tegningsret',
  },
  AWAITING_BANK: {
    RECEIVED: 'Banksvaret er modtaget',
    AWAITING_AUDITOR: 'Manglende svar ved T-10 kræver faglig beslutning',
  },
  RECEIVED: {
    AWAITING_AUDITOR: 'Administrativ kontrol har fundet en faglig undtagelse',
    COMPLETED: 'Administrativ kontrol er bestået og banksvaret er arkiveret',
  },
  AWAITING_AUDITOR: {
    AWAITING_KERNE: 'Revisor har truffet beslutning',
    AWAITING_BANK: 'Revisor har besluttet at afvente yderligere svar',
  },
  COMPLETED: {},
};

export type TransitionResult = { ok: true } | { ok: false; reason: string };

function check<S extends string>(map: TransitionMap<S>, from: S, to: S, labels: Record<string, string>): TransitionResult {
  if (map[from][to]) return { ok: true };
  const allowed = Object.keys(map[from]) as S[];
  const options = allowed.length ? allowed.map((s) => labels[s]).join(', ') : 'ingen (endelig status)';
  return { ok: false, reason: `Ugyldig overgang fra "${labels[from]}" til "${labels[to]}". Tilladt: ${options}.` };
}

export function canTransitionSubtask(from: SubtaskStatus, to: SubtaskStatus): TransitionResult {
  return check(SUBTASK_TRANSITIONS, from, to, STATUS_LABELS);
}

export function canTransitionBankTask(from: BankTaskStatus, to: BankTaskStatus): TransitionResult {
  return check(BANK_TASK_TRANSITIONS, from, to, STATUS_LABELS);
}
