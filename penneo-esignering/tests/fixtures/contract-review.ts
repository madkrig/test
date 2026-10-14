import type { WorkflowDefinition } from '@/lib/workflow/types';

/**
 * Genskabelse af referencediagrammet ("Contract review") ud fra skærmbilledet,
 * så testen kan vise, at layoutmotoren tegner samme struktur.
 */
export const CONTRACT_REVIEW: WorkflowDefinition = {
  key: 'contract-review',
  title: 'Contract review',
  start: 'intake',
  steps: [
    { key: 'intake', title: 'Contract details', kind: 'form', who: 'Whoever starts the case', badge: 'start', routes: [{ outcome: 'submitted', to: 'checks' }] },
    { key: 'checks', title: 'Policy checks', kind: 'check', routes: [{ outcome: 'passed', to: 'legal_review' }, { outcome: 'failed', to: 'exceptions' }] },
    { key: 'exceptions', title: 'Exceptions', kind: 'task', who: 'Legal', badge: 'exception', routes: [{ outcome: 'accepted', to: 'legal_review' }, { outcome: 'returned', to: 'intake' }] },
    { key: 'legal_review', title: 'Legal review', kind: 'task', who: 'Legal', routes: [{ outcome: 'approved', to: 'value_check' }, { outcome: 'returned', to: 'intake' }, { outcome: 'rejected', to: 'notify_rejected' }] },
    { key: 'value_check', title: 'Needs the finance manager?', kind: 'decision', routes: [{ outcome: 'yes', to: 'finance_approval' }, { outcome: 'no', to: 'notify_approved' }] },
    { key: 'finance_approval', title: 'Finance approval', kind: 'task', who: 'Finance manager', routes: [{ outcome: 'approved', to: 'notify_approved' }, { outcome: 'rejected', to: 'notify_rejected' }] },
    { key: 'notify_approved', title: 'Tell the requester it is approved', kind: 'notify', routes: [{ outcome: 'done', to: 'register' }] },
    { key: 'register', title: 'File it in the contract register', kind: 'integration', routes: [{ outcome: 'done', to: 'approved' }] },
    { key: 'notify_rejected', title: 'Tell the requester it is rejected', kind: 'notify', routes: [{ outcome: 'done', to: 'rejected' }] },
  ],
  ends: [
    { key: 'approved', title: 'Approved', tone: 'ok' },
    { key: 'rejected', title: 'Rejected', tone: 'failed' },
  ],
};
