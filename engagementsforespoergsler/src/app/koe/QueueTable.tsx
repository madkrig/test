'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import type { QueueRow } from '@/services/queries';
import { api, errorBody, type ApiErrorBody } from '../_lib/api';
import { fmtDate, tagClass } from '../_lib/format';

/** S01: tabellen med valg og bulk. En batch kræver samme institut og kanal. */
export function QueueTable({ rows, canAct }: { rows: QueueRow[]; canAct: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiErrorBody | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [until, setUntil] = useState('');
  const chosen = useMemo(() => rows.filter((r) => selected.includes(r.id)), [rows, selected]);
  const sameTarget = chosen.length > 0 && chosen.every((r) => r.instituteId === chosen[0]!.instituteId && r.channel === chosen[0]!.channel);
  const allSendable = chosen.length > 0 && chosen.every((r) => r.sendable);
  const remindable = chosen.filter((r) => r.nextAction.startsWith('Send 1. rykker') || r.nextAction.startsWith('Send 2. rykker'));

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  async function run(fn: () => Promise<string | null>) {
    setBusy(true);
    setError(null);
    setReceipt(null);
    try {
      setReceipt(await fn());
      setSelected([]);
      router.refresh();
    } catch (e) {
      setError(errorBody(e));
    } finally {
      setBusy(false);
    }
  }

  const sendBatch = () => run(async () => {
    const r = await api<{ sent: number; channel: string; summary: string }>('/api/afsendelser/batch', { method: 'POST', body: { inquiryIds: selected }, idempotencyKey: crypto.randomUUID() });
    return `${r.sent} forespørgsler sendt (${r.channel}). ${r.summary}.`;
  });
  const assign = () => run(async () => {
    const r = await api<{ changed: number }>('/api/koe/opgaver', { method: 'POST', body: { inquiryIds: selected, action: 'TILDEL' } });
    return `${r.changed} opgaver er tildelt dig.`;
  });
  const snooze = () => run(async () => {
    const r = await api<{ changed: number }>('/api/koe/opgaver', { method: 'POST', body: { inquiryIds: selected, action: 'UDSKYD', until } });
    return `${r.changed} opgaver er udskudt til ${fmtDate(until)}.`;
  });
  const remind = () => run(async () => {
    for (const r of remindable) await api(`/api/forespoergsler/${r.id}/rykker`, { method: 'POST' });
    return `${remindable.length} rykkere sendt.`;
  });

  return (
    <>
      {canAct && chosen.length > 0 && (
        <div className="batch-bar" role="region" aria-label="Valgte forespørgsler">
          <strong>{chosen.length} valgt</strong>
          <span>{sameTarget ? `Samme pengeinstitut: ${chosen[0]!.institute} · kanal: ${chosen[0]!.channelLabel}` : 'Forskellige institutter eller kanaler – en batch kræver samme institut og kanal'}</span>
          <span className="spacer" />
          <button disabled={busy || !sameTarget || !allSendable} title={!allSendable ? 'Kun forespørgsler, der er klar til afsendelse' : undefined} onClick={sendBatch}>Send batch ({chosen.length})</button>
          {remindable.length > 0 && <button className="secondary" disabled={busy} onClick={remind}>Send rykker ({remindable.length})</button>}
          <button className="secondary" disabled={busy} onClick={assign}>Tildel til mig</button>
          <span className="inline-actions">
            <input type="date" aria-label="Udskyd til" value={until} onChange={(e) => setUntil(e.target.value)} style={{ width: 150, padding: '9px 10px' }} />
            <button className="secondary" disabled={busy || !until} onClick={snooze}>Udskyd</button>
          </span>
          {error && (
            <div className="error" role="alert"><strong>{error.message}</strong>{error.reasons && <ul>{error.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}{error.recovery && <div>{error.recovery}</div>}</div>
          )}
        </div>
      )}
      {receipt && <div className="notice ok-notice" role="status"><strong>Udført.</strong> {receipt}</div>}
      {busy && <div className="progress" role="status">Arbejder …</div>}
      <div className="table-wrap">
        <table className="stack dense">
          <thead>
            <tr>
              {canAct && <th className="check"><span className="sr-only">Vælg</span></th>}
              <th>Kunde og reference</th><th>Balancedag</th><th>Pengeinstitut</th><th>Status</th><th>Næste handling</th><th>Frist</th><th>Revisor</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={selected.includes(r.id) ? 'selected' : ''}>
                {canAct && <td className="check"><input type="checkbox" aria-label={`Vælg ${r.reference}`} checked={selected.includes(r.id)} onChange={() => toggle(r.id)} /></td>}
                <td data-label="Kunde"><strong><Link href={`/sager/${r.caseId}?fane=forespoergsler`}>{r.customer}</Link></strong><span className="ref">{r.reference}</span></td>
                <td data-label="Balancedag">{fmtDate(r.balanceDate)}</td>
                <td data-label="Pengeinstitut">{r.institute}<br /><small>{r.channelLabel}</small></td>
                <td data-label="Status"><span className={tagClass(r.tone)}>{r.statusLabel}</span></td>
                <td data-label="Næste handling">{r.responseId && (r.bucket === 'VERIFIKATION') ? <Link href={`/svar/${r.responseId}`}>{r.nextAction}</Link> : r.nextAction}</td>
                <td data-label="Frist"><span className={`deadline ${r.deadlineTone ?? ''}`}>{fmtDate(r.deadline)}</span></td>
                <td data-label="Revisor">{r.auditor}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
