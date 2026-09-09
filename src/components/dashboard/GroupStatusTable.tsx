import type { TaskStatus } from "../../data/types";
import { statusTotal } from "../../lib/aggregate";
import type { GroupStatusRow } from "../../lib/aggregate";
import { StackedBar } from "../StackedBar";

export function GroupStatusTable({
  title,
  rows,
  activeStatus,
  mode = "count",
}: {
  title: string;
  rows: GroupStatusRow[];
  activeStatus: TaskStatus | null;
  mode?: "count" | "percent";
}) {
  const sorted = activeStatus
    ? [...rows].sort((a, b) => b.counts[activeStatus] - a.counts[activeStatus])
    : rows;
  return (
    <div>
      <div className="flex items-center gap-1 text-[11px] font-semibold text-cedra-700/70 uppercase tracking-wide mb-1.5">
        <span>{title}</span>
        <svg width="9" height="9" viewBox="0 0 10 10" className="text-cedra-700/40">
          <path d="M1 3 L5 7 L9 3" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      </div>
      <div className="space-y-2">
        {sorted.map((row) => (
          <div key={row.key} className="flex items-center gap-3">
            <div className="w-24 shrink-0 truncate text-xs text-cedra-950" title={row.key}>
              {row.key}
            </div>
            <div className="flex-1 min-w-0">
              <StackedBar counts={row.counts} total={row.total} mode={mode} />
            </div>
            <div className="w-10 shrink-0 text-right text-[11px] tabular-nums text-cedra-700/60">
              {mode === "percent"
                ? "100%"
                : statusTotal(row.counts).toLocaleString("da-DK")}
            </div>
          </div>
        ))}
        {rows.length === 0 && (
          <p className="text-xs text-cedra-700/50">Ingen data at vise.</p>
        )}
      </div>
      {activeStatus && (
        <p className="mt-2 text-[10px] text-cedra-700/50">
          Fremhæver fordeling for status: {activeStatus}
        </p>
      )}
    </div>
  );
}
