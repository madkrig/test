import { ROLE_LABELS, SIGNER_ROLES, type SignerRole, type SigningService } from './catalog';
import type { SignerStatus, SigningStatus } from './statuses';

export interface SigningPerson {
  id: string;
  name: string;
  email: string | null;
  role: SignerRole;
  active: boolean;
}

/**
 * Underskrivere til en ydelse, præcis som de står i kundens stamdata:
 * aktive personer med en af ydelsens roller, sorteret efter rolle og navn.
 * Blokeringer skal løses i stamdata, før forløbet kan startes.
 */
export function signersFor(service: SigningService, persons: SigningPerson[]): { signers: SigningPerson[]; blockers: string[] } {
  const signers = persons
    .filter((p) => p.active && service.signerRoles.includes(p.role))
    .sort((a, b) => SIGNER_ROLES.indexOf(a.role) - SIGNER_ROLES.indexOf(b.role) || a.name.localeCompare(b.name, 'da'));
  const blockers: string[] = [];
  if (signers.length === 0) {
    const roles = service.signerRoles.map((r) => ROLE_LABELS[r].toLowerCase()).join(' eller ');
    blockers.push(`Kunden har ingen aktive underskrivere med rollen ${roles} i stamdata.`);
  }
  for (const s of signers) {
    if (!s.email?.trim()) blockers.push(`${s.name} (${ROLE_LABELS[s.role]}) mangler e-mail i stamdata.`);
  }
  return { signers, blockers };
}

export interface SignerProgress {
  name: string;
  status: SignerStatus;
}

export function progress(signers: SignerProgress[]): { signed: number; total: number } {
  return { signed: signers.filter((s) => s.status === 'SIGNED').length, total: signers.length };
}

/** Næste handling og hvem den afventer – vises direkte i Opgaver. */
export function nextStep(
  status: SigningStatus,
  signers: SignerProgress[],
  ctx: { archiveFailed: boolean; auditorName: string },
): { nextAction: string; nextOwner: string } {
  switch (status) {
    case 'AWAITING_SIGNATURES': {
      const { signed, total } = progress(signers);
      const pending = signers.filter((s) => s.status === 'PENDING').map((s) => s.name);
      return { nextAction: `Afventer underskrift (${signed}/${total})`, nextOwner: pending.join(', ') || 'Penneo' };
    }
    case 'SIGNED':
      return ctx.archiveFailed
        ? { nextAction: 'Arkivering i SharePoint fejlede – prøv igen', nextOwner: ctx.auditorName }
        : { nextAction: 'Arkiveres i SharePoint', nextOwner: 'System' };
    case 'REJECTED':
      return { nextAction: 'Afvist i Penneo – afklar med kunden og start et nyt forløb', nextOwner: ctx.auditorName };
    case 'COMPLETED':
      return { nextAction: '–', nextOwner: '–' };
  }
}
