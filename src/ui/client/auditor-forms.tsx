'use client';

import { useState } from 'react';
import { ErrorBox, useAction } from './action';

/** F07/F09: revisorens faglige beslutning – valg, begrundelse, ejer og deadline logges. */
export function DecisionForm({ decisionId, options, recommended }: { decisionId: string; options: { id: string; label: string }[]; recommended?: string }) {
  const [option, setOption] = useState(recommended ?? '');
  const [reason, setReason] = useState('');
  const { run, pending, error } = useAction();
  return (
    <div className="stack">
      <fieldset className="radios">
        <legend className="muted small">Vælg håndtering</legend>
        {options.map((o) => (
          <label key={o.id}>
            <input type="radio" name={`d-${decisionId}`} value={o.id} checked={option === o.id} onChange={() => setOption(o.id)} />
            {o.label}
          </label>
        ))}
      </fieldset>
      <label className="stack-sm">
        <span className="muted small">Begrundelse (obligatorisk)</span>
        <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <ErrorBox error={error} />
      <div>
        <button className="btn btn-primary" disabled={pending || !option} onClick={() => void run('POST', `/api/decisions/${decisionId}/decide`, { option, reason })}>
          Registrér beslutning
        </button>
      </div>
    </div>
  );
}

export function ConclusionForm({ subtaskId, blockers }: { subtaskId: string; blockers: string[] }) {
  const [text, setText] = useState('');
  const { run, pending, error } = useAction();
  return (
    <div className="stack">
      <textarea rows={3} placeholder="Skriv konklusion…" value={text} onChange={(e) => setText(e.target.value)} />
      <p className="muted small">Kerne kan ikke formulere eller godkende konklusionen.</p>
      <ErrorBox error={error} />
      <div className="row">
        <button className="btn btn-primary" disabled={pending || !text.trim() || blockers.length > 0} onClick={() => void run('POST', `/api/bank-confirmations/${subtaskId}/conclusion`, { conclusion: text })}>
          Markér faglig behandling afsluttet
        </button>
      </div>
    </div>
  );
}

/** F12b: afklaringsopgave fra den månedlige kontrol. */
export function ClarificationForm({ itemId }: { itemId: string }) {
  const [reason, setReason] = useState('');
  const { run, pending, error } = useAction();
  const url = `/api/completeness-items/${itemId}/decide`;
  return (
    <div className="stack">
      <label className="stack-sm">
        <span className="muted small">Begrundelse ved fravalg</span>
        <textarea rows={2} placeholder="Påkrævet ved fravalg…" value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <ErrorBox error={error} />
      <div className="row">
        <button className="btn btn-secondary" disabled={pending} onClick={() => void run('POST', url, { decision: 'OPT_OUT', reason })}>Fravælg med begrundelse</button>
        <button className="btn btn-primary" disabled={pending} onClick={() => void run('POST', url, { decision: 'OPT_IN' })}>Tilvælg bankbekræftelser</button>
      </div>
    </div>
  );
}
