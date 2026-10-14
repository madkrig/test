import type { NodeKind } from '@/lib/workflow/layout';

/** Små stregikoner pr. trintype (24×24, følger tekstfarven). */
const PATHS: Record<NodeKind, string[]> = {
  form: ['M11 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5', 'M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z'],
  check: ['M3 6.5l1.8 1.8L8 5', 'M3 15.5l1.8 1.8L8 14', 'M11.5 7h9', 'M11.5 16h9'],
  task: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M8.5 12.2l2.4 2.4 4.6-5'],
  decision: ['M12 21v-7.5', 'M12 13.5 6 7.5', 'M12 13.5l6-6', 'M5 11V6.5h4.5', 'M14.5 6.5H19V11'],
  external: ['M4 20h16', 'M14.5 4.5l4 4L9 18H5v-4z'],
  integration: ['M10 13.5a4.5 4.5 0 0 0 6.6.4l2.6-2.6a4.5 4.5 0 0 0-6.4-6.4l-1.4 1.4', 'M14 10.5a4.5 4.5 0 0 0-6.6-.4l-2.6 2.6a4.5 4.5 0 0 0 6.4 6.4l1.4-1.4'],
  notify: ['M6 9a6 6 0 1 1 12 0c0 6.5 2.5 8.5 2.5 8.5h-17S6 15.5 6 9z', 'M10.2 20.5a2 2 0 0 0 3.6 0'],
  end: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z'],
};

export function StepIcon({ kind, size = 20 }: { kind: NodeKind; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[kind].map((d) => <path key={d} d={d} />)}
      {kind === 'end' && <circle cx={12} cy={12} r={4.5} fill="currentColor" stroke="none" />}
    </svg>
  );
}
