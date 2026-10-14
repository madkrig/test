'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Fragment, Suspense, useCallback, useEffect, useState } from 'react';
import type { SigningRequestView } from '@/services/signing-service';
import { StatusPill } from '../_components/StatusPill';
import { api, errorBody, formatDateTime, type ApiErrorBody } from '../_lib/api';

type Scope = 'active' | 'completed' | 'all';
interface Event { id: string; action: string; actorId: string; actorName: string; at: string; change: string | null; reason: string | null }
interface Detail { data: SigningRequestView; events: Event[] }

const SCOPES: { id: Scope; label: string }[] = [
  { id: 'active', label: 'Aktive' },
  { id: 'completed', label: 'Fuldførte' },
  { id: 'all', label: 'Alle' },
];

const EVENT_LABELS: Record<string, string> = {
  SENT_TO_PENNEO: 'Sendt til Penneo',
  SIGNER_SIGNED: 'Underskrift modtaget',
  STATUS_CHANGED: 'Status ændret',
  ARCHIVED: 'Arkiveret',
  ARCHIVE_FAILED: 'Arkivering fejlede',
};

const needsAction = (r: SigningRequestView) => r.status === 'REJECTED' || r.archiveFailed;

function Stat({ label, value }: { label: string; value: string | number }) {
  return <div className="stat"><span>{label}</span><strong>{value}</strong></div>;
}

