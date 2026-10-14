'use client';

import { useEffect, useId, useMemo, useRef } from 'react';
import { layoutWorkflow, type LayoutEdge, type LayoutNode } from '@/lib/workflow/layout';
import type { WorkflowDefinition, WorkflowProgress } from '@/lib/workflow/types';
import { StepIcon } from './StepIcon';

interface Props {
  workflow: WorkflowDefinition;
  /** Valgt trin (fx fra ?step=) – markeres og scrolles i midten. */
  selected?: string | null;
  onSelect?: (key: string) => void;
  /** Et konkret forløbs position: aktuelt trin og vejen dertil fremhæves. */
  progress?: WorkflowProgress;
  label?: string;
}

/**
 * Forløbsdiagram: trin som knapper (HTML) oven på kanter (SVG) i en vandret
 * scrollbar flade. Layoutet beregnes af lib/workflow/layout.
 */
export function WorkflowDiagram({ workflow, selected = null, onSelect, progress, label }: Props) {
  const layout = useMemo(() => layoutWorkflow(workflow), [workflow]);
  const scroller = useRef<HTMLDivElement>(null);
  const marker = `wf${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const focus = selected ?? progress?.current ?? null;

  useEffect(() => {
    const el = scroller.current;
    const node = layout.nodes.find((n) => n.key === focus);
    if (!el || !node) return;
    el.scrollTo({ left: Math.max(0, node.x + node.width / 2 - el.clientWidth / 2), behavior: 'smooth' });
  }, [focus, layout]);

  const path = progress?.path ?? [];
  const onPath = new Set(path);
  const walked = new Set(path.slice(1).map((k, i) => `${path[i]}>${k}`));
  const active = (e: LayoutEdge) => walked.has(`${e.from}>${e.to}`);

  const nodeClass = (n: LayoutNode) => [
    'wf-node',
    n.automated ? 'auto' : '',
    n.kind === 'integration' ? 'integration' : '',
    n.kind === 'end' ? `end ${n.tone}` : '',
    selected === n.key ? 'selected' : '',
    progress?.current === n.key ? 'current' : '',
    progress && onPath.has(n.key) && progress.current !== n.key ? 'done' : '',
    progress && !onPath.has(n.key) ? 'dim' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className="wf-scroll" ref={scroller} role="group" aria-label={label ?? `Diagram: ${workflow.title}`}>
      <div className="wf-canvas" style={{ width: layout.width, height: layout.height }}>
        <svg className="wf-edges" width={layout.width} height={layout.height} aria-hidden="true">
          <defs>
            {['', '-on'].map((suffix) => (
              <marker key={suffix} id={`${marker}${suffix}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
                <path d="M0 0L10 5L0 10z" className={`wf-arrow${suffix ? ' active' : ''}`} />
              </marker>
            ))}
          </defs>
          <circle className="wf-start" cx={layout.start.x} cy={layout.start.y} r={5} />
          {layout.edges.map((e) => (
            <path key={e.id} d={e.path} className={active(e) ? 'active' : ''} markerEnd={`url(#${marker}${active(e) ? '-on' : ''})`} />
          ))}
        </svg>
        {layout.edges.map((e) => (
          <span key={e.id} className={`wf-label${active(e) ? ' active' : ''}`} style={{ left: e.label.x, top: e.label.y }}>{e.outcome}</span>
        ))}
        {layout.nodes.map((n) => (
          <button
            key={n.key}
            type="button"
            className={nodeClass(n)}
            style={{ left: n.x, top: n.y, width: n.width, height: n.height }}
            onClick={() => onSelect?.(n.key)}
            aria-pressed={selected === n.key}
            aria-label={`${n.index}. ${n.title}${n.subtitle ? `, ${n.subtitle}` : ''}${progress?.current === n.key ? ' – forløbet er her nu' : ''}`}
            title={n.title}
          >
            <StepIcon kind={n.kind} />
            <span className="wf-text">
              <strong>{n.title}</strong>
              {n.subtitle && <small>{n.subtitle}</small>}
            </span>
            {progress?.current === n.key && <span className="wf-now">Her nu</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
