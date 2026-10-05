import type { BankTask } from './entities';
import type { SubtaskStatus } from './statuses';

/** Grundlaget for subopgavens samlede status (det revisoren ser i AuditFlow). */
export interface SubtaskStatusInput {
  current: SubtaskStatus;
  tasks: readonly BankTask[];
  /** En populationsversion (fuld eller delta) afventer revisors godkendelse. */
  populationAwaitingApproval: boolean;
  openDecisions: number;
  conclusionRecorded: boolean;
}

/** En bankopgave er klar til revisors review, når den har en endelig operationel status. */
export function isReviewReady(task: BankTask): boolean {
  if (task.status === 'COMPLETED') return true;
  if (task.status === 'RECEIVED') return task.administrativeCheckPassed;
  if (task.status !== 'AWAITING_KERNE' || task.openProfessionalDecision || !task.sentAt) return false;
  // Efter faglig beslutning: enten kontrolleret svar (undtagelse behandlet) eller alternativ håndtering uden svar.
  return task.responseId ? task.administrativeCheckPassed : true;
}

/**
 * Afleder subopgavens hovedstatus fra bankopgaverne. Rækkefølgen afspejler,
 * hvem der skal handle først: revisor › bank › administrativ kontrol › Kerne.
 */
export function deriveSubtaskStatus(input: SubtaskStatusInput): SubtaskStatus {
  const { current, tasks } = input;
  if (current === 'COMPLETED') return 'COMPLETED';
  if (input.populationAwaitingApproval || input.openDecisions > 0) return 'AWAITING_AUDITOR';
  if (tasks.length === 0) return 'INITIATED_KERNE';
  if (tasks.some((t) => t.status === 'AWAITING_BANK')) return 'AWAITING_BANK';
  if (tasks.every(isReviewReady)) return input.conclusionRecorded ? 'AWAITING_KERNE' : 'AWAITING_AUDITOR';
  if (tasks.some((t) => t.status === 'RECEIVED') && tasks.every((t) => t.status !== 'AWAITING_KERNE' || isReviewReady(t))) {
    return 'RECEIVED';
  }
  return 'AWAITING_KERNE';
}

export interface SubtaskSummary {
  banks: number;
  sent: number;
  received: number;
  exceptions: number;
  awaitingBank: number;
}

export function summarizeTasks(tasks: readonly BankTask[]): SubtaskSummary {
  return {
    banks: tasks.length,
    sent: tasks.filter((t) => !!t.sentAt).length,
    received: tasks.filter((t) => !!t.responseId).length,
    exceptions: tasks.filter((t) => t.flags.exception || t.openProfessionalDecision).length,
    awaitingBank: tasks.filter((t) => t.status === 'AWAITING_BANK').length,
  };
}
