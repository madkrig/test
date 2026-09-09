import type { TaskPhase, TaskStatus } from "../../data/types";
import type { TaskRow } from "../../lib/aggregate";
import { StackedBar } from "../StackedBar";

const PHASE_ORDER: TaskPhase[] = ["Stamdata", "Planlægning", "Løbende", "Afslutning"];

export function TaskStatusTable({
  rows,
  activeStatus,
}: {
  rows: TaskRow[];
  activeStatus: TaskStatus | null;
}) {
  const filtered = activeStatus
    ? rows.filter((r) => r.counts[activeStatus] > 0)
    : rows;

  const byPhase = PHASE_ORDER.map((phase) => ({
    phase,
    rows: filtered
      .filter((r) => r.phase === phase)
      .sort((a, b) =>
        activeStatus ? b.counts[activeStatus] - a.counts[activeStatus] : 0,
      ),
  })).filter((g) => g.rows.length > 0);

  return (
    <div className="max-h-[420px] overflow-y-auto pr-1 space-y-3">
      {byPhase.map(({ phase, rows: phaseRows }) => (
        <div key={phase} className="flex gap-3">
          <div className="w-20 shrink-0 pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-cedra-700/60">
            {phase}
          </div>
          <div className="flex-1 space-y-2 min-w-0">
            {phaseRows.map((row) => (
              <div key={row.name} className="flex items-center gap-3">
                <div
                  className="w-52 shrink-0 truncate text-xs text-cedra-950"
                  title={row.name}
                >
                  {row.name}
                </div>
                <div className="flex-1 min-w-0">
                  <StackedBar counts={row.counts} total={row.total} />
                </div>
                <div className="w-10 shrink-0 text-right text-[11px] tabular-nums text-cedra-700/60">
                  {row.total}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
      {byPhase.length === 0 && (
        <p className="text-xs text-cedra-700/50">Ingen opgaver matcher de valgte filtre.</p>
      )}
    </div>
  );
}
