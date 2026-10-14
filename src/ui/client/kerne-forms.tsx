'use client';

import { useState } from 'react';
import { ErrorBox, useAction } from './action';

export function AuthorizationForm(props: {
  customerId: string;
  today: string;
  validTo: string;
  tasks: { id: string; label: string; covered: boolean }[];
  defaultTaskId: string;
  bankRequirement?: string;
}) {
  const [signer, setSigner] = useState('');
  const [validFrom, setValidFrom] = useState(props.today);
  const [validTo, setValidTo] = useState(props.validTo);
  const [status, setStatus] = useState('VALID');
  const [atypical, setAtypical] = useState(false);
  const [requirement, setRequirement] = useState(props.bankRequirement ?? '');
  const [covered, setCovered] = useState<string[]>([props.defaultTaskId]);
  const { run, pending, error } = useAction();
  return (
    <div className="stack">
      <div className="form-grid">
        <label>Underskriver<input value={signer} onChange={(e) => setSigner(e.target.value)} placeholder="Navn og rolle (tegningsberettiget)" /></label>
        <label>Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="VALID">Gyldig</option>
            <option value="UNCERTAIN">Usikker (kræver fire-øjne)</option>
            <option value="REQUESTED">Anmodet</option>
          </select>
        </label>
        <label>Gyldig fra<input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} /></label>
        <label>Gyldig til<input type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} /></label>
        <label className="span2">Bankkrav<input value={requirement} onChange={(e) => setRequirement(e.target.value)} placeholder="Fx bankens egen fuldmagtsblanket" /></label>
      </div>
      <label className="chip"><input type="checkbox" checked={atypical} onChange={(e) => setAtypical(e.target.checked)} /> Atypisk autorisation</label>
      <div>
        <span className="muted small">Dækker bankopgaver</span>
        <div className="chips">
          {props.tasks.map((t) => (
            <label key={t.id} className="chip">
              <input type="checkbox" checked={covered.includes(t.id)} onChange={(e) => setCovered(e.target.checked ? [...covered, t.id] : covered.filter((x) => x !== t.id))} />
              {t.label}{t.covered ? ' (dækket)' : ''}
            </label>
          ))}
        </div>
      </div>
      <ErrorBox error={error} />
      <div>
        <button
          className="btn btn-primary"
          disabled={pending || !signer.trim() || covered.length === 0}
          onClick={() => void run('POST', '/api/authorizations', {
            customerId: props.customerId, signer, validFrom, validTo, status, atypical, coveredBankTaskIds: covered,
            ...(requirement ? { bankRequirement: requirement } : {}), validationResult: 'Tegningsregel kontrolleret i CVR (prototype)',
          })}
        >Registrér autorisation</button>
      </div>
    </div>
  );
}

export function FourEyesForm({ taskId, performers, defaultPerformer }: { taskId: string; performers: { id: string; name: string }[]; defaultPerformer: string }) {
  const [performer, setPerformer] = useState(defaultPerformer);
  const { run, pending, error } = useAction();
  return (
    <div className="stack">
      <div className="row">
        <label className="row">
          <span className="muted small">Udført af</span>
          <select value={performer} onChange={(e) => setPerformer(e.target.value)}>
            {performers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <button className="btn btn-primary" disabled={pending} onClick={() => void run('POST', `/api/bank-tasks/${taskId}/four-eyes`, { performerId: performer })}>
          Godkend som reviewer
        </button>
      </div>
      <ErrorBox error={error} />
    </div>
  );
}

export function ReceiveForm({ taskId, channel, defaultFile }: { taskId: string; channel: string; defaultFile: string }) {
  const [file, setFile] = useState(defaultFile);
  const [ch, setCh] = useState(channel);
  const { run, pending, error } = useAction();
  return (
    <div className="stack">
      <div className="form-grid">
        <label>Kanal
          <select value={ch} onChange={(e) => setCh(e.target.value)}>
            <option value="PLATFORM">Platform</option>
            <option value="UPLOAD_PORTAL">Uploadportal</option>
            <option value="EMAIL">E-mail</option>
            <option value="OTHER">Særskilt portal</option>
          </select>
        </label>
        <label>Originalfil<input value={file} onChange={(e) => setFile(e.target.value)} /></label>
      </div>
      <ErrorBox error={error} />
      <div>
        <button className="btn btn-primary" disabled={pending || !file.trim()} onClick={() => void run('POST', `/api/bank-tasks/${taskId}/receive`, { channel: ch, originalFileName: file }, { idempotent: true })}>
          Registrér banksvar
        </button>
      </div>
    </div>
  );
}

const CHECKS: [string, string][] = [
  ['entity', 'Juridisk enhed'],
  ['bank', 'Bank'],
  ['statusDate', 'Statusdato'],
  ['reference', 'Reference'],
  ['readable', 'Læsbar'],
  ['complete', 'Komplet (alle konti og engagementer)'],
];

/** F08: administrativ kontrol – Kerne vurderer ikke revisionsbeviset. */
export function CheckForm({ taskId, labels }: { taskId: string; labels: Record<string, string> }) {
  const [checks, setChecks] = useState<Record<string, boolean>>(Object.fromEntries(CHECKS.map(([k]) => [k, false])));
  const [deviations, setDeviations] = useState('');
  const { run, pending, error } = useAction();
  const all = Object.values(checks).every(Boolean);
  return (
    <div className="stack">
      <ul className="checks">
        {CHECKS.map(([k, label]) => (
          <li key={k}>
            <label className="chip">
              <input type="checkbox" checked={checks[k]} onChange={(e) => setChecks({ ...checks, [k]: e.target.checked })} />
              {label}{labels[k] ? `: ${labels[k]}` : ''}
            </label>
          </li>
        ))}
      </ul>
      <label className="stack-sm">
        <span className="muted small">Afvigelser til revisor (én pr. linje – åbner en faglig beslutning)</span>
        <textarea rows={2} value={deviations} onChange={(e) => setDeviations(e.target.value)} placeholder="Fx uventet garanti, ukendt konto…" />
      </label>
      <p className="muted small">Kerne udfører kun administrativ kontrol – vurdering af revisionsbeviset ligger hos revisor.</p>
      <ErrorBox error={error} />
      <div className="row">
        <button
          className="btn btn-primary"
          disabled={pending}
          onClick={() => void run('POST', `/api/bank-tasks/${taskId}/administrative-check`, {
            checks, deviations: deviations.split('\n').map((d) => d.trim()).filter(Boolean),
          }, { idempotent: true })}
        >{all ? 'Godkend kontrol og arkivér i SharePoint' : 'Registrér kontrol (fejl)'}</button>
      </div>
    </div>
  );
}

export function EscalateForm({ taskId }: { taskId: string }) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const { run, pending, error } = useAction();
  if (!open) return <button className="btn btn-link" onClick={() => setOpen(true)}>Eskalér undtagelse til revisor</button>;
  return (
    <div className="stack">
      <input placeholder="Beslutningsspørgsmål til revisor" value={question} onChange={(e) => setQuestion(e.target.value)} />
      <ErrorBox error={error} />
      <div className="row">
        <button className="btn btn-secondary" disabled={pending || !question.trim()} onClick={() => void run('POST', `/api/bank-tasks/${taskId}/escalate`, { question })}>Eskalér</button>
        <button className="btn btn-link" onClick={() => setOpen(false)}>Annullér</button>
      </div>
    </div>
  );
}

