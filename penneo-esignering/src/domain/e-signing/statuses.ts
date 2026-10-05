/**
 * Statusmodel for et underskriftsforløb. Bevidst få statusser: Penneo ejer
 * selve underskriften; vi ejer igangsætning, arkivering og besked til revisor.
 * Flag (fx arkivering fejlet) holdes separat fra status.
 */
export const SIGNING_STATUSES = ['AWAITING_SIGNATURES', 'SIGNED', 'COMPLETED', 'REJECTED'] as const;
export type SigningStatus = (typeof SIGNING_STATUSES)[number];

export const STATUS_LABELS: Record<SigningStatus, string> = {
  AWAITING_SIGNATURES: 'Afventer underskrift',
  SIGNED: 'Underskrevet – arkiveres',
  COMPLETED: 'Fuldført',
  REJECTED: 'Afvist',
};

export const SIGNER_STATUSES = ['PENDING', 'SIGNED', 'REJECTED'] as const;
export type SignerStatus = (typeof SIGNER_STATUSES)[number];

export const SIGNER_STATUS_LABELS: Record<SignerStatus, string> = {
  PENDING: 'Afventer',
  SIGNED: 'Underskrevet',
  REJECTED: 'Afvist',
};

type TransitionMap<S extends string> = Record<S, Partial<Record<S, string>>>;

/** Værdien beskriver den forudsætning, der skal være opfyldt. */
export const SIGNING_TRANSITIONS: TransitionMap<SigningStatus> = {
  AWAITING_SIGNATURES: {
    SIGNED: 'Alle underskrivere har underskrevet (Penneo: completed)',
    REJECTED: 'En underskriver har afvist (Penneo: rejected)',
  },
  SIGNED: { COMPLETED: 'Det underskrevne dokument er arkiveret i SharePoint' },
  COMPLETED: {},
  REJECTED: {},
};

export type TransitionResult = { ok: true } | { ok: false; reason: string };

export function canTransition(from: SigningStatus, to: SigningStatus): TransitionResult {
  if (SIGNING_TRANSITIONS[from][to]) return { ok: true };
  const allowed = Object.keys(SIGNING_TRANSITIONS[from]) as SigningStatus[];
  const options = allowed.length ? allowed.map((s) => STATUS_LABELS[s]).join(', ') : 'ingen (endelig status)';
  return { ok: false, reason: `Ugyldig overgang fra "${STATUS_LABELS[from]}" til "${STATUS_LABELS[to]}". Tilladt: ${options}.` };
}
