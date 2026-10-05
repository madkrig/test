import type { NonWorkdayPolicy } from './calendar';

/**
 * Konfigurerbare regler (brief afsnit 23). Værdierne er dokumenterede defaults,
 * ikke ufravigelige regler – se docs/antagelser.md.
 */
export interface BankConfirmationConfig {
  timeline: {
    activationMonthsBefore: number;        // T-2 måneder
    populationDeadlineWeeksBefore: number; // T-6 uger
    authorizationDeadlineWeeksBefore: number; // T-5 uger
    sendWeeksBefore: number;               // T-4 uger
    escalationWorkdaysBeforeDeadline: number; // T-10 arbejdsdage før faglig deadline
    nonWorkdayPolicy: NonWorkdayPolicy;
  };
  reminders: { maxStandardReminders: number };
  completenessControl: {
    statementTypes: readonly string[];
    /** Hvor mange måneder frem fra kørselsdatoen statusdatoer medtages. */
    lookaheadMonths: number;
  };
  fourEyes: {
    manualEmail: boolean;
    newOrChangedMethod: boolean;
    changeAfterApprovalAffectingSend: boolean;
    uncertainAuthorization: boolean;
  };
  bankMethods: { reviewIntervalMonths: number };
  bulkApproval: { allowedRoles: readonly string[] };
  populationSources: readonly string[];
  sharePoint: { folderTemplate: string };
}

export const DEFAULT_CONFIG: BankConfirmationConfig = {
  timeline: {
    activationMonthsBefore: 2,
    populationDeadlineWeeksBefore: 6,
    authorizationDeadlineWeeksBefore: 5,
    sendWeeksBefore: 4,
    escalationWorkdaysBeforeDeadline: 10,
    nonWorkdayPolicy: 'previous',
  },
  reminders: { maxStandardReminders: 2 },
  completenessControl: {
    statementTypes: ['REVISION', 'UDVIDET_GENNEMGANG'],
    lookaheadMonths: 3,
  },
  fourEyes: {
    manualEmail: true,
    newOrChangedMethod: true,
    changeAfterApprovalAffectingSend: true,
    uncertainAuthorization: true,
  },
  bankMethods: { reviewIntervalMonths: 12 },
  bulkApproval: { allowedRoles: ['AUDITOR'] },
  populationSources: ['PRIOR_YEAR', 'R75', 'ERP', 'CUSTOMER', 'AUDITOR'],
  sharePoint: { folderTemplate: '/Kunder/{customerId}/{engagementId}/Bankbekræftelser' },
};
