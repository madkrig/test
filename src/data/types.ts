export type Office = "Aarhus" | "Private East" | "Public" | "Aalborg" | "Kolding";

export type Region =
  | "Hovedstaden"
  | "Sjælland"
  | "Syddanmark"
  | "Midtjylland"
  | "Nordjylland";

export type Erklaering =
  | "Revision"
  | "Udvidet gennemgang"
  | "Review"
  | "Assistance";

export type TaskStatus = "Kritisk" | "Action" | "Ej udført" | "Udført";

export type TaskPhase = "Stamdata" | "Planlægning" | "Løbende" | "Afslutning";

export type Role = "Manager" | "Partner" | "Assistant";

export interface TaskItem {
  id: string;
  phase: TaskPhase;
  name: string;
  status: TaskStatus;
}

export interface Client {
  id: string;
  name: string;
  cvr: string;
  office: Office;
  region: Region;
  erklaering: Erklaering;
  iaInvolved: boolean;
  manager: string;
  role: Role;
  periodEndDate: string; // ISO date, yyyy-mm-dd
  tasks: TaskItem[];
}

export const TASK_STATUSES: TaskStatus[] = [
  "Kritisk",
  "Action",
  "Ej udført",
  "Udført",
];

export const STATUS_COLORS: Record<TaskStatus, string> = {
  Kritisk: "#d64545",
  Action: "#e08a2c",
  "Ej udført": "#7fb4d8",
  Udført: "#1c5f8b",
};

export const OFFICES: Office[] = [
  "Aarhus",
  "Private East",
  "Public",
  "Aalborg",
  "Kolding",
];

export const REGIONS: Region[] = [
  "Hovedstaden",
  "Sjælland",
  "Syddanmark",
  "Midtjylland",
  "Nordjylland",
];

export const ROLES: Role[] = ["Manager", "Partner", "Assistant"];

export const ERKLAERINGER: Erklaering[] = [
  "Revision",
  "Udvidet gennemgang",
  "Review",
  "Assistance",
];

export const TASK_TEMPLATES: { phase: TaskPhase; name: string }[] = [
  { phase: "Stamdata", name: "WBS oprettet" },
  { phase: "Stamdata", name: "Medarbejder på sagen" },
  { phase: "Stamdata", name: "Revisionsfil fundet" },
  { phase: "Stamdata", name: "Korrekt revisionsfil angivet" },
  { phase: "Stamdata", name: "Adgang til skat.dk (erhverv)" },
  { phase: "Stamdata", name: "Adgang til eIndkomst2" },
  { phase: "Stamdata", name: "Client Retention" },
  { phase: "Planlægning", name: "Planlagt i Levvia" },
  { phase: "Planlægning", name: "Planlagt i EMS" },
  { phase: "Planlægning", name: "Engagementsopgørelse bestilt" },
  { phase: "Planlægning", name: "Payroll Analytics bestilt" },
  { phase: "Planlægning", name: "Skattedokumenter for perioden" },
  { phase: "Planlægning", name: "Advokatbrev bestilt" },
  { phase: "Planlægning", name: "Arbejdsplan oprettet" },
  { phase: "Planlægning", name: "Spotlight upload booket" },
  { phase: "Løbende", name: "Forretningsgange dokumenteret" },
  { phase: "Løbende", name: "Saldomeddelelser bestilt" },
  { phase: "Afslutning", name: "Åbne review notes" },
  { phase: "Afslutning", name: "Regnskab underskrevet" },
  { phase: "Afslutning", name: "Revisionspåtegning afgivet" },
  { phase: "Afslutning", name: "Arkivering gennemført" },
];