function RequestDetail({ id, demo, onChanged }: { id: string; demo: boolean; onChanged: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiErrorBody | null>(null);

  const load = useCallback(() => api<Detail>(`/api/signing-requests/${id}`).then(setDetail).catch((e) => setError(errorBody(e))), [id]);
  useEffect(() => {
    load();
    const timer = setInterval(load, 4000);
    return () => clearInterval(timer);
  }, [load]);

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await load();
      onChanged();
    } catch (e) {
      setError(errorBody(e));
    } finally {
      setBusy(null);
    }
  }

  if (!detail) return <p className="progress" role="status">Henter …</p>;
  const r = detail.data;
  return (
    <div className="detail-grid">
      <div>
        <h3>Underskrivere</h3>
        <ul className="signer-list">
          {r.signers.map((s) => (
            <li key={s.id}>
              <span className="who">{s.name}<small>{s.roleLabel} · {s.email}</small></span>
              {s.status === 'SIGNED' ? (
                <span className="tag ok">Underskrevet {formatDateTime(s.signedAt)}</span>
              ) : s.status === 'PENDING' && r.status === 'AWAITING_SIGNATURES' && demo ? (
                <button
                  className="secondary small"
                  disabled={busy !== null}
                  onClick={() => run(s.id, () => api('/api/demo/penneo/sign', { method: 'POST', body: { requestId: r.id, signerId: s.id } }))}
                  title="Demo: spiller Penneos rolle og sender de webhooks, Penneo ville sende"
                >
                  {busy === s.id ? 'Underskriver …' : 'Simulér underskrift (demo)'}
                </button>
              ) : (
                <span className="tag waiting">{s.statusLabel}</span>
              )}
            </li>
          ))}
        </ul>
        {r.archiveFailed && (
          <div className="error">
            <strong>Dokumentet er underskrevet, men ikke arkiveret i SharePoint.</strong>
            <div style={{ marginTop: 10 }}>
              <button className="small" disabled={busy !== null} onClick={() => run('archive', () => api(`/api/signing-requests/${r.id}/archive`, { method: 'POST' }))}>
                {busy === 'archive' ? 'Arkiverer …' : 'Prøv arkivering igen'}
              </button>
            </div>
          </div>
        )}
        {r.sharePoint && (
          <p className="help">Arkiveret i SharePoint: <a href={r.sharePoint.url} target="_blank" rel="noreferrer">{r.fileName.replace(/\.pdf$/i, '')}_underskrevet.pdf</a></p>
        )}
        <details>
          <summary>Identifikation</summary>
          <dl>
            <dt>Penneo-sag</dt><dd>#{r.penneo.caseFileId}{r.penneo.statusLabel && ` · ${r.penneo.statusLabel}`}</dd>
            <dt>Fil</dt><dd>{r.fileName}</dd>
            {r.sharePoint && <><dt>SharePoint-dokument</dt><dd>{r.sharePoint.documentId}</dd><dt>Integritetshash</dt><dd>{r.sharePoint.integrityHash}</dd></>}
            <dt>Opgave</dt><dd>{r.id}</dd>
          </dl>
        </details>
        {error && <div className="error" role="alert"><strong>{error.message}</strong>{error.recovery && <div>{error.recovery}</div>}</div>}
      </div>
      <div>
        <h3>Hændelseslog</h3>
        <ol className="timeline">
          {detail.events.map((e) => (
            <li key={e.id}>
              <b>{EVENT_LABELS[e.action] ?? e.action}</b>{e.change && ` – ${e.change}`}
              {e.reason && <div>{e.reason}</div>}
              <small style={{ display: 'block' }}>{formatDateTime(e.at)} · {e.actorId === 'system' ? 'System (Penneo-webhook)' : e.actorName}</small>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function Opgaver() {
  const highlight = useSearchParams().get('id');
  const [scope, setScope] = useState<Scope>(highlight ? 'all' : 'active');
  const [rows, setRows] = useState<SigningRequestView[] | null>(null);
  const [demo, setDemo] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(highlight);
  const [error, setError] = useState<ApiErrorBody | null>(null);

  // Henter alle forløb én gang, så nøgletal og filtre bygger på samme data.
  const load = useCallback(async () => {
    try {
      const res = await api<{ data: SigningRequestView[]; demo: boolean }>('/api/signing-requests?scope=all');
      setRows(res.data);
      setDemo(res.demo);
      setError(null);
    } catch (e) {
      setError(errorBody(e));
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 4000);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => { if (highlight) { setExpanded(highlight); setScope('all'); } }, [highlight]);

  const all = rows ?? [];
  const active = all.filter((r) => r.status !== 'COMPLETED');
  const completed = all.length - active.length;
  const visible = scope === 'active' ? active : scope === 'completed' ? all.filter((r) => r.status === 'COMPLETED') : all;

  return (
    <>
      <div className="topline"><span>Opgaver</span><span>{active.length} aktive · {completed} fuldførte</span></div>
      <section className="card">
        <div className="section-head">
          <div>
            <h2>Dine e-signeringsforløb</h2>
            <p>Status opdateres automatisk, når Penneo melder tilbage. Underskrevne dokumenter arkiveres i SharePoint.</p>
          </div>
          <div className="filters" role="tablist" aria-label="Filter">
            {SCOPES.map((s) => (
              <button key={s.id} role="tab" aria-selected={scope === s.id} className={scope === s.id ? 'active' : ''} onClick={() => setScope(s.id)}>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="stats four">
          <Stat label="Aktive forløb" value={active.length} />
          <Stat label="Afventer underskrift" value={all.filter((r) => r.status === 'AWAITING_SIGNATURES').length} />
          <Stat label="Kræver din handling" value={all.filter(needsAction).length} />
          <Stat label="Fuldført og arkiveret" value={completed} />
        </div>

        {error && <div className="error" role="alert">{error.message}</div>}
        <div className="table-wrap">
          <table className="stack">
            <thead>
              <tr>
                <th>Kunde</th>
                <th>Opgave</th>
                <th>Status</th>
                <th>Afventer</th>
                <th>Opdateret</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <Fragment key={r.id}>
                  <tr
                    className={`row ${expanded === r.id ? 'open' : ''} ${r.id === highlight ? 'highlight' : ''}`}
                    onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                    aria-expanded={expanded === r.id}
                  >
                    <td><strong>{r.client.name}</strong><br /><small>CVR {r.client.cvr}</small></td>
                    <td><strong>{r.serviceLabel}</strong><br /><small>{r.documentTitle}</small></td>
                    <td>
                      <StatusPill request={r} />
                      {r.status === 'AWAITING_SIGNATURES' && (
                        <div className="bar"><div style={{ width: `${(100 * r.progress.signed) / Math.max(r.progress.total, 1)}%` }} /></div>
                      )}
                    </td>
                    <td data-label="Afventer">{r.status === 'COMPLETED' ? '–' : r.nextOwner}</td>
                    <td data-label="Opdateret">{formatDateTime(r.updatedAt)}</td>
                  </tr>
                  {expanded === r.id && (
                    <tr className="detail">
                      <td colSpan={5} className="detail-cell"><RequestDetail id={r.id} demo={demo} onChanged={load} /></td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
          {rows && visible.length === 0 && (
            <div className="empty">
              Ingen forløb her. <Link href="/markedsplads">Start et e-signeringsforløb fra Markedspladsen</Link>.
            </div>
          )}
          {!rows && !error && <div className="empty">Henter opgaver …</div>}
        </div>
      </section>
    </>
  );
}

export default function OpgaverPage() {
  return (
    <Suspense fallback={<p className="progress">Henter …</p>}>
      <Opgaver />
    </Suspense>
  );
}
