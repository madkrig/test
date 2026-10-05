import type { SigningRequestView } from '@/services/signing-service';

/** Status som revisor ser den i Opgaver, inkl. fremdrift og arkiveringsfejl. */
export function StatusPill({ request }: { request: SigningRequestView }) {
  const { status, progress, archiveFailed } = request;
  if (status === 'AWAITING_SIGNATURES') {
    return <span className="pill amber">Afventer underskrift · {progress.signed}/{progress.total}</span>;
  }
  if (status === 'SIGNED') {
    return archiveFailed ? <span className="pill red">Arkivering fejlede</span> : <span className="pill blue">Underskrevet – arkiveres</span>;
  }
  if (status === 'REJECTED') return <span className="pill red">Afvist</span>;
  return <span className="pill green">Fuldført</span>;
}
