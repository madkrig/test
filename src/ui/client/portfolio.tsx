'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ErrorBox, Modal, useAction } from './action';

export interface PortfolioRow {
  subtaskId: string;
  versionId: string;
  engagementId: string;
  customer: string;
  engagement: string;
  statusDate: string;
  banks: number;
  changes: string;
  openQuestions: number;
  deadline: string;
  ready: boolean;
  blockers: string[];
  version: number;
}

/** F11/F11b: massegodkendelse af egne, klare populationer – én approval event pr. engagement. */
export function PortfolioTable({ rows }: { rows: PortfolioRow[] }) {
  const [selected, setSelected] = useState<string[]>(rows.filter((r) => r.ready).map((r) => r.subtaskId));
  const [confirming, setConfirming] = useState(false);
  const { run, pending, error, result } = useAction();
  const chosen = rows.filter((r) => selected.includes(r.subtaskId));
  const blocked = rows.filter((r) => !r.ready);
  const n = chosen.length;

  return (
    <>
      <table className="table">
        <thead>
          <tr><th /><th>Kunde</th><th>Revision · statusdato</th><th>Banker</th><th>Ændringer</th><th>Åbne spørgsmål</th><th>Deadline</th><th>Klar</th></tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={8} className="muted">Ingen populationer afventer din godkendelse.</td></tr>}
          {rows.map((r) => (
            <tr key={r.subtaskId} className={r.ready ? undefined : 'row-muted'}>
              <td>
                <input type="checkbox" aria-label={`Vælg ${r.customer}`} disabled={!r.ready} checked={selected.includes(r.subtaskId)}
                  onChange={(e) => setSelected(e.target.checked ? [...selected, r.subtaskId] : selected.filter((x) => x !== r.subtaskId))} />
              </td>
              <td><Link className="strong" href={`/auditflow/${r.engagementId}`}>{r.customer}</Link></td>
              <td>{r.engagement} · {r.statusDate}</td>
              <td>{r.banks}</td>
              <td>{r.changes}</td>
              <td>{r.openQuestions}</td>
              <td>{r.deadline}</td>
              <td>{r.ready ? <span className="pill pill-sm tone-green">√ Klar</span> : <span className="pill pill-sm tone-red">■ Ikke klar</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row between">
        <span className="muted small">{n} valgt · der oprettes én approval event pr. engagement</span>
        <button className="btn btn-primary" disabled={n === 0} onClick={() => setConfirming(true)}>Godkend {n} {n === 1 ? 'population' : 'populationer'}</button>
      </div>
      {blocked.map((r) => <p key={r.subtaskId} className="muted small">{r.customer} kan ikke vælges: {r.blockers.join(' ')}</p>)}
      {result?.data && (
        <div className="callout tone-green">
          <strong>{result.data.approved} godkendt{result.data.failed ? ` · ${result.data.failed} fejlede` : ''}</strong>
          <ul>
            {result.data.results.map((x: { subtaskId: string; ok: boolean; createdBankTasks?: number; error?: string }) => (
              <li key={x.subtaskId}>{x.ok ? `√ ${x.createdBankTasks} BankTask(s) oprettet` : `■ ${x.error}`}</li>
            ))}
          </ul>
        </div>
      )}
      {confirming && (
        <Modal title={`Godkend ${n} ${n === 1 ? 'population' : 'populationer'}`} onClose={() => setConfirming(false)}>
          <ul className="bullets">
            {chosen.map((r) => <li key={r.subtaskId}>{r.customer} · version {r.version} · {r.banks} {r.banks === 1 ? 'bank' : 'banker'}</li>)}
          </ul>
          <p>Konsekvens: hver population låses, og der oprettes {chosen.reduce((a, r) => a + r.banks, 0)} BankTasks i alt. Der logges én godkendelse pr. engagement med den viste version.</p>
          <ErrorBox error={error} />
          <div className="row end">
            <button className="btn btn-secondary" onClick={() => setConfirming(false)}>Annullér</button>
            <button
              className="btn btn-primary"
              disabled={pending}
              onClick={async () => {
                const ok = await run('POST', '/api/reviewer/bulk-approve', { items: chosen.map((r) => ({ subtaskId: r.subtaskId, versionId: r.versionId })), confirmed: true });
                if (ok) { setConfirming(false); setSelected([]); }
              }}
            >Godkend</button>
          </div>
        </Modal>
      )}
    </>
  );
}
