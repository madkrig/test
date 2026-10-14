/**
 * Statusmodeller (afsnit 3.5, figur 4). Forespørgslen har en fast
 * overgangsmaskine; sagens status afledes af forespørgslerne.
 */
export const INQUIRY_STATUSES = [
  'KLADDE', 'KLAR', 'SENDT', 'RYKKET', 'AFVIST', 'SVAR_MODTAGET', 'AFVENTER_REVISOR', 'UDEN_SVAR', 'AFSLUTTET', 'ANNULLERET',
] as const;
export type InquiryStatus = (typeof INQUIRY_STATUSES)[number];

export const INQUIRY_STATUS_LABELS: Record<InquiryStatus, string> = {
  KLADDE: 'Kladde',
  KLAR: 'Klar til afsendelse',
  SENDT: 'Sendt',
  RYKKET: 'Rykket',
  AFVIST: 'Afvist af pengeinstitut',
  SVAR_MODTAGET: 'Svar modtaget',
  AFVENTER_REVISOR: 'Afventer revisor',
  UDEN_SVAR: 'Uden svar – alternative handlinger',
  AFSLUTTET: 'Afsluttet',
  ANNULLERET: 'Annulleret',
};

/** Værdien beskriver, hvad der udløser overgangen. */
const INQUIRY_TRANSITIONS: Record<InquiryStatus, Partial<Record<InquiryStatus, string>>> = {
  KLADDE: { KLAR: 'P06: forudsætninger opfyldt', ANNULLERET: 'Annulleret før afsendelse' },
  KLAR: { SENDT: 'P07: afsendt', KLADDE: 'En forudsætning er ikke længere opfyldt', ANNULLERET: 'Annulleret før afsendelse' },
  SENDT: { RYKKET: 'Frist overskredet', AFVIST: 'Afvist af instituttet', SVAR_MODTAGET: 'Svar indgår', UDEN_SVAR: 'Eskaleret ved P−15: revisor beslutter alternative handlinger', ANNULLERET: 'Forkert dato eller opgave annulleret' },
  RYKKET: { RYKKET: '2. rykker', SVAR_MODTAGET: 'Svar indgår', AFVIST: 'Afvist af instituttet', UDEN_SVAR: 'Revisor beslutter alternative handlinger', ANNULLERET: 'Forkert dato eller opgave annulleret' },
  AFVIST: { KLAR: 'Rettet', SENDT: 'Rettet og genfremsendt', ANNULLERET: 'Annulleret' },
  SVAR_MODTAGET: { AFVENTER_REVISOR: 'Afvigelser sendt til revisor', AFSLUTTET: 'Afstemt uden åbne afvigelser', AFVIST: 'Forkert opgørelsesdato (AR-03)' },
  AFVENTER_REVISOR: { AFSLUTTET: 'Revisor har behandlet afvigelserne' },
  UDEN_SVAR: { AFSLUTTET: 'Alternative handlinger dokumenteret', SVAR_MODTAGET: 'Svar indgår alligevel' },
  AFSLUTTET: {},
  ANNULLERET: {},
};

export function canTransitionInquiry(from: InquiryStatus, to: InquiryStatus): { ok: true } | { ok: false; reason: string } {
  if (INQUIRY_TRANSITIONS[from][to]) return { ok: true };
  const allowed = Object.keys(INQUIRY_TRANSITIONS[from]) as InquiryStatus[];
  return {
    ok: false,
    reason: `Ugyldig overgang fra "${INQUIRY_STATUS_LABELS[from]}" til "${INQUIRY_STATUS_LABELS[to]}". Tilladt: ${allowed.length ? allowed.map((s) => INQUIRY_STATUS_LABELS[s]).join(', ') : 'ingen (endelig status)'}.`,
  };
}

export const OPEN_INQUIRY: InquiryStatus[] = ['KLADDE', 'KLAR', 'SENDT', 'RYKKET', 'AFVIST'];
export const SENT_INQUIRY: InquiryStatus[] = ['SENDT', 'RYKKET', 'SVAR_MODTAGET', 'AFVENTER_REVISOR', 'UDEN_SVAR', 'AFSLUTTET'];
export const ANSWERED_INQUIRY: InquiryStatus[] = ['SVAR_MODTAGET', 'AFVENTER_REVISOR', 'AFSLUTTET'];
/** Afsluttet eller afklaret (US-R-10, S03: "Konkludér" er aktiv, når alle er her). */
export const RESOLVED_INQUIRY: InquiryStatus[] = ['AFSLUTTET', 'ANNULLERET'];

