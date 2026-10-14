'use client';

import { useState } from 'react';
import { CHANGE, SOURCE } from '../labels';
import { ErrorBox, Modal, useAction } from './action';

export interface PopItem {
  id: string;
  bankId: string;
  bankName: string;
  relationType: string;
  change: string;
  sources: string[];
  priorYearRelation: boolean;
  removalReason?: string;
}

const SOURCES = ['PRIOR_YEAR', 'R75', 'ERP', 'CUSTOMER', 'AUDITOR'] as const;

function ChangePill({ change }: { change: string }) {
  const b = CHANGE[change] ?? CHANGE.PROPOSED!;
  return <span className={`pill pill-sm tone-${b.tone}`}><span aria-hidden>{b.icon}</span> {b.label}</span>;
}

function SourcePicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <span className="chips">
      {SOURCES.map((s) => (
        <label key={s} className="chip">
          <input type="checkbox" checked={value.includes(s)} onChange={(e) => onChange(e.target.checked ? [...value, s] : value.filter((x) => x !== s))} />
          {SOURCE[s]}
        </label>
      ))}
    </span>
  );
}

function ItemRow({ item, subtaskId, editable }: { item: PopItem; subtaskId: string; editable: boolean }) {
  const [mode, setMode] = useState<'view' | 'edit' | 'remove'>('view');
  const [relation, setRelation] = useState(item.relationType);
  const [sources, setSources] = useState(item.sources);
  const [reason, setReason] = useState('');
  const { run, pending, error } = useAction();
  const url = `/api/bank-confirmations/${subtaskId}/population/items/${item.id}`;
  const removed = item.change === 'REMOVED';

  return (
    <>
      <tr className={`${item.change === 'ADDED' ? 'row-hl' : ''} ${removed ? 'row-removed' : ''}`}>
        <td className="strong">{item.bankName}</td>
        <td>
          {mode === 'edit' ? <input value={relation} onChange={(e) => setRelation(e.target.value)} aria-label="Relation" /> : item.relationType}
        </td>
        <td><ChangePill change={item.change} /></td>
        <td className="muted">
          {mode === 'edit' ? <SourcePicker value={sources} onChange={setSources} /> : item.sources.map((s) => SOURCE[s] ?? s).join(' · ')}
        </td>
        <td>{item.priorYearRelation ? 'Ja' : '–'}</td>
        <td className="actions">
          {editable && !removed && mode === 'view' && (
            <>
              <button className="btn btn-link" onClick={() => setMode('edit')}>Redigér</button>
              <button className="btn btn-link danger" onClick={() => setMode('remove')}>Fjern</button>
            </>
          )}
          {mode === 'edit' && (
            <>
              <button
                className="btn btn-link"
                disabled={pending}
                onClick={async () => {
                  const ok = await run('PATCH', url, { relationType: relation, sources, ...(item.change === 'UNCHANGED' ? { change: 'CHANGED' } : {}) });
                  if (ok) setMode('view');
                }}
              >Gem</button>
              <button className="btn btn-link" onClick={() => setMode('view')}>Annullér</button>
            </>
          )}
        </td>
      </tr>
      {removed && item.removalReason && (
        <tr className="row-note"><td colSpan={6} className="muted small">Fjernet: {item.removalReason}</td></tr>
      )}
      {mode === 'remove' && (
        <tr className="row-note">
          <td colSpan={6}>
            <div className="row">
              <input className="grow" placeholder="Begrundelse for fjernelse (påkrævet)" value={reason} onChange={(e) => setReason(e.target.value)} />
              <button
                className="btn btn-danger"
                disabled={pending}
                onClick={async () => {
                  const ok = await run('PATCH', url, { change: 'REMOVED', removalReason: reason });
                  if (ok) setMode('view');
                }}
              >Fjern bank</button>
              <button className="btn btn-link" onClick={() => setMode('view')}>Annullér</button>
            </div>
          </td>
        </tr>
      )}
      {error && <tr className="row-note"><td colSpan={6}><ErrorBox error={error} /></td></tr>}
    </>
  );
}

