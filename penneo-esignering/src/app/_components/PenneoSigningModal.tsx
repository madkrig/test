'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { SigningRequestView } from '@/services/signing-service';
import { api, errorBody, type ApiErrorBody } from '../_lib/api';

interface Service { type: string; label: string; description: string; signerRoleLabels: string[] }
interface Client { id: string; name: string; cvr: string }
interface Signer { id: string; name: string; email: string | null; roleLabel: string }
interface SignersData { signers: Signer[]; blockers: string[]; documentTitle: string; message: string }

const STEPS = ['Ydelse og kunde', 'Dokument og besked', 'Kvittering'] as const;

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function ErrorBox({ error }: { error: ApiErrorBody }) {
  return (
    <div className="error" role="alert">
      <strong>{error.message}</strong>
      {error.reasons && <ul>{error.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
      {error.recovery && <div>{error.recovery}</div>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return <div className="stat"><span>{label}</span><strong>{value}</strong></div>;
}

/**
 * Markedspladsens guide i tre trin: 1) ydelse og kunde → underskrivere fra
 * stamdata, 2) dokument og besked → send til Penneo, 3) kvittering.
 */
export function PenneoSigningModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [services, setServices] = useState<Service[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [serviceType, setServiceType] = useState('ANNUAL_REPORT');
  const [clientId, setClientId] = useState('');
  const [signersData, setSignersData] = useState<SignersData | null>(null);
  const [loadingSigners, setLoadingSigners] = useState(false);
  const [documentTitle, setDocumentTitle] = useState('');
  const [message, setMessage] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiErrorBody | null>(null);
  const [created, setCreated] = useState<SigningRequestView | null>(null);
  // Én nøgle pr. dialog: dobbeltklik eller genforsøg opretter ikke to Penneo-sager.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    api<{ data: Service[] }>('/api/signing-services').then((r) => setServices(r.data)).catch((e) => setError(errorBody(e)));
    api<{ data: Client[] }>('/api/clients').then((r) => setClients(r.data)).catch((e) => setError(errorBody(e)));
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    setSignersData(null);
    setError(null);
    if (!clientId || !serviceType) return;
    let cancelled = false;
    setLoadingSigners(true);
    api<{ data: SignersData }>(`/api/clients/${clientId}/signers?service=${serviceType}`)
      .then((r) => {
        if (cancelled) return;
        setSignersData(r.data);
        setDocumentTitle(r.data.documentTitle);
        setMessage(r.data.message);
      })
      .catch((e) => !cancelled && setError(errorBody(e)))
      .finally(() => !cancelled && setLoadingSigners(false));
    return () => { cancelled = true; };
  }, [clientId, serviceType]);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const document = file ? { fileName: file.name, contentBase64: await readAsBase64(file) } : undefined;
      const res = await api<{ data: SigningRequestView }>('/api/signing-requests', {
        method: 'POST',
        idempotencyKey,
        body: { clientId, serviceType, documentTitle, message, ...(document ? { document } : {}) },
      });
      setCreated(res.data);
      setStep(3);
    } catch (e) {
      setError(errorBody(e));
    } finally {
      setSubmitting(false);
    }
  }

  const service = services.find((s) => s.type === serviceType);
  const client = clients.find((c) => c.id === clientId);
  const signers = signersData?.signers ?? [];
  const canContinue = !!signersData && signersData.blockers.length === 0 && signers.length > 0;

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="penneo-title">
        <div className="dialog-side">
          <p className="eyebrow">Markedsplads</p>
          <h2 id="penneo-title">E-signering via Penneo</h2>
          <nav className="steps" aria-label="Trin">
            {STEPS.map((name, i) => (
              <button
                key={name}
                type="button"
                className={step === i + 1 ? 'active' : i + 1 < step ? 'done' : ''}
                disabled={submitting || !!created || i + 1 > step}
                onClick={() => setStep((i + 1) as 1 | 2 | 3)}
                aria-label={`Trin ${i + 1}: ${name}`}
              >
                <b>{i + 1 < step ? '✓' : i + 1}</b>{name}
              </button>
            ))}
          </nav>
        </div>

        <div className="dialog-main">
          <div className="dialog-body">
            <div className="topline">
              <span>Trin {step} af {STEPS.length}</span>
              <button className="secondary close" onClick={onClose} aria-label="Luk">×</button>
            </div>

            {step === 1 && (
              <>
                <h2>Vælg ydelse og kunde</h2>
                <p>Underskriverne hentes fra kundens stamdata. Mangler der noget, rettes det i stamdata – ikke her.</p>
                <div className="grid">
                  <label className="field">
                    <span>Ydelse</span>
                    <select value={serviceType} onChange={(e) => setServiceType(e.target.value)}>
                      {services.map((s) => <option key={s.type} value={s.type}>{s.label}</option>)}
                    </select>
                    {service && <small>{service.description}</small>}
                  </label>
                  <label className="field">
                    <span>Kunde</span>
                    <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
                      <option value="">Vælg …</option>
                      {clients.map((c) => <option key={c.id} value={c.id}>{c.name} · CVR {c.cvr}</option>)}
                    </select>
                    <small>Kun kunder, hvor du er ansvarlig revisor.</small>
                  </label>
                </div>

                {loadingSigners && <p className="progress" role="status">Henter underskrivere fra stamdata …</p>}
                {signersData && (
                  <>
                    <h3>Underskrivere fra stamdata</h3>
                    {signers.length > 0 && (
                      <div className="table-wrap">
                        <table className="stack">
                          <thead><tr><th>Navn</th><th>Rolle</th><th>E-mail</th></tr></thead>
                          <tbody>
                            {signers.map((s) => (
                              <tr key={s.id}>
                                <td><strong>{s.name}</strong></td>
                                <td data-label="Rolle">{s.roleLabel}</td>
                                <td data-label="E-mail">{s.email ?? <span className="missing">Mangler e-mail</span>}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {signersData.blockers.length > 0 ? (
                      <div className="notice">
                        <strong>Forløbet kan ikke startes endnu.</strong>
                        <ul>{signersData.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
                      </div>
                    ) : (
                      <p className="help">Fratrådte personer og roller, som ydelsen ikke kræver, er udeladt.</p>
                    )}
                  </>
                )}
              </>
            )}

            {step === 2 && signersData && (
              <>
                <h2>Dokument og besked</h2>
                <p>Upload dokumentet som PDF, og tilpas beskeden. Penneo sender e-mailen til underskriverne.</p>
                <div className="grid">
                  <label className="field wide">
                    <span>Dokumenttitel</span>
                    <input type="text" value={documentTitle} onChange={(e) => setDocumentTitle(e.target.value)} />
                  </label>
                </div>
                <label className="drop">
                  <strong>{file ? file.name : `Vælg ${service?.label.toLowerCase() ?? 'dokumentet'} som PDF`}</strong>
                  <span>{file ? `${Math.ceil(file.size / 1024)} KB` : 'PDF, højst 10 MB · uden fil bruges et genereret demodokument'}</span>
                  <input aria-label="Dokument (PDF)" type="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                </label>
                <div className="grid">
                  <label className="field wide">
                    <span>Besked til underskriverne</span>
                    <textarea value={message} onChange={(e) => setMessage(e.target.value)} />
                  </label>
                </div>
                <h3>Opsummering</h3>
                <dl>
                  <dt>Kunde</dt><dd>{client?.name} · CVR {client?.cvr}</dd>
                  <dt>Ydelse</dt><dd>{service?.label}</dd>
                  <dt>Underskrivere</dt><dd>{signers.map((s) => `${s.name} (${s.roleLabel})`).join(', ')}</dd>
                  <dt>Efter underskrift</dt><dd>Dokumentet arkiveres i SharePoint, og du får besked.</dd>
                </dl>
              </>
            )}

            {step === 3 && created && (
              <>
                <span className="result-tag">Sendt til Penneo</span>
                <h2>Underskriftsforløbet er startet</h2>
                <p>Følg status under Opgaver. Du får besked, når alle har underskrevet, og dokumentet er arkiveret.</p>
                <div className="stats">
                  <Stat label="Penneo-sag" value={`#${created.penneo.caseFileId}`} />
                  <Stat label="Underskrivere" value={created.progress.total} />
                </div>
                <dl>
                  <dt>Dokument</dt><dd>{created.documentTitle}</dd>
                  <dt>Status</dt><dd>{created.nextAction}</dd>
                  <dt>Afventer</dt><dd>{created.nextOwner}</dd>
                </dl>
              </>
            )}

            {error && <ErrorBox error={error} />}
            {submitting && <p role="status" className="progress">Sender til Penneo …</p>}
          </div>

          <div className="actions">
            {step === 1 && (
              <>
                <button className="secondary" onClick={onClose}>Annullér</button>
                <button disabled={!canContinue} onClick={() => setStep(2)}>Fortsæt til dokument</button>
              </>
            )}
            {step === 2 && (
              <>
                <button className="secondary" onClick={() => setStep(1)} disabled={submitting}>Tilbage</button>
                <button onClick={submit} disabled={submitting || !documentTitle.trim()}>
                  {submitting ? 'Sender …' : 'Send til underskrift'}
                </button>
              </>
            )}
            {step === 3 && created && (
              <>
                <button className="secondary" onClick={onClose}>Luk</button>
                <Link className="button" href={`/opgaver?id=${created.id}`} onClick={onClose}>Gå til Opgaver</Link>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