export const CASE_STATUSES = [
  'PLANLAGT', 'FORBEREDES', 'AFSENDT', 'SVAR_DELVIST', 'AFVENTER_REVISOR', 'KLAR_TIL_KONKLUSION', 'KONKLUDERET', 'LAAST',
] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const CASE_STATUS_LABELS: Record<CaseStatus, string> = {
  PLANLAGT: 'Planlagt',
  FORBEREDES: 'Forberedes',
  AFSENDT: 'Afsendt',
  SVAR_DELVIST: 'Svar delvist modtaget',
  AFVENTER_REVISOR: 'Afventer revisor',
  KLAR_TIL_KONKLUSION: 'Klar til konklusion',
  KONKLUDERET: 'Konkluderet',
  LAAST: 'Låst',
};

/** Sagens status afledes af banklisten, forespørgslerne og åbne afvigelser. */
export function deriveCaseStatus(input: {
  current: CaseStatus;
  bankListApproved: boolean;
  inquiries: InquiryStatus[];
  openDeviationsForAuditor: number;
}): CaseStatus {
  if (input.current === 'KONKLUDERET' || input.current === 'LAAST') return input.current;
  const active = input.inquiries.filter((s) => s !== 'ANNULLERET');
  if (!input.bankListApproved || active.length === 0) return input.bankListApproved ? 'FORBEREDES' : 'PLANLAGT';
  // En afvist forespørgsel har været sendt – sagen er stadig i afsendelsesfasen.
  const sent = active.filter((s) => SENT_INQUIRY.includes(s) || s === 'AFVIST').length;
  const answered = active.filter((s) => ANSWERED_INQUIRY.includes(s)).length;
  const waitingForAuditor = active.some((s) => s === 'AFVENTER_REVISOR' || s === 'UDEN_SVAR') || input.openDeviationsForAuditor > 0;
  if (active.every((s) => s === 'AFSLUTTET')) return 'KLAR_TIL_KONKLUSION';
  if (waitingForAuditor) return 'AFVENTER_REVISOR';
  if (answered > 0) return 'SVAR_DELVIST';
  if (sent > 0) return 'AFSENDT';
  return 'FORBEREDES';
}

export const AUTH_STATUSES = ['UDKAST', 'SENDT_TIL_SIGNERING', 'UNDERSKREVET', 'GYLDIG', 'BOER_FORNYES', 'SKAL_FORNYES', 'UGYLDIG', 'TILBAGEKALDT', 'INAKTIV'] as const;
export type AuthStatus = (typeof AUTH_STATUSES)[number];
export const AUTH_STATUS_LABELS: Record<AuthStatus, string> = {
  UDKAST: 'Udkast',
  SENDT_TIL_SIGNERING: 'Sendt til signering',
  UNDERSKREVET: 'Underskrevet – verificeres',
  GYLDIG: 'Gyldig',
  BOER_FORNYES: 'Bør fornyes',
  SKAL_FORNYES: 'Skal fornyes',
  UGYLDIG: 'Ugyldig',
  TILBAGEKALDT: 'Tilbagekaldt',
  INAKTIV: 'Inaktiv',
};

/** Resultatet af fuldmagtskontrollen pr. kunde (P04). */
export type AuthCheck = 'GYLDIG' | 'BOER_FORNYES' | 'SKAL_FORNYES' | 'MANGLER';
export const AUTH_CHECK_LABELS: Record<AuthCheck, string> = {
  GYLDIG: 'Gyldig',
  BOER_FORNYES: 'Bør fornyes',
  SKAL_FORNYES: 'Skal fornyes',
  MANGLER: 'Mangler',
};

export const SEVERITIES = ['KRITISK', 'VAESENTLIG', 'FORKLARET', 'UVAESENTLIG'] as const;
export type Severity = (typeof SEVERITIES)[number];
export const SEVERITY_LABELS: Record<Severity, string> = { KRITISK: 'Kritisk', VAESENTLIG: 'Væsentlig', FORKLARET: 'Forklaret', UVAESENTLIG: 'Uvæsentlig' };

