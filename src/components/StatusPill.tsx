import { STATUS_COLORS } from "../data/types";
import type { TaskStatus } from "../data/types";

export function StatusPill({ status }: { status: TaskStatus }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium text-white"
      style={{ background: STATUS_COLORS[status] }}
    >
      {status}
    </span>
  );
}

export function overallClientStatus(statuses: TaskStatus[]): TaskStatus {
  if (statuses.some((s) => s === "Kritisk")) return "Kritisk";
  if (statuses.some((s) => s === "Action")) return "Action";
  if (statuses.every((s) => s === "Udført")) return "Udført";
  return "Ej udført";
}
