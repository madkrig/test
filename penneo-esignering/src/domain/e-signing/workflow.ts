import type { WorkflowDefinition, WorkflowProgress } from '@/lib/workflow/types';
import type { SigningStatus } from './statuses';

/**
 * E-signeringsforløbet som trin og ruter. Ruterne svarer til det, systemet
 * faktisk gør: blokeringer i stamdata, Penneos webhooks og arkivering med
 * genforsøg. Bruges til diagrammet på "Forløb" og til status i Opgaver.
 */
export const E_SIGNING_WORKFLOW: WorkflowDefinition = {
  key: 'e-signing',
  title: 'E-signering via Penneo',
  start: 'intake',
  steps: [
    {
      key: 'intake',
      title: 'Ydelse og kunde',
      kind: 'form',
      who: 'Ansvarlig revisor',
      details: ['Startes fra Markedspladsen', 'Kun egne kunder'],
      badge: 'start',
      routes: [{ outcome: 'valgt', to: 'master_data_check' }],
    },
    {
      key: 'master_data_check',
      title: 'Kontrol af stamdata',
      kind: 'check',
      routes: [
        { outcome: 'komplet', to: 'document' },
        { outcome: 'mangler', to: 'intake', note: 'Underskriver uden e-mail eller rolle mangler – ret stamdata' },
      ],
    },
    {
      key: 'document',
      title: 'Dokument og besked',
      kind: 'form',
      who: 'Ansvarlig revisor',
      details: ['PDF, højst 10 MB'],
      routes: [{ outcome: 'sendt', to: 'penneo_signing', note: 'Opretter og sender sagen i Penneo' }],
    },
    {
      key: 'penneo_signing',
      title: 'Underskrift i Penneo',
      kind: 'external',
      who: 'Kundens underskrivere',
      details: ['Direktion og/eller bestyrelse fra stamdata', 'Penneo sender e-mail og påmindelser'],
      routes: [
        { outcome: 'underskrevet', to: 'archive', note: 'Webhook casefile.completed' },
        { outcome: 'afvist', to: 'notify_rejected', note: 'Webhook casefile.rejected' },
      ],
    },
    {
      key: 'archive',
      title: 'Arkivér i SharePoint',
      kind: 'integration',
      routes: [
        { outcome: 'arkiveret', to: 'notify_signed' },
        { outcome: 'fejlet', to: 'archive_failed' },
      ],
    },
    {
      key: 'archive_failed',
      title: 'Arkivering fejlede',
      kind: 'task',
      who: 'Ansvarlig revisor',
      details: ['Dokumentet er underskrevet', 'Prøv igen fra Opgaver'],
      badge: 'exception',
      routes: [{ outcome: 'prøv igen', to: 'archive' }],
    },
    {
      key: 'notify_signed',
      title: 'Giv revisor besked',
      kind: 'notify',
      routes: [{ outcome: 'færdig', to: 'completed' }],
    },
    {
      key: 'notify_rejected',
      title: 'Besked om afvisning',
      kind: 'notify',
      routes: [{ outcome: 'færdig', to: 'rejected' }],
    },
  ],
  ends: [
    { key: 'completed', title: 'Fuldført', tone: 'ok' },
    { key: 'rejected', title: 'Afvist', tone: 'failed' },
  ],
};

const SENT = ['intake', 'master_data_check', 'document', 'penneo_signing'];

/** Hvor et konkret forløb står i diagrammet, ud fra status og arkiveringsflag. */
export function workflowProgress(status: SigningStatus, archiveFailed: boolean): WorkflowProgress {
  switch (status) {
    case 'AWAITING_SIGNATURES':
      return { current: 'penneo_signing', path: SENT };
    case 'SIGNED':
      return archiveFailed
        ? { current: 'archive_failed', path: [...SENT, 'archive', 'archive_failed'] }
        : { current: 'archive', path: [...SENT, 'archive'] };
    case 'COMPLETED':
      return { current: 'completed', path: [...SENT, 'archive', 'notify_signed', 'completed'] };
    case 'REJECTED':
      return { current: 'rejected', path: [...SENT, 'notify_rejected', 'rejected'] };
  }
}
