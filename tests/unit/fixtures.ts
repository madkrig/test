import type {
  Authorization,
  BankConfirmationSubtask,
  BankMethodVersion,
  BankPopulationItem,
  BankPopulationVersion,
  BankResponse,
  BankTask,
  User,
} from '@/domain/bank-confirmations';

/** Syntetiske testdata – Nordhavn Teknik A/S, revision 2026. */
export const sofie: User = { id: 'u-sofie', name: 'Sofie Lund', role: 'AUDITOR' };
export const martin: User = { id: 'u-martin', name: 'Martin Friis', role: 'AUDITOR' };
export const jonas: User = { id: 'u-jonas', name: 'Jonas Mikkelsen', role: 'KERNE' };
export const amalie: User = { id: 'u-amalie', name: 'Amalie Sørensen', role: 'KERNE' };

export const subtask: BankConfirmationSubtask = {
  id: 'st-nordhavn-2026',
  engagementId: 'eng-nordhavn-2026',
  procedureType: 'BANK_CONFIRMATIONS',
  periodEnd: '2026-12-31',
  activationSource: 'AUDITFLOW',
  status: 'AWAITING_AUDITOR',
  active: true,
  nextAction: 'Verificér bankpopulation',
  nextOwner: 'Sofie Lund',
};

export function item(bankId: string, bankName: string, overrides: Partial<BankPopulationItem> = {}): BankPopulationItem {
  return {
    id: `pi-${bankId}`,
    bankId,
    bankName,
    relationType: 'Konto',
    change: 'UNCHANGED',
    sources: ['PRIOR_YEAR'],
    priorYearRelation: true,
    customerConfirmed: true,
    ...overrides,
  };
}

export function population(overrides: Partial<BankPopulationVersion> = {}): BankPopulationVersion {
  return {
    id: 'pv-1',
    subtaskId: subtask.id,
    version: 1,
    kind: 'FULL',
    status: 'SUBMITTED',
    items: [
      item('danske', 'Danske Bank', { sources: ['PRIOR_YEAR', 'R75'] }),
      item('sydbank', 'Sydbank', { change: 'ADDED', sources: ['ERP'], priorYearRelation: false }),
      item('jyske', 'Jyske Bank'),
    ],
    ...overrides,
  };
}

export function method(bankId: string, overrides: Partial<BankMethodVersion> = {}): BankMethodVersion {
  return {
    id: `m-${bankId}-1`,
    bankId,
    version: 1,
    channel: 'UPLOAD_PORTAL',
    urlOrChannel: `https://${bankId}.example/revisor`,
    requiredFields: ['CVR', 'Statusdato'],
    authorizationRequirement: 'GENERAL',
    expectedResponseWorkdays: 10,
    reminderMethod: 'Portalbesked',
    escalationContact: 'erhverv@example',
    validFrom: '2026-01-01',
    status: 'ACTIVE',
    owner: 'Mia Kragh',
    changeReason: 'Første version',
    newOrChanged: false,
    ...overrides,
  };
}

export const methods: BankMethodVersion[] = [
  method('danske', { id: 'm-danske-3', version: 3, channel: 'EMAIL' }),
  method('danske', { id: 'm-danske-2', version: 2, channel: 'EMAIL', status: 'RETIRED' }),
  method('sydbank', { id: 'm-sydbank-2', version: 2 }),
  method('jyske', { id: 'm-jyske-1', authorizationRequirement: 'BANK_SPECIFIC' }),
];

export function task(overrides: Partial<BankTask> = {}): BankTask {
  return {
    id: 'bt-sydbank',
    subtaskId: subtask.id,
    engagementId: subtask.engagementId,
    customerId: 'cust-nordhavn',
    bankId: 'sydbank',
    populationItemId: 'pi-sydbank',
    status: 'AWAITING_KERNE',
    methodVersionId: 'm-sydbank-2',
    sendDate: '2026-12-03',
    reminderCount: 0,
    administrativeCheckPassed: false,
    fourEyesCompleted: false,
    changedAfterApproval: false,
    openProfessionalDecision: false,
    flags: {
      blocked: false,
      deadlineExceeded: false,
      missingAuthorization: false,
      exception: false,
      professionalActionRequired: false,
      fourEyesRequired: false,
    },
    nextAction: 'Send anmodning',
    nextOwner: 'Kerne',
    ...overrides,
  };
}

export function authorization(overrides: Partial<Authorization> = {}): Authorization {
  return {
    id: 'aut-014',
    customerId: 'cust-nordhavn',
    signer: 'Peter Krogh',
    validFrom: '2026-11-01',
    validTo: '2027-03-31',
    coveredBankTaskIds: ['bt-sydbank', 'bt-danske'],
    status: 'VALID',
    atypical: false,
    ...overrides,
  };
}

export function response(overrides: Partial<BankResponse> = {}): BankResponse {
  return {
    id: 'resp-1',
    bankTaskId: 'bt-sydbank',
    receivedAt: '2027-01-08T11:02:00+01:00',
    channel: 'UPLOAD_PORTAL',
    originalFileName: 'Sydbank_Nordhavn_2026.pdf',
    administrativeCheckStatus: 'PASSED',
    deviations: [],
    sharePointDocumentId: 'SP-77812',
    sharePointUrl: 'https://sharepoint.example/SP-77812',
    integrityHash: 'sha256:9f2c',
    ...overrides,
  };
}
