'use client';

import Link from 'next/link';
import { useState } from 'react';
import { primaryFlag, statusBadge, taskRef, dayMonth, type FlagSource } from '../labels';
import { ErrorBox, useAction } from './action';

export interface QueueRow extends FlagSource {
  id: string;
  customerName: string;
  engagementLabel: string;
  bankName: string;
  nextAction: string;
  owner: string;
  deadline: string | null;
  method: string | null;
}

function Badge({ b }: { b: ReturnType<typeof primaryFlag> }) {
  if (!b) return <span className="muted">–</span>;
  return <span className={`pill pill-sm tone-${b.tone}`}><span aria-hidden>{b.icon}</span> {b.label}</span>;
}

/** F04: prioriteret arbejdskø med bulk-tildeling. */
export function QueueTable({ rows, owners }: { rows: QueueRow[]; owners: { id: string; name: string }[] }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [owner, setOwner] = useState(owners[0]?.id ?? '');
  const { run, pending, error } = useAction();
  return (
    <>
      <table className="table">
        <thead>
          <tr>
            <th>
              <input type="checkbox" aria-label="Vælg alle" checked={selected.length > 0 && selected.length === rows.length}
                onChange={(e) => setSelected(e.target.checked ? rows.map((r) => r.id) : [])} />
            </th>
            <th>Kunde · engagement</th><th>Bank</th><th>Status</th><th>Flag</th><th>Næste handling</th><th>Ejer</th><th>Deadline</th><th>Metode</th><th>Autorisation</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={10} className="muted">Ingen opgaver i denne visning.</td></tr>}
          {rows.map((r) => {
            const s = statusBadge(r.status);
            return (
              <tr key={r.id}>
                <td><input type="checkbox" aria-label={`Vælg ${taskRef(r.id)}`} checked={selected.includes(r.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, r.id] : selected.filter((x) => x !== r.id))} /></td>
                <td>{r.customerName} · {r.engagementLabel}</td>
                <td><Link className="strong" href={`/kerne/bank-tasks/${r.id}`}>{r.bankName}</Link> <span className="muted small">{taskRef(r.id)}</span></td>
                <td><span className={`pill pill-sm tone-${s.tone}`}><span aria-hidden>{s.icon}</span> {s.label}</span></td>
                <td><Badge b={primaryFlag(r)} /></td>
                <td>{r.nextAction}</td>
                <td>{r.owner}</td>
                <td>{dayMonth(r.deadline)}</td>
                <td className="muted">{r.method ?? '–'}</td>
                <td>{r.status === 'COMPLETED' ? '–' : r.flags.missingAuthorization && !r.sentAt ? <span className="no">■</span> : <span className="ok">√</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="row">
        <span className="muted small">{selected.length} valgt</span>
        <select value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Ny ejer">
          {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <button className="btn btn-secondary" disabled={pending || selected.length === 0}
          onClick={async () => { if (await run('POST', '/api/bank-tasks/assign', { ids: selected, ownerId: owner })) setSelected([]); }}>
          Tildel valgte
        </button>
      </div>
      <ErrorBox error={error} />
    </>
  );
}
