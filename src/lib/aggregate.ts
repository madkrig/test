import { TASK_STATUSES, TASK_TEMPLATES } from "../data/types";
import type {
  Client,
  Erklaering,
  Office,
  Region,
  Role,
  TaskPhase,
  TaskStatus,
} from "../data/types";

export interface Filters {
  erklaeringer: Erklaering[];
  ia: "Alle" | "Ja" | "Nej";
  regions: Region[];
  role: Role | "Alle";
}

export function applyFilters(clients: Client[], filters: Filters): Client[] {
  return clients.filter((c) => {
    if (!filters.erklaeringer.includes(c.erklaering)) return false;
    if (!filters.regions.includes(c.region)) return false;
    if (filters.ia === "Ja" && !c.iaInvolved) return false;
    if (filters.ia === "Nej" && c.iaInvolved) return false;
    if (filters.role !== "Alle" && c.role !== filters.role) return false;
    return true;
  });
}

function emptyStatusCounts(): Record<TaskStatus, number> {
  return { Kritisk: 0, Action: 0, "Ej udført": 0, Udført: 0 };
}

export function aggregateTaskStatus(clients: Client[]): Record<TaskStatus, number> {
  const counts = emptyStatusCounts();
  for (const c of clients) {
    for (const t of c.tasks) counts[t.status]++;
  }
  return counts;
}

export interface PeriodBucket {
  year: number;
  month: number;
  label: string;
  count: number;
}

export function periodEndDateBuckets(clients: Client[]): PeriodBucket[] {
  const map = new Map<string, PeriodBucket>();
  const monthLabels = [
    "januar",
    "februar",
    "marts",
    "april",
    "maj",
    "juni",
    "juli",
    "august",
    "september",
    "oktober",
    "november",
    "december",
  ];
  for (const c of clients) {
    const [yearStr, monthStr] = c.periodEndDate.split("-");
    const year = Number(yearStr);
    const month = Number(monthStr);
    const key = `${year}-${month}`;
    if (!map.has(key)) {
      map.set(key, { year, month, label: monthLabels[month - 1], count: 0 });
    }
    map.get(key)!.count++;
  }
  return Array.from(map.values()).sort(
    (a, b) => a.year - b.year || a.month - b.month,
  );
}

export interface TaskRow {
  phase: TaskPhase;
  name: string;
  counts: Record<TaskStatus, number>;
  total: number;
}

export function statusPerTask(clients: Client[]): TaskRow[] {
  const rows = new Map<string, TaskRow>();
  for (const t of TASK_TEMPLATES) {
    rows.set(t.name, {
      phase: t.phase,
      name: t.name,
      counts: emptyStatusCounts(),
      total: 0,
    });
  }
  for (const c of clients) {
    for (const t of c.tasks) {
      const row = rows.get(t.name);
      if (!row) continue;
      row.counts[t.status]++;
      row.total++;
    }
  }
  return Array.from(rows.values());
}

export interface GroupStatusRow {
  key: string;
  counts: Record<TaskStatus, number>;
  total: number;
}

function toRows<K extends string>(
  clients: Client[],
  keyOf: (c: Client) => K,
  order: readonly K[],
): GroupStatusRow[] {
  const map = new Map<string, GroupStatusRow>();
  for (const k of order) map.set(k, { key: k, counts: emptyStatusCounts(), total: 0 });
  for (const c of clients) {
    const k = keyOf(c);
    if (!map.has(k)) map.set(k, { key: k, counts: emptyStatusCounts(), total: 0 });
    const row = map.get(k)!;
    for (const t of c.tasks) {
      row.counts[t.status]++;
      row.total++;
    }
  }
  return Array.from(map.values()).filter((r) => r.total > 0 || order.includes(r.key as K));
}

export function statusPerOffice(clients: Client[], offices: readonly Office[]): GroupStatusRow[] {
  return toRows(clients, (c) => c.office, offices);
}

export function statusPerPerson(clients: Client[]): GroupStatusRow[] {
  const names = Array.from(new Set(clients.map((c) => c.manager))).sort();
  return toRows(clients, (c) => c.manager, names);
}

export function statusTotal(counts: Record<TaskStatus, number>): number {
  return TASK_STATUSES.reduce((sum, s) => sum + counts[s], 0);
}
