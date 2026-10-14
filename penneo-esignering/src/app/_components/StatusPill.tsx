import type { SigningRequestView } from '@/services/signing-service';

/** Status som revisor ser den i Opgaver, inkl. fremdrift og arkiveringsfejl. */
export function StatusPill({ request }: { request: SigningRequestView }) {
  const { status, progress, archiveFailed } = request;
  if (status === 'AWAITING_SIGNATURES') {
    return <span className="tag waiting">Afventer underskrift · {progress.signed}/{progress.total}</span>;
  }
  if (status === 'SIGNED') {
    return archiveFailed ? <span className="tag failed">Arkivering fejlede</span> : <span className="tag neutral">Underskrevet – arkiveres</span>;
  }
  if (status === 'REJECTED') return <span className="tag failed">Afvist</span>;
  return <span className="tag ok">Fuldført</span>;
}
