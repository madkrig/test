/**
 * Ydelser, der kan sendes til e-signering fra markedspladsen. Hver ydelse
 * bestemmer, hvilke roller fra kundens stamdata der skal underskrive.
 */
export const SIGNER_ROLES = ['DIRECTOR', 'CHAIR', 'BOARD_MEMBER'] as const;
export type SignerRole = (typeof SIGNER_ROLES)[number];

export const ROLE_LABELS: Record<SignerRole, string> = {
  DIRECTOR: 'Direktør',
  CHAIR: 'Bestyrelsesformand',
  BOARD_MEMBER: 'Bestyrelsesmedlem',
};

export const SERVICE_TYPES = ['ANNUAL_REPORT', 'MANAGEMENT_REPRESENTATION', 'AUDIT_PROTOCOL'] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];

export interface SigningService {
  type: ServiceType;
  label: string;
  description: string;
  signerRoles: SignerRole[];
}

export const SIGNING_SERVICES: SigningService[] = [
  {
    type: 'ANNUAL_REPORT',
    label: 'Årsrapport',
    description: 'Ledelsespåtegningen underskrives af direktion og bestyrelse.',
    signerRoles: ['DIRECTOR', 'CHAIR', 'BOARD_MEMBER'],
  },
  {
    type: 'MANAGEMENT_REPRESENTATION',
    label: 'Ledelseserklæring',
    description: 'Underskrives af direktionen.',
    signerRoles: ['DIRECTOR'],
  },
  {
    type: 'AUDIT_PROTOCOL',
    label: 'Revisionsprotokollat',
    description: 'Underskrives af den samlede bestyrelse.',
    signerRoles: ['CHAIR', 'BOARD_MEMBER'],
  },
];

export function findService(type: string): SigningService | undefined {
  return SIGNING_SERVICES.find((s) => s.type === type);
}

/** Regnskabsåret er som udgangspunkt året før underskrift (kan rettes i dialogen). */
export function defaultDocumentTitle(service: SigningService, clientName: string, today: string): string {
  return `${service.label} ${Number(today.slice(0, 4)) - 1} – ${clientName}`;
}

export function defaultMessage(service: SigningService, clientName: string): string {
  return `Kære underskriver\n\nVedhæftet er ${service.label.toLowerCase()} for ${clientName} til underskrift via Penneo.\n\nVenlig hilsen\nCedra`;
}
