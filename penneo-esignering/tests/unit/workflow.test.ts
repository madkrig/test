import { describe, expect, it } from 'vitest';
import { E_SIGNING_WORKFLOW, SIGNING_STATUSES, workflowProgress } from '@/domain/e-signing';
import { findCollisions, layoutWorkflow, type WorkflowLayout } from '@/lib/workflow/layout';
import type { WorkflowDefinition } from '@/lib/workflow/types';
import { CONTRACT_REVIEW } from '../fixtures/contract-review';

const node = (l: WorkflowLayout, key: string) => l.nodes.find((n) => n.key === key)!;
const edge = (l: WorkflowLayout, id: string) => l.edges.find((e) => e.id === id)!;

describe('layout – genskabelse af referencediagrammet (contract review)', () => {
  const l = layoutWorkflow(CONTRACT_REVIEW);

  it('lægger hovedsporet i øverste række og undtagelsen under, mellem to kolonner', () => {
    expect(['intake', 'checks', 'exceptions', 'legal_review'].map((k) => [node(l, k).rank, node(l, k).row])).toEqual([
      [0, 0], [1, 0], [2, 1], [3, 0],
    ]);
  });

  it('tegner lige linjer på hovedsporet og S-kurver ind og ud af undtagelsen', () => {
    expect(edge(l, 'intake:submitted:checks').shape).toBe('straight');
    expect(edge(l, 'checks:passed:legal_review').shape).toBe('straight');
    expect(edge(l, 'checks:failed:exceptions').shape).toBe('curve');
    expect(edge(l, 'exceptions:accepted:legal_review').shape).toBe('curve');
  });

  it('fører "returned" over hovedsporet fra øverste række og under fra rækken nedenfor', () => {
    const top = edge(l, 'legal_review:returned:intake');
    const bottom = edge(l, 'exceptions:returned:intake');
    const intake = node(l, 'intake');
    expect(top.shape).toBe('loop');
    expect(Math.min(...top.points.map((p) => p.y))).toBeLessThan(intake.y);
    expect(top.points.at(-1)!.y).toBe(intake.y); // ind i toppen
    expect(Math.max(...bottom.points.map((p) => p.y))).toBeGreaterThan(node(l, 'exceptions').y + node(l, 'exceptions').height);
    expect(bottom.points.at(-1)!.y).toBe(intake.y + intake.height); // ind i bunden
  });

  it('går uden om trin, der står i vejen på samme række, og tegner rent', () => {
    expect(edge(l, 'value_check:no:notify_approved').shape).toBe('curve');
    expect(findCollisions(l)).toEqual([]);
  });
});

describe('e-signeringsforløbet', () => {
  const l = layoutWorkflow(E_SIGNING_WORKFLOW);
  const keys = new Set([...E_SIGNING_WORKFLOW.steps, ...E_SIGNING_WORKFLOW.ends].map((s) => s.key));

  it('tegnes uden kanter gennem trin og uden overlappende etiketter', () => {
    expect(findCollisions(l)).toEqual([]);
  });

  it('har hovedsporet fra start til Fuldført i øverste række', () => {
    const spine = ['intake', 'master_data_check', 'document', 'penneo_signing', 'archive', 'notify_signed', 'completed'];
    expect(spine.map((k) => node(l, k).row)).toEqual(spine.map(() => 0));
    expect(spine.map((k) => node(l, k).rank)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('når alle trin og begge sluttilstande fra start', () => {
    const reached = new Set([E_SIGNING_WORKFLOW.start]);
    for (const queue = [E_SIGNING_WORKFLOW.start]; queue.length;) {
      const key = queue.shift();
      const step = E_SIGNING_WORKFLOW.steps.find((s) => s.key === key);
      for (const r of step?.routes ?? []) if (!reached.has(r.to)) { reached.add(r.to); queue.push(r.to); }
    }
    expect([...reached].sort()).toEqual([...keys].sort());
  });

  it('kender et trin for hver status, og vejen følger forløbets ruter', () => {
    for (const status of SIGNING_STATUSES) {
      for (const archiveFailed of [false, true]) {
        const { current, path } = workflowProgress(status, archiveFailed);
        expect(keys.has(current)).toBe(true);
        expect(path.at(-1)).toBe(current);
        path.slice(1).forEach((to, i) => {
          const from = E_SIGNING_WORKFLOW.steps.find((s) => s.key === path[i])!;
          expect(from.routes.some((r) => r.to === to), `${path[i]} → ${to}`).toBe(true);
        });
      }
    }
    expect(workflowProgress('SIGNED', true).current).toBe('archive_failed');
    expect(workflowProgress('SIGNED', false).current).toBe('archive');
  });
});

describe('ugyldige forløb', () => {
  const base: WorkflowDefinition = { key: 'x', title: 'X', start: 'a', steps: [{ key: 'a', title: 'A', kind: 'form', routes: [{ outcome: 'ok', to: 'done' }] }], ends: [{ key: 'done', title: 'Slut', tone: 'ok' }] };

  it('afviser ruter til ukendte trin og ukendt start', () => {
    expect(() => layoutWorkflow({ ...base, steps: [{ ...base.steps[0]!, routes: [{ outcome: 'ok', to: 'nowhere' }] }] })).toThrow('ukendt trin "nowhere"');
    expect(() => layoutWorkflow({ ...base, start: 'b' })).toThrow('ukendt trin "b"');
  });

  it('respekterer et rækkehint og afviser et, der kolliderer', () => {
    const def: WorkflowDefinition = {
      ...base,
      steps: [
        { key: 'a', title: 'A', kind: 'form', routes: [{ outcome: 'ok', to: 'c' }, { outcome: 'alt', to: 'b' }] },
        { key: 'c', title: 'C', kind: 'task', routes: [{ outcome: 'ok', to: 'done' }] },
        { key: 'b', title: 'B', kind: 'task', routes: [{ outcome: 'ok', to: 'done' }], row: 3 },
      ],
    };
    expect(node(layoutWorkflow(def), 'b').row).toBe(3);
    // b og c står i samme kolonne; c ligger allerede i række 0.
    expect(() => layoutWorkflow({ ...def, steps: [def.steps[0]!, def.steps[1]!, { ...def.steps[2]!, row: 0 }] })).toThrow('pladsen er optaget');
  });
});