export function MethodForm({ bankId, current, today }: {
  bankId: string;
  today: string;
  current: { channel: string; urlOrChannel: string; authorizationRequirement: string; expectedResponseWorkdays: number; reminderMethod: string; escalationContact: string; requiredFields: string[] } | null;
}) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    channel: current?.channel ?? 'PLATFORM',
    urlOrChannel: current?.urlOrChannel ?? '',
    authorizationRequirement: current?.authorizationRequirement ?? 'GENERAL',
    expectedResponseWorkdays: current?.expectedResponseWorkdays ?? 10,
    reminderMethod: current?.reminderMethod ?? '',
    escalationContact: current?.escalationContact ?? '',
    requiredFields: (current?.requiredFields ?? ['CVR', 'Statusdato']).join(', '),
    validFrom: today,
    changeReason: '',
  });
  const { run, pending, error } = useAction();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  if (!open) return <button className="btn btn-secondary" onClick={() => setOpen(true)}>Ændr metode</button>;
  return (
    <div className="stack">
      <div className="form-grid">
        <label>Kanal
          <select value={f.channel} onChange={set('channel')}>
            <option value="PLATFORM">Platform</option>
            <option value="UPLOAD_PORTAL">Uploadportal</option>
            <option value="EMAIL">E-mail</option>
            <option value="OTHER">Særskilt portal</option>
          </select>
        </label>
        <label>URL eller kanal<input value={f.urlOrChannel} onChange={set('urlOrChannel')} /></label>
        <label>Autorisation
          <select value={f.authorizationRequirement} onChange={set('authorizationRequirement')}>
            <option value="GENERAL">Generel fuldmagt</option>
            <option value="BANK_SPECIFIC">Bankspecifik fuldmagt</option>
          </select>
        </label>
        <label>Forventet svartid (arbejdsdage)<input type="number" min={1} value={f.expectedResponseWorkdays} onChange={set('expectedResponseWorkdays')} /></label>
        <label>Påmindelse<input value={f.reminderMethod} onChange={set('reminderMethod')} /></label>
        <label>Eskalationskontakt<input value={f.escalationContact} onChange={set('escalationContact')} /></label>
        <label>Obligatoriske felter<input value={f.requiredFields} onChange={set('requiredFields')} /></label>
        <label>Gældende fra<input type="date" value={f.validFrom} onChange={set('validFrom')} /></label>
        <label className="span2">Ændringsbegrundelse (påkrævet)<input value={f.changeReason} onChange={set('changeReason')} /></label>
      </div>
      <ErrorBox error={error} />
      <div className="row">
        <button
          className="btn btn-primary"
          disabled={pending}
          onClick={async () => {
            const ok = await run('POST', `/api/banks/${bankId}/methods`, {
              ...f, expectedResponseWorkdays: Number(f.expectedResponseWorkdays),
              requiredFields: f.requiredFields.split(',').map((x) => x.trim()).filter(Boolean),
            });
            if (ok) setOpen(false);
          }}
        >Send til godkendelse</button>
        <button className="btn btn-link" onClick={() => setOpen(false)}>Annullér</button>
      </div>
      <p className="muted small">Reviewer må ikke være samme person.</p>
    </div>
  );
}
