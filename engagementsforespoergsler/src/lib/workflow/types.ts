/**
 * Et forløb beskrevet som data: trin, ruter (udfald → næste trin) og
 * sluttilstande. Samme definition tegner diagrammet og trin-tabellen.
 */
export type StepKind = 'form' | 'check' | 'task' | 'decision' | 'external' | 'integration' | 'notify';

export const KIND_LABELS: Record<StepKind, string> = {
  form: 'Formular',
  check: 'Automatisk kontrol',
  task: 'Opgave',
  decision: 'Beslutning',
  external: 'Ekstern tjeneste',
  integration: 'Integration',
  notify: 'Besked',
};

/** Trin, som systemet udfører uden en person (tegnes med grå flade). */
export const AUTOMATED_KINDS: ReadonlySet<StepKind> = new Set(['check', 'decision', 'notify']);

export interface WorkflowRoute {
  /** Kort udfald, vist på pilen og i tabellen, fx "underskrevet". */
  outcome: string;
  /** Nøglen på det næste trin eller sluttilstand. */
  to: string;
  /** Valgfri forklaring i tabellen, fx hvilken webhook der udløser ruten. */
  note?: string;
}

export interface WorkflowStep {
  key: string;
  title: string;
  kind: StepKind;
  /** Hvem udfører trinnet. Uden "who" vises trinets type som undertitel. */
  who?: string;
  /** Ekstra linjer i tabellens "Hvem"-kolonne: frister, påmindelser, adskillelse af funktioner. */
  details?: string[];
  badge?: 'start' | 'exception';
  routes: WorkflowRoute[];
  /** Valgfrit layout-hint: række i diagrammet (0 = hovedsporet). Normalt beregnes rækken. */
  row?: number;
}

export interface WorkflowEnd {
  key: string;
  title: string;
  tone: 'ok' | 'failed';
}

export interface WorkflowDefinition {
  key: string;
  title: string;
  start: string;
  steps: WorkflowStep[];
  ends: WorkflowEnd[];
}

/** Hvor et konkret forløb er: det aktuelle trin og vejen dertil (i rækkefølge, inkl. det aktuelle). */
export interface WorkflowProgress {
  current: string;
  path: string[];
}
