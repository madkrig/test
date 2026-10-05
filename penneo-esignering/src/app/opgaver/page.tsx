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

  if (!detail) return <div className="muted">Henter …</div>;
  const r = detail.data;
  return (
    <div className="detail-grid">
      <div>
        <h3>Underskrivere</h3>
        <div className="signers">
          {r.signers.map((s) => (
            <div className="signer" key={s.id}>
              <div>{s.name} <span className="role">· {s.roleLabel}</span></div>
              <div>
                {s.status === 'SIGNED' ? (
                  <span className="pill green">Underskrevet {formatDateTime(s.signedAt)}</span>
                ) : s.status === 'PENDING' && r.status === 'AWAITING_SIGNATURES' && demo ? (
                  <button
                    className="btn demo small"
                    disabled={busy !== null}
                    onClick={() => run(s.id, () => api('/api/demo/penneo/sign', { method: 'POST', body: { requestId: r.id, signerId: s.id } }))}
                    title="Demo: spiller Penneos rolle og sender de webhooks, Penneo ville sende"
                  >
                    {busy === s.id ? 'Underskriver …' : 'Simulér underskrift (demo)'}
                  </button>
                ) : (
                  <span className="pill amber">{s.statusLabel}</span>
                )}
              </div>
              <div className="muted small">{s.email}</div>
            </div>
          ))}
        </div>
        {r.archiveFailed && (
          <div className="alert error">
            <strong>Dokumentet er underskrevet, men ikke arkiveret i SharePoint.</strong>
            <div style={{ marginTop: 8 }}>
              <button className="btn small" disabled={busy !== null} onClick={() => run('archive', () => api(`/api/signing-requests/${r.id}/archive`, { method: 'POST' }))}>
                {busy === 'archive' ? 'Arkiverer …' : 'Prøv arkivering igen'}
              </button>
            </div>
          </div>
        )}
        <div className="links small">
          <span>Penneo-sag <strong>#{r.penneo.caseFileId}</strong>{r.penneo.statusLabel && ` (${r.penneo.statusLabel})`}</span>
          <span>Fil: {r.fileName}</span>
          {r.sharePoint && <a href={r.sharePoint.url} target="_blank" rel="noreferrer">Åbn i SharePoint ({r.sharePoint.documentId})</a>}
        </div>
        {error && (
          <div className="alert error">
            <strong>{error.message}</strong>
            {error.recovery && <div className="small">{error.recovery}</div>}
          </div>
        )}
      </div>
      <div>
        <h3>Hændelseslog</h3>
        <ul className="timeline">
          {detail.events.map((e) => (
            <li key={e.id}>
              <div><strong>{EVENT_LABELS[e.action] ?? e.action}</strong>{e.change && ` – ${e.change}`}</div>
              {e.reason && <div className="small">{e.reason}</div>}
              <div className="muted small">{formatDateTime(e.at)} · {e.actorId === 'system' ? 'System (Penneo-webhook)' : e.actorName}</div>
            </li>
          ))}
        </ul>
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

  const load = useCallback(async () => {
    try {
      const res = await api<{ data: SigningRequestView[]; demo: boolean }>(`/api/signing-requests?scope=${scope}`);
      setRows(res.data);
      setDemo(res.demo);
      setError(null);
    } catch (e) {
      setError(errorBody(e));
    }
  }, [scope]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 4000);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => { if (highlight) { setExpanded(highlight); setScope('all'); } }, [highlight]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Opgaver</h1>
          <div className="muted">E-signeringsforløb på dine kunder. Status opdateres automatisk, når Penneo melder tilbage.</div>
        </div>
        <div className="tabs" role="tablist">
          {SCOPES.map((s) => (
            <button key={s.id} role="tab" aria-selected={scope === s.id} className={scope === s.id ? 'on' : ''} onClick={() => setScope(s.id)}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="alert error"><strong>{error.message}</strong></div>}
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Kunde</th>
              <th>Opgave</th>
              <th>Status</th>
              <th className="hide-sm">Afventer</th>
              <th className="hide-sm">Opdateret</th>
            </tr>
          </thead>
          <tbody>
            {rows?.map((r) => (
              <Fragment key={r.id}>
                <tr className={`row ${r.id === highlight ? 'highlight' : ''}`} onClick={() => setExpanded(expanded === r.id ? null : r.id)} aria-expanded={expanded === r.id}>
                  <td><strong>{r.client.name}</strong><div className="muted small">CVR {r.client.cvr}</div></td>
                  <td>E-signering · {r.serviceLabel}<div className="muted small">{r.documentTitle}</div></td>
                  <td>
                    <StatusPill request={r} />
                    {r.status === 'AWAITING_SIGNATURES' && (
                      <div className="bar"><div style={{ width: `${(100 * r.progress.signed) / Math.max(r.progress.total, 1)}%` }} /></div>
                    )}
                  </td>
                  <td className="hide-sm">{r.status === 'COMPLETED' ? <span className="muted">–</span> : r.nextOwner}</td>
                  <td className="hide-sm muted">{formatDateTime(r.updatedAt)}</td>
                </tr>
                {expanded === r.id && (
                  <tr className="detail">
                    <td colSpan={5}><RequestDetail id={r.id} demo={demo} onChanged={load} /></td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        {rows?.length === 0 && (
          <div className="empty">
            Ingen opgaver her. <Link href="/markedsplads">Start et e-signeringsforløb fra Markedspladsen</Link>.
          </div>
        )}
        {!rows && !error && <div className="empty">Henter opgaver …</div>}
      </div>
    </>
  );
}

export default function OpgaverPage() {
  return (
    <Suspense fallback={<div className="muted">Henter …</div>}>
      <Opgaver />
    </Suspense>
  );
}
