import { ERKLAERINGER, OFFICES, REGIONS, TASK_TEMPLATES } from "./types";
import type { Client, Role, TaskItem, TaskStatus } from "./types";

// Deterministic PRNG so the demo dataset is stable across reloads.
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20260819);

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}

const MANAGERS = [
  "Mette Holm",
  "Jonas Bruun",
  "Sofie Kragh",
  "Anders Dahl",
  "Line Vestergaard",
  "Peter Skov",
  "Cecilie Bang",
  "Thomas Ryg",
];

const NAME_PARTS_A = [
  "Nord",
  "Vest",
  "Øst",
  "Dansk",
  "Aarhus",
  "Vejle",
  "Bilka",
  "Herlev",
  "Cedra",
  "Kolding",
  "Skov",
  "Hav",
  "Bakke",
  "Strand",
  "Metro",
  "Dansk Byg",
];

const NAME_PARTS_B = [
  "Byg",
  "Handel",
  "Consult",
  "Logistik",
  "Ejendomme",
  "Industri",
  "Tekstil",
  "Møbler",
  "Transport",
  "Service",
  "Retail",
  "Ventures",
  "Group",
  "Holding",
];

const SUFFIXES = ["A/S", "ApS", "I/S"];

function statusWeighted(): TaskStatus {
  // Weighted so most tasks are done and only a small share are critical —
  // with ~20 tasks per client this still yields a realistic spread of
  // overall client statuses (a single critical task flags the client).
  const r = rand();
  if (r < 0.62) return "Udført";
  if (r < 0.84) return "Ej udført";
  if (r < 0.98) return "Action";
  return "Kritisk";
}

function randomPeriodEndDate(): string {
  // Skew towards Dec/April year-ends, spread 2025-2027, matching a Danish
  // audit book's typical balance-date clustering.
  const years = [2025, 2026, 2027];
  const year = pick(years);
  const monthWeights: [number, number][] = [
    [12, 34],
    [4, 10],
    [6, 8],
    [3, 6],
    [9, 6],
    [1, 4],
    [2, 4],
    [5, 4],
    [7, 4],
    [8, 4],
    [10, 4],
    [11, 4],
  ];
  const total = monthWeights.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  let month = 12;
  for (const [m, w] of monthWeights) {
    if (r < w) {
      month = m;
      break;
    }
    r -= w;
  }
  const day = 28 + Math.floor(rand() * 3);
  const lastDay = new Date(year, month, 0).getDate();
  const d = Math.min(day, lastDay);
  return `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function makeTasks(): TaskItem[] {
  return TASK_TEMPLATES.map((t, i) => ({
    id: `${t.phase}-${i}-${Math.floor(rand() * 1e9)}`,
    phase: t.phase,
    name: t.name,
    status: statusWeighted(),
  }));
}

function randomRole(): Role {
  const r = rand();
  if (r < 0.55) return "Manager";
  if (r < 0.8) return "Partner";
  return "Assistant";
}

function makeCvr(): string {
  let s = "";
  for (let i = 0; i < 8; i++) s += Math.floor(rand() * 10);
  return s;
}

export function generateClients(count: number): Client[] {
  const clients: Client[] = [];
  const usedNames = new Set<string>();
  for (let i = 0; i < count; i++) {
    let name = `${pick(NAME_PARTS_A)} ${pick(NAME_PARTS_B)} ${pick(SUFFIXES)}`;
    while (usedNames.has(name)) {
      name = `${pick(NAME_PARTS_A)} ${pick(NAME_PARTS_B)} ${pick(SUFFIXES)}`;
    }
    usedNames.add(name);
    clients.push({
      id: `client-${i + 1}`,
      name,
      cvr: makeCvr(),
      office: pick(OFFICES),
      region: pick(REGIONS),
      erklaering: pick(ERKLAERINGER),
      iaInvolved: rand() < 0.22,
      manager: pick(MANAGERS),
      role: randomRole(),
      periodEndDate: randomPeriodEndDate(),
      tasks: makeTasks(),
    });
  }
  return clients;
}

export const SEED_CLIENTS = generateClients(180);
