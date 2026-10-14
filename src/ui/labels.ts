import { formatDanish, STATUS_LABELS, type BankTaskFlags, type SubtaskStatus } from '@/domain/bank-confirmations';

/** Visningstekster og ikoner. Status vises altid med både tekst og symbol (ikke kun farve). */
export type Tone = 'grey' | 'blue' | 'amber' | 'green' | 'red' | 'purple' | 'orange';
export interface Badge { icon: string; label: string; tone: Tone }

const STATUS_STYLE: Record<SubtaskStatus, Omit<Badge, 'label'>> = {
  INITIATED_KERNE: { icon: '○', tone: 'grey' },
  AWAITING_AUDITOR: { icon: '…', tone: 'amber' },
  AWAITING_KERNE: { icon: '…', tone: 'blue' },
  AWAITING_BANK: { icon: '…', tone: 'grey' },
  RECEIVED: { icon: '►', tone: 'green' },
  COMPLETED: { icon: '√', tone: 'green' },
};

export function statusBadge(status: string): Badge {
  const s = status as SubtaskStatus;
  return { ...(STATUS_STYLE[s] ?? { icon: '○', tone: 'grey' }), label: STATUS_LABELS[s] ?? status };
}

export const CHANGE: Record<string, Badge> = {
  ADDED: { icon: '+', label: 'Ny', tone: 'blue' },
  CHANGED: { icon: '✎', label: 'Ændret', tone: 'amber' },
  REMOVED: { icon: '−', label: 'Fjernet', tone: 'red' },
  UNCHANGED: { icon: '●', label: 'Uændret', tone: 'grey' },
  PROPOSED: { icon: '○', label: 'Forslag', tone: 'grey' },
};

export const SOURCE: Record<string, string> = {
  PRIOR_YEAR: 'Sidste år', R75: 'R75', ERP: 'ERP-system', CUSTOMER: 'Kunde', AUDITOR: 'Revisor',
};

export const CHANNEL: Record<string, string> = {
  PLATFORM: 'Platform', UPLOAD_PORTAL: 'Uploadportal', EMAIL: 'E-mail', OTHER: 'Særskilt portal',
};

/** Hændelser gemmer id'er og koder; vis navne og danske kanalnavne. */
export function humanize(text: string, name: (id: string) => string): string {
  return text
    .replace(/\bu-[a-z]+\b/g, (id) => name(id))
    .replace(/\b(PLATFORM|UPLOAD_PORTAL|EMAIL|OTHER)\b/g, (c) => CHANNEL[c] ?? c)
    .replace(/\baut-([0-9a-f]{8})\b/g, (_m, h: string) => `AUT-${h.toUpperCase()}`);
}

export const ROLE: Record<string, string> = {
  AUDITOR: 'Revisor', KERNE: 'Kerne', SERVICE_OWNER: 'Service Owner', METHOD_QUALITY: 'Metode og kvalitet',
  SYSTEM_ADMIN: 'Systemadministrator', SYSTEM: 'System',
};

export const EVENT: Record<string, string> = {
  ACTIVATED: 'Subopgave aktiveret', ITEM_ADDED: 'Bank tilføjet', ITEM_REMOVED: 'Bank fjernet', ITEM_CHANGED: 'Bank rettet',
  VERSION_CREATED: 'Ny populationsversion', SUBMITTED: 'Populationsforslag indsendt', APPROVED: 'Godkendt',
  REJECTED: 'Returneret', DELTA_CREATED: 'Delta-version oprettet', CREATED: 'Oprettet', STATUS_CHANGED: 'Status ændret',
  ASSIGNED: 'Tildelt', FOUR_EYES_APPROVED: 'Fire-øjne godkendt', REQUEST_SENT: 'Anmodning sendt', REMINDER_SENT: 'Påmindelse sendt',
  RESPONSE_RECEIVED: 'Svar registreret', ADMIN_CHECK_PASSED: 'Administrativ kontrol bestået', ADMIN_CHECK_FAILED: 'Administrativ kontrol fejlede',
  ARCHIVED_SHAREPOINT: 'Uploadet til SharePoint', ARCHIVE_FAILED: 'SharePoint-upload fejlede', DECISION_REQUESTED: 'Faglig beslutning anmodet',
  DECIDED: 'Beslutning truffet', CONCLUSION_RECORDED: 'Faglig konklusion registreret', REVIEW_NOTE_RESOLVED: 'Review note lukket',
  OPT_IN: 'Tilvalgt', OPT_OUT: 'Fravalgt', RUN: 'Kontrol kørt', DRAFT_CREATED: 'Metodeudkast oprettet', CHANGED: 'Ændret',
  ACCESS_DENIED: 'Adgang nægtet', DEMO_DATE_SET: 'Demodato ændret', DEMO_RESET: 'Demodata nulstillet',
};

export interface FlagSource {
  status: string;
  sentAt?: string | undefined | null;
  responseId?: string | undefined | null;
  administrativeCheckPassed?: boolean;
  flags: BankTaskFlags;
}

/** Det vigtigste flag for en bankopgave – samme prioritet som arbejdskøen. */
export function primaryFlag(t: FlagSource): Badge | null {
  if (t.status === 'COMPLETED') return null;
  if (t.flags.blocked) return { icon: '■', label: 'Blokeret', tone: 'red' };
  if (t.flags.deadlineExceeded) return { icon: '■', label: 'Frist overskredet', tone: 'red' };
  if (t.flags.professionalActionRequired) return { icon: '▲', label: 'Faglig handling krævet', tone: 'orange' };
  if (t.flags.exception) return { icon: '▲', label: 'Undtagelse', tone: 'orange' };
  if (t.status === 'AWAITING_KERNE' && !t.sentAt) {
    if (t.flags.missingAuthorization) return { icon: '!', label: 'Manglende autorisation', tone: 'red' };
    if (t.flags.fourEyesRequired) return { icon: '◆', label: 'Fire-øjne krævet', tone: 'purple' };
    return { icon: '►', label: 'Klar til udsendelse', tone: 'green' };
  }
  if (t.status === 'RECEIVED' && !t.administrativeCheckPassed) return { icon: '►', label: 'Svar til kontrol', tone: 'green' };
  return null;
}

/** Kort, læsbar reference til en bankopgave (fx BT-1A2B). */
export const taskRef = (id: string) => `BT-${id.replace(/^bt-/, '').slice(0, 4).toUpperCase()}`;

export const da = (d: string | null | undefined) => (d ? formatDanish(d.slice(0, 10)) : '–');
/** "30.10 08:00" */
export const stamp = (ts: string) => `${ts.slice(8, 10)}.${ts.slice(5, 7)} ${ts.slice(11, 16)}`;
/** "26.11" */
export const dayMonth = (d: string | null | undefined) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}` : '–');

export const engagementLabel = (e: { statementType: string; periodEnd: string }) =>
  `${e.statementType === 'REVISION' ? 'Revision' : 'Udvidet gennemgang'} ${e.periodEnd.slice(0, 4)}`;
