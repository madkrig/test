import { STATUS_COLORS, TASK_STATUSES } from "../data/types";
import type { TaskStatus } from "../data/types";

export function StackedBar({
  counts,
  total,
  height = 18,
  showLabels = true,
  mode = "count",
}: {
  counts: Record<TaskStatus, number>;
  total: number;
  height?: number;
  showLabels?: boolean;
  mode?: "count" | "percent";
}) {
  if (total === 0) {
    return <div className="text-xs text-cedra-700/40">Ingen data</div>;
  }
  return (
    <div className="flex items-center w-full" style={{ height }}>
      {TASK_STATUSES.map((status) => {
        const value = counts[status] ?? 0;
        if (value === 0) return null;
        const pct = (value / total) * 100;
        return (
          <div
            key={status}
            className="h-full flex items-center justify-center overflow-hidden first:rounded-l-sm last:rounded-r-sm border-r border-white/60 last:border-r-0"
            style={{
              width: `${pct}%`,
              background: STATUS_COLORS[status],
            }}
            title={`${status}: ${value}`}
          >
            {showLabels && pct > (mode === "percent" ? 13 : 11) && (
              <span className="text-[10px] font-medium text-white px-0.5 whitespace-nowrap overflow-hidden">
                {mode === "percent" ? `${pct.toFixed(0)}%` : value.toLocaleString("da-DK")}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
