import { STATUS_COLORS, TASK_STATUSES } from "../data/types";
import type { TaskStatus } from "../data/types";

export function StatusCircles({
  counts,
  active,
  onSelect,
}: {
  counts: Record<TaskStatus, number>;
  active: TaskStatus | null;
  onSelect: (status: TaskStatus | null) => void;
}) {
  return (
    <div className="grid grid-cols-4 gap-3">
      {TASK_STATUSES.map((status) => {
        const isActive = active === status;
        const value = counts[status] ?? 0;
        return (
          <button
            key={status}
            type="button"
            onClick={() => onSelect(isActive ? null : status)}
            className="flex flex-col items-center gap-2 group"
          >
            <div
              className="rounded-full flex items-center justify-center text-white font-semibold transition-transform group-hover:scale-105"
              style={{
                background: STATUS_COLORS[status],
                width: 84,
                height: 84,
                fontSize: 15,
                outline: isActive ? `3px solid ${STATUS_COLORS[status]}88` : "none",
                outlineOffset: 3,
                opacity: active && !isActive ? 0.45 : 1,
              }}
            >
              {value.toLocaleString("da-DK")}
            </div>
            <span className="text-xs font-medium text-cedra-800">{status}</span>
          </button>
        );
      })}
    </div>
  );
}