export function AddBank({ url, banks, exclude, label = '+ Tilføj bank', defaultSources = ['CUSTOMER'] }: {
  url: string;
  banks: { id: string; name: string }[];
  exclude: string[];
  label?: string;
  defaultSources?: string[];
}) {
  const options = banks.filter((b) => !exclude.includes(b.id));
  const [open, setOpen] = useState(false);
  const [bankId, setBankId] = useState(options[0]?.id ?? '');
  const [relation, setRelation] = useState('Konto');
  const [sources, setSources] = useState<string[]>(defaultSources);
  const { run, pending, error } = useAction();
  if (!open) return <button className="btn btn-link" onClick={() => setOpen(true)} disabled={options.length === 0}>{label}</button>;
  const isDelta = url.endsWith('/delta');
  return (
    <div className="inline-form">
      <select value={bankId} onChange={(e) => setBankId(e.target.value)} aria-label="Bank">
        {options.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
      <input value={relation} onChange={(e) => setRelation(e.target.value)} aria-label="Relation" placeholder="Relation (fx konto, lån)" />
      <SourcePicker value={sources} onChange={setSources} />
      <div className="row">
        <button
          className="btn btn-primary"
          disabled={pending || !bankId}
          onClick={async () => {
            const item = { bankId, relationType: relation, sources };
            const ok = await run('POST', url, isDelta ? { items: [item] } : item);
            if (ok) setOpen(false);
          }}
        >{isDelta ? 'Opret delta-version' : 'Tilføj'}</button>
        <button className="btn btn-link" onClick={() => setOpen(false)}>Annullér</button>
      </div>
      <ErrorBox error={error} />
    </div>
  );
}

export function PopulationTable({ subtaskId, items, editable, banks }: { subtaskId: string; items: PopItem[]; editable: boolean; banks: { id: string; name: string }[] }) {
  return (
    <>
      <table className="table">
        <thead>
          <tr><th>Bank</th><th>Relation</th><th>Ændring</th><th>Kilder</th><th>Sidste år</th><th /></tr>
        </thead>
        <tbody>
          {items.length === 0 && <tr><td colSpan={6} className="muted">Ingen banker endnu.</td></tr>}
          {items.map((i) => <ItemRow key={i.id} item={i} subtaskId={subtaskId} editable={editable} />)}
        </tbody>
      </table>
      {editable && (
        <AddBank url={`/api/bank-confirmations/${subtaskId}/population/items`} banks={banks} exclude={items.filter((i) => i.change !== 'REMOVED').map((i) => i.bankId)} />
      )}
    </>
  );
}

/** F02: godkendelsesdialog med konsekvens før handlingen. */
export function ApprovePopulation(props: {
  subtaskId: string;
  versionId: string;
  version: number;
  kind: 'FULL' | 'DELTA';
  customer: string;
  banks: string[];
  removed: number;
  authorizationDeadline: string;
  sendDate: string;
  actorName: string;
  existingTasks: number;
}) {
  const [open, setOpen] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const { run, pending, error } = useAction();
  const n = props.banks.length;
  const label = props.kind === 'DELTA' ? `Godkend version ${props.version}` : `Godkend population (${n} ${n === 1 ? 'bank' : 'banker'})`;
  return (
    <div className="stack">
      <div className="row">
        <button className="btn btn-primary" onClick={() => setOpen(true)} disabled={n === 0}>{label}</button>
        <button className="btn btn-secondary" onClick={() => setRejecting((r) => !r)}>{props.kind === 'DELTA' ? 'Afvis ændring' : 'Returnér til Kerne'}</button>
      </div>
      {rejecting && (
        <div className="row">
          <input className="grow" placeholder="Begrundelse (påkrævet)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button className="btn btn-danger" disabled={pending} onClick={() => void run('POST', `/api/bank-confirmations/${props.subtaskId}/population/reject`, { versionId: props.versionId, reason })}>
            Returnér
          </button>
        </div>
      )}
      {!open && <ErrorBox error={error} />}
      {open && (
        <Modal title={`Godkend bankpopulation version ${props.version}`} onClose={() => setOpen(false)}>
          <p className="muted small">Du godkender</p>
          <p><strong>{props.customer}</strong> · {n} {n === 1 ? 'bank' : 'banker'}: {props.banks.join(', ')}</p>
          <p className="muted small">Systemet gør herefter automatisk</p>
          <ul className="bullets">
            <li>Låser version {props.version} af populationen</li>
            <li>Opretter {n} BankTask{n === 1 ? '' : 's'} hos Kerne – én pr. bank</li>
            <li>Tildeler gældende bankmetode til hver opgave</li>
            <li>Kerne indhenter autorisation senest {props.authorizationDeadline}</li>
            <li>Anmodninger sendes {props.sendDate}</li>
            {props.kind === 'DELTA' && <li>{props.existingTasks} eksisterende BankTasks fortsætter uændret · tidligere versioner bevares</li>}
            {props.removed > 0 && <li>{props.removed} fjernet bank(er) med begrundelse indgår i godkendelsen</li>}
          </ul>
          <p className="muted small">Godkendes som {props.actorName} · tidspunkt og version logges.</p>
          <ErrorBox error={error} />
          <div className="row end">
            <button className="btn btn-secondary" onClick={() => setOpen(false)}>Annullér</button>
            <button
              className="btn btn-primary"
              disabled={pending}
              onClick={async () => {
                const ok = await run('POST', `/api/bank-confirmations/${props.subtaskId}/population/approve`, { versionId: props.versionId });
                if (ok) setOpen(false);
              }}
            >Godkend version {props.version}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
