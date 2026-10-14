'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, type ReactNode } from 'react';

export interface ApiError {
  code: string;
  message: string;
  reasons?: string[];
  owner?: string;
  recovery?: string;
  existingId?: string;
}

type Outcome = { ok: true; data: any } | { ok: false; error: ApiError };

/** Kald API'et som den valgte bruger (cookien cedra-user sendes automatisk). */
export async function api(method: string, url: string, body?: unknown, idempotencyKey?: string): Promise<Outcome> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
  const res = await fetch(url, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: json.error ?? { code: 'INTERNAL', message: 'Uventet fejl.' } };
  return { ok: true, data: json };
}

/**
 * Én handling: viser ventetilstand, fejl (årsag, ejer, recovery) og opdaterer siden bagefter.
 * Idempotency-Key genbruges ved genforsøg og fornys først efter en vellykket handling.
 */
export function useAction() {
  const router = useRouter();
  const key = useRef<string>(crypto.randomUUID());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [result, setResult] = useState<any>(null);

  async function run(method: string, url: string, body?: unknown, opts: { idempotent?: boolean; redirect?: (data: any) => string | undefined } = {}) {
    setPending(true);
    setError(null);
    const out = await api(method, url, body, opts.idempotent ? key.current : undefined);
    setPending(false);
    if (!out.ok) {
      setError(out.error);
      return false;
    }
    key.current = crypto.randomUUID();
    setResult(out.data);
    const to = opts.redirect?.(out.data);
    if (to) router.push(to);
    router.refresh();
    return true;
  }

  return { run, pending, error, result, clear: () => setError(null) };
}

export function ErrorBox({ error }: { error: ApiError | null }) {
  if (!error) return null;
  return (
    <div className="callout tone-red" role="alert">
      <strong>{error.message}</strong>
      {error.reasons && error.reasons.length > 0 && (
        <ul>{error.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
      )}
      {(error.owner || error.recovery) && (
        <p className="small">
          {error.owner ? `Ejer: ${error.owner}. ` : ''}
          {error.recovery ?? ''}
        </p>
      )}
      {error.existingId && <p className="small">Eksisterende subopgave: {error.existingId}</p>}
    </div>
  );
}

export function ActionButton(props: {
  label: string;
  url: string;
  method?: string;
  body?: unknown;
  idempotent?: boolean;
  variant?: 'primary' | 'secondary' | 'danger' | 'link';
  disabled?: boolean;
  confirm?: string;
  redirect?: string;
}) {
  const { run, pending, error } = useAction();
  return (
    <span className="action">
      <button
        type="button"
        className={`btn btn-${props.variant ?? 'primary'}`}
        disabled={props.disabled || pending}
        onClick={() => {
          if (props.confirm && !window.confirm(props.confirm)) return;
          void run(props.method ?? 'POST', props.url, props.body, { idempotent: props.idempotent, redirect: () => props.redirect });
        }}
      >
        {pending ? 'Arbejder…' : props.label}
      </button>
      <ErrorBox error={error} />
    </span>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export { Link };