export const DEVIATION_TYPES = ['SALDODIFFERENCE', 'KUN_I_SVAR', 'KUN_I_BOGFOERING', 'TEGNINGSRET', 'SIKKERHED', 'MANGLENDE_SVAR', 'NAEGTET_FULDMAGT'] as const;
export type DeviationType = (typeof DEVIATION_TYPES)[number];
export const DEVIATION_TYPE_LABELS: Record<DeviationType, string> = {
  SALDODIFFERENCE: 'Saldodifference',
  KUN_I_SVAR: 'Kun i svaret',
  KUN_I_BOGFOERING: 'Kun i bogføringen',
  TEGNINGSRET: 'Afvigende tegningsret',
  SIKKERHED: 'Sikkerhed/garanti',
  MANGLENDE_SVAR: 'Manglende svar',
  NAEGTET_FULDMAGT: 'Nægtet fuldmagt',
};
export const DEVIATION_DECISIONS = ['FORKLARET', 'FEJL_I_REGNSKABET', 'YDERLIGERE_HANDLING'] as const;
export const DEVIATION_DECISION_LABELS: Record<(typeof DEVIATION_DECISIONS)[number], string> = {
  FORKLARET: 'Forklaret',
  FEJL_I_REGNSKABET: 'Fejl i regnskabet',
  YDERLIGERE_HANDLING: 'Yderligere handling',
};

export const REJECTION_REASONS = ['FULDMAGT', 'FORKERT_CVR', 'FORKERT_DATO', 'UKENDT_KUNDE', 'ANDET'] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];
export const REJECTION_REASON_LABELS: Record<RejectionReason, string> = {
  FULDMAGT: 'Fuldmagt mangler eller er ugyldig',
  FORKERT_CVR: 'Forkert CVR',
  FORKERT_DATO: 'Forkert dato',
  UKENDT_KUNDE: 'Ukendt kunde',
  ANDET: 'Andet',
};

export const CHANNELS = ['EMAIL', 'WEBFORM', 'BULKFIL', 'PLATFORM', 'MANUEL'] as const;
export type Channel = (typeof CHANNELS)[number];
export const CHANNEL_LABELS: Record<Channel, string> = {
  EMAIL: 'E-mail',
  WEBFORM: 'Webformular',
  BULKFIL: 'Bulkfil (dannes automatisk)',
  PLATFORM: 'Digital platform',
  MANUEL: 'Manuel',
};

export const BANKLIST_SOURCES = ['SIDSTE_AAR', 'SAFT', 'KUNDE', 'MANUEL', 'AGENT'] as const;
export type BankListSource = (typeof BANKLIST_SOURCES)[number];
export const SOURCE_LABELS: Record<BankListSource, string> = { SIDSTE_AAR: 'Sidste år', SAFT: 'SAF-T', KUNDE: 'Kunde', MANUEL: 'Manuel', AGENT: 'Agent' };

export const LINE_CATEGORIES = ['INDLAAN', 'UDLAAN', 'KREDIT', 'DEPOT', 'GARANTI', 'SIKKERHED_STILLET', 'SIKKERHED_MODTAGET', 'DERIVAT', 'TEGNINGSRET', 'ANDET'] as const;
export type LineCategory = (typeof LINE_CATEGORIES)[number];
export const CATEGORY_LABELS: Record<LineCategory, string> = {
  INDLAAN: 'Indlån', UDLAAN: 'Lån', KREDIT: 'Kassekredit', DEPOT: 'Depot', GARANTI: 'Garanti',
  SIKKERHED_STILLET: 'Sikkerhed stillet', SIKKERHED_MODTAGET: 'Sikkerhed modtaget', DERIVAT: 'Derivat', TEGNINGSRET: 'Tegningsret', ANDET: 'Andet',
};

export const ENGAGEMENT_TYPE_LABELS: Record<string, string> = {
  REVISION: 'Revision',
  UDVIDET_GENNEMGANG: 'Udvidet gennemgang',
  REVIEW: 'Review',
  OPSTILLING: 'Opstilling',
};

export const TASK_STATUS_LABELS: Record<string, string> = { AABEN: 'Åben', I_GANG: 'I gang', VENTER: 'Venter', LUKKET: 'Lukket', ANNULLERET: 'Annulleret' };
