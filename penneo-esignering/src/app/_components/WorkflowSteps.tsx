import { AUTOMATED_KINDS, KIND_LABELS, type StepKind, type WorkflowDefinition, type WorkflowProgress } from '@/lib/workflow/types';
import { StepIcon } from './StepIcon';

interface Props {
  workflow: WorkflowDefinition;
  selected?: string | null;
  onSelect?: (key: string) => void;
  progress?: WorkflowProgress;
}

const iconClass = (kind: StepKind) => (AUTOMATED_KINDS.has(kind) ? 'auto' : kind === 'integration' ? 'integration' : '');

/** Trin-tabellen under diagrammet: trin, hvem og ruter. Rækkerne har id "step-<nøgle>". */
export function WorkflowSteps({ workflow, selected = null, onSelect, progress }: Props) {
  const titles = new Map([...workflow.steps, ...workflow.ends].map((s) => [s.key, s.title]));
  const rowClass = (key: string) => ['row', selected === key ? 'open' : '', progress?.current === key ? 'highlight' : ''].filter(Boolean).join(' ');

  return (
    <div className="table-wrap">
      <table className="stack wf-steps">
        <thead>
          <tr><th className="wf-num">#</th><th>Trin</th><th>Hvem</th><th>Ruter</th></tr>
        </thead>
        <tbody>
          {workflow.steps.map((s, i) => (
            <tr key={s.key} id={`step-${s.key}`} className={rowClass(s.key)} onClick={() => onSelect?.(s.key)}>
              <td className="wf-num">{i + 1}</td>
              <td>
                <div className="wf-step">
                  <span className={`wf-icon ${iconClass(s.kind)}`}><StepIcon kind={s.kind} size={18} /></span>
                  <div>
                    <strong>{s.title}</strong>
                    {s.badge === 'start' && <span className="tag start">Start</span>}
                    {s.badge === 'exception' && <span className="tag waiting">Undtagelse</span>}
                    <small className="wf-line"><code>{s.key}</code> · {KIND_LABELS[s.kind]}</small>
                  </div>
                </div>
              </td>
              <td data-label="Hvem">
                {s.who ? <strong>{s.who}</strong> : '–'}
                {s.details?.map((d) => <small key={d} className="wf-line">{d}</small>)}
              </td>
              <td data-label="Ruter">
                {s.routes.map((r) => (
                  <span key={`${r.outcome}-${r.to}`} className="wf-route">
                    <code>{r.outcome}</code> → {titles.get(r.to)}
                    {r.note && <small className="wf-line">{r.note}</small>}
                  </span>
                ))}
              </td>
            </tr>
          ))}
          {workflow.ends.map((e, i) => (
            <tr key={e.key} id={`step-${e.key}`} className={rowClass(e.key)} onClick={() => onSelect?.(e.key)}>
              <td className="wf-num">{workflow.steps.length + i + 1}</td>
              <td>
                <div className="wf-step">
                  <span className={`wf-icon end ${e.tone}`}><StepIcon kind="end" size={18} /></span>
                  <div>
                    <strong>{e.title}</strong>
                    <small className="wf-line"><code>{e.key}</code> · Slut</small>
                  </div>
                </div>
              </td>
              <td data-label="Hvem">–</td>
              <td data-label="Ruter">–</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
