'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { SigningRequestView } from '@/services/signing-service';
import { api, errorBody, type ApiErrorBody } from '../_lib/api';

interface Service { type: string; label: string; description: string; signerRoleLabels: string[] }
interface Client { id: string; name: string; cvr: string }
interface Signer { id: string; name: string; email: string | null; roleLabel: string }
interface SignersData { signers: Signer[]; blockers: string[]; documentTitle: string; message: string }

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
    <div className="alert error" role="alert">
      <strong>{error.message}</strong>
      {error.reasons && <ul>{error.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
      {error.recovery && <div className="small">{error.recovery}</div>}
    </div>
  );
}

/**
 * Markedspladsens dialog: 1) ydelse og kunde → underskrivere fra stamdata,
 * 2) dokument og besked → send til Penneo, 3) kvittering med link til Opgaver.
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
  const canContinue = !!signersData && signersData.blockers.length === 0 && signersData.signers.length > 0;

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="penneo-title">
        <div className="modal-head">
          <div>
            <h2 id="penneo-title">E-signering via Penneo</h2>
            <div className="steps">
              <span className={step === 1 ? 'on' : ''}>1 · Ydelse og kunde</span>
              <span className={step === 2 ? 'on' : ''}>2 · Dokument og afsendelse</span>
              <span className={step === 3 ? 'on' : ''}>3 · Kvittering</span>
            </div>
          </div>
          <button className="close" onClick={onClose} aria-label="Luk">×</button>
        </div>

        <div className="modal-body">
          {step === 1 && (
            <>
              <label className="field">
                <span>Ydelse</span>
                <select value={serviceType} onChange={(e) => setServiceType(e.target.value)}>
                  {services.map((s) => <option key={s.type} value={s.type}>{s.label}</option>)}
                </select>
                {service && <div className="muted small" style={{ marginTop: 4 }}>{service.description}</div>}
              </label>
              <label className="field">
                <span>Kunde</span>
                <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
                  <option value="">Vælg kunde …</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.name} · CVR {c.cvr}</option>)}
                </select>
              </label>

              {loadingSigners && <div className="muted">Henter underskrivere fra stamdata …</div>}
              {signersData && (
                <>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>Underskrivere fra kundens stamdata</div>
                  {signersData.signers.length > 0 && (
                    <div className="signers">
                      {signersData.signers.map((s) => (
                        <div className="signer" key={s.id}>
                          <div>{s.name}</div>
                          <div className="role">{s.roleLabel}</div>
                          <div className="muted small">{s.email ?? 'Mangler e-mail'}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {signersData.blockers.length > 0 && (
                    <div className="alert warn">
                      <strong>Forløbet kan ikke startes endnu</strong>
                      <ul>{signersData.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
                      <div className="small">Ret kundens underskrivere i stamdata, og prøv igen.</div>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {step === 2 && signersData && (
            <>
              <label className="field">
                <span>Dokumenttitel</span>
                <input type="text" value={documentTitle} onChange={(e) => setDocumentTitle(e.target.value)} />
              </label>
              <label className="field">
                <span>Dokument (PDF)</span>
                <input type="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                <div className="muted small" style={{ marginTop: 4 }}>
                  {file ? `${file.name} · ${Math.ceil(file.size / 1024)} KB` : 'Ingen fil valgt – i demoen bruges et genereret dokument.'}
                </div>
              </label>
              <label className="field">
                <span>Besked til underskriverne</span>
                <textarea value={message} onChange={(e) => setMessage(e.target.value)} />
              </label>
              <div className="alert info">
                {signersData.signers.length} underskriver(e) hos {client?.name} modtager en underskriftsanmodning fra Penneo:{' '}
                {signersData.signers.map((s) => s.name).join(', ')}. Når alle har underskrevet, arkiveres dokumentet
                automatisk i SharePoint, og du får besked.
              </div>
            </>
          )}

          {step === 3 && created && (
            <div className="success">
              <div className="check">✓</div>
              <h2>Underskriftsforløbet er startet i Penneo</h2>
              <dl className="kv">
                <dt>Dokument</dt><dd>{created.documentTitle}</dd>
                <dt>Penneo-sag</dt><dd>#{created.penneo.caseFileId}</dd>
                <dt>Status</dt><dd>{created.nextAction}</dd>
                <dt>Afventer</dt><dd>{created.nextOwner}</dd>
              </dl>
            </div>
          )}

          {error && <ErrorBox error={error} />}
        </div>

        <div className="modal-foot">
          {step === 1 && (
            <>
              <button className="btn secondary" onClick={onClose}>Annullér</button>
              <button className="btn" disabled={!canContinue} onClick={() => setStep(2)}>Næste</button>
            </>
          )}
          {step === 2 && (
            <>
              <button className="btn secondary" onClick={() => setStep(1)} disabled={submitting}>Tilbage</button>
              <button className="btn" onClick={submit} disabled={submitting || !documentTitle.trim()}>
                {submitting ? 'Sender …' : 'Send til underskrift'}
              </button>
            </>
          )}
          {step === 3 && created && (
            <>
              <button className="btn secondary" onClick={onClose}>Luk</button>
              <Link className="btn" href={`/opgaver?id=${created.id}`} onClick={onClose} style={{ textDecoration: 'none' }}>Gå til Opgaver</Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
