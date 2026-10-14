'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { api, errorBody, type ApiErrorBody } from '../_lib/api';

export type FieldDef =
  | { name: string; label: string; type: 'text' | 'textarea' | 'date' | 'number' | 'kr' | 'list' | 'numlist'; help?: string; required?: boolean; initial?: string; wide?: boolean }
  | { name: string; label: string; type: 'select'; options: { value: string; label: string }[]; help?: string; required?: boolean; initial?: string; wide?: boolean }
  | { name: string; label: string; type: 'checkboxes'; options: { value: string; label: string }[]; help?: string; initial?: string[]; wide?: boolean }
  | { name: string; label: string; type: 'checkbox'; help?: string; initial?: boolean; wide?: boolean };

export interface ActionProps {
  label: string;
  endpoint: string;
  method?: 'POST' | 'PATCH' | 'DELETE';
  body?: Record<string, unknown>;
  fields?: FieldDef[];
  title?: string;
  intro?: string;
  submitLabel?: string;
  variant?: 'primary' | 'secondary' | 'small' | 'small-secondary' | 'link';
  idempotent?: boolean;
  /** Ved advarsler (fx VR-08, AR-04) kan brugeren fortsætte bevidst – feltet sendes som true. */
  acknowledgeKey?: string;
  disabled?: boolean;
  disabledReason?: string;
  successMessage?: string;
  redirectTo?: string;
}

/** Tal skrevet på dansk ("−1.250.000,50") → øre. */
function krToOre(v: string): number | null {
  const cleaned = v.replace(/\s/g, '').replace(/[−–]/g, '-').replace(/\./g, '').replace(',', '.');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}

const CLASS: Record<NonNullable<ActionProps['variant']>, string> = {
  primary: '', secondary: 'secondary', small: 'small', 'small-secondary': 'small secondary', link: 'link',
};

/**
 * Én handling mod API'et: knap → (formular) → kald → opdatér siden. Fejl
 * vises præcis som API'et formulerer dem: hvad, hvorfor og hvad man gør nu.
 */
