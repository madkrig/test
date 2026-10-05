export type ErrorCode = 'VALIDATION' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'INVALID_STATE' | 'INTEGRATION';

const HTTP_STATUS: Record<ErrorCode, number> = {
  VALIDATION: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INVALID_STATE: 409,
  INTEGRATION: 502,
};

/**
 * Forventede forretningsfejl. Hver fejl bærer årsag, ejer og konkret recovery
 * action, så UI'et kan vise dem uden at gætte (brief afsnit 17).
 */
export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details: { reasons?: string[]; owner?: string; recovery?: string; existingId?: string } = {},
  ) {
    super(message);
    this.name = 'DomainError';
  }

  get httpStatus(): number {
    return HTTP_STATUS[this.code];
  }
}

export function assertOrThrow(reasons: string[], message: string, details: DomainError['details'] = {}): void {
  if (reasons.length > 0) throw new DomainError('INVALID_STATE', message, { ...details, reasons });
}