export function Action(props: ActionProps) {
  const router = useRouter();
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiErrorBody | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [key, setKey] = useState('');
  const initial = () => Object.fromEntries((props.fields ?? []).map((f) => [f.name, f.initial ?? (f.type === 'checkboxes' ? [] : f.type === 'checkbox' ? false : '')]));
  const [values, setValues] = useState<Record<string, unknown>>(initial);

  function start() {
    setError(null);
    setDone(null);
    setKey(crypto.randomUUID());
    if (props.fields?.length) {
      setValues(initial());
      setOpen(true);
    } else void submit({});
  }

  async function submit(extra: Record<string, unknown>) {
    const body: Record<string, unknown> = { ...(props.body ?? {}) };
    for (const f of props.fields ?? []) {
      const v = values[f.name];
      if (f.type === 'kr') {
        const ore = krToOre(String(v ?? ''));
        if (Number.isNaN(ore)) { setError({ code: 'VALIDATION', message: `${f.label}: skriv et beløb, fx −1.250.000,00.` }); return; }
        body[f.name] = ore;
      } else if (f.type === 'number') body[f.name] = v === '' ? null : Number(v);
      else if (f.type === 'list') body[f.name] = String(v ?? '').split(',').map((x) => x.trim()).filter(Boolean);
      else if (f.type === 'numlist') body[f.name] = String(v ?? '').split(',').map((x) => x.trim()).filter(Boolean).map(Number);
      else if ((f.type === 'text' || f.type === 'textarea' || f.type === 'date' || f.type === 'select') && v === '' && !f.required) continue;
      else body[f.name] = v;
    }
    setBusy(true);
    setError(null);
    try {
      // Felter med punktum i navnet ("params.dageFoerT") samles i et objekt.
      for (const key of Object.keys(body).filter((k) => k.includes('.'))) {
        const [head, tail] = [key.slice(0, key.indexOf('.')), key.slice(key.indexOf('.') + 1)];
        body[head] = { ...((body[head] as Record<string, unknown>) ?? {}), [tail]: body[key] };
        delete body[key];
      }
      await api(props.endpoint, { method: props.method ?? 'POST', body: { ...body, ...extra }, idempotencyKey: props.idempotent ? key || crypto.randomUUID() : undefined });
      setOpen(false);
      setDone(props.successMessage ?? null);
      if (props.redirectTo) router.push(props.redirectTo);
      router.refresh();
    } catch (e) {
      setError(errorBody(e));
    } finally {
      setBusy(false);
    }
  }

  const errorBox = error && (
    <div className="error" role="alert">
      <strong>{error.message}</strong>
      {error.reasons && error.reasons.length > 0 && <ul>{error.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
      {error.recovery && <div>{error.recovery}</div>}
      {props.acknowledgeKey && error.code === 'INVALID_STATE' && (
        <div className="error-actions">
          <button className="small secondary" disabled={busy} onClick={() => submit({ [props.acknowledgeKey!]: true })}>Fortsæt med advarslen</button>
        </div>
      )}
    </div>
  );

  return (
    <span className="action">
      <button className={CLASS[props.variant ?? 'primary']} disabled={busy || props.disabled} title={props.disabled ? props.disabledReason : undefined} onClick={start}>
        {busy && !open ? 'Arbejder …' : props.label}
      </button>
      {!open && errorBox && <span className="action-error">{errorBox}</span>}
      {done && <span className="action-done" role="status">{done}</span>}
      {open && (
        <div className="backdrop" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }} onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}>
          <div className="dialog simple" role="dialog" aria-modal="true" aria-labelledby={`${formId}-title`}>
            <div className="dialog-main">
              <div className="topline"><span>{props.label}</span><button className="close" aria-label="Luk" onClick={() => setOpen(false)}>×</button></div>
              <div className="dialog-body">
                <h2 id={`${formId}-title`}>{props.title ?? props.label}</h2>
                {props.intro && <p>{props.intro}</p>}
                <form id={formId} className="grid" onSubmit={(e) => { e.preventDefault(); void submit({}); }}>
                  {props.fields!.map((f) => (
                    <label key={f.name} className={`field${f.wide || f.type === 'textarea' || f.type === 'checkboxes' ? ' wide' : ''}`}>
                      <span>{f.label}</span>
                      {f.type === 'textarea' && <textarea required={f.required} value={String(values[f.name] ?? '')} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} />}
                      {(f.type === 'text' || f.type === 'date' || f.type === 'number' || f.type === 'kr' || f.type === 'list' || f.type === 'numlist') && (
                        <input type={f.type === 'kr' || f.type === 'list' || f.type === 'numlist' ? 'text' : f.type} inputMode={f.type === 'kr' ? 'decimal' : undefined} required={f.required} value={String(values[f.name] ?? '')} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} />
                      )}
                      {f.type === 'select' && (
                        <select required={f.required} value={String(values[f.name] ?? '')} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}>
                          <option value="">Vælg …</option>
                          {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      )}
                      {f.type === 'checkbox' && <input type="checkbox" checked={Boolean(values[f.name])} onChange={(e) => setValues({ ...values, [f.name]: e.target.checked })} />}
                      {f.type === 'checkboxes' && (
                        <span className="checks">
                          {f.options.map((o) => {
                            const list = (values[f.name] as string[]) ?? [];
                            return (
                              <label key={o.value} className="check">
                                <input type="checkbox" checked={list.includes(o.value)} onChange={(e) => setValues({ ...values, [f.name]: e.target.checked ? [...list, o.value] : list.filter((x) => x !== o.value) })} />
                                {o.label}
                              </label>
                            );
                          })}
                        </span>
                      )}
                      {f.help && <small>{f.help}</small>}
                    </label>
                  ))}
                </form>
                {errorBox}
              </div>
              <div className="actions">
                <button className="secondary" type="button" onClick={() => setOpen(false)}>Annullér</button>
                <button type="submit" form={formId} disabled={busy}>{busy ? 'Arbejder …' : props.submitLabel ?? props.label}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </span>
  );
}
