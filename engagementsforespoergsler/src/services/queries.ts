import {
  AUTH_CHECK_LABELS, AUTH_STATUS_LABELS, authUsable, BALANCE_CATEGORIES, can, canCloseDeviation, caseTimeline, CASE_STATUS_LABELS, CATEGORY_LABELS, CHANNEL_LABELS,
  DEVIATION_DECISION_LABELS, DEVIATION_TYPE_LABELS, ENGAGEMENT_TYPE_LABELS, formatDanish, INQUIRY_STATUS_LABELS, NOTE_CATEGORIES, PARAM_LABELS,
  reconcile, REJECTION_REASON_LABELS, ROLE_LABELS, RULE_CATALOG, RULE_TYPE_LABELS, SEVERITY_LABELS, SOURCE_LABELS, trackingSteps, workdaysBetween,
  type AuthStatus, type BankListSource, type CaseStatus, type Channel, type InquiryStatus, type IsoDate, type LineCategory, type Role, type Severity,
} from '@/domain/ef';
import { authEvaluation, managementAt } from './auth-check';
import { bankListWarnings, conclusionDraft, populationCheck } from './cases';
import { today } from './clock';
import { canActorSeeCase, CENTRAL_MAILBOX, isDelegate, paramsAt, type Actor } from './context';
import type { Db } from './db';
import { DomainError } from './errors';
import { inquiryChecks, sendDueDate } from './readiness';
import { extractionChecks, type InboundMessage } from './responses';
import { REPLY_VARIANTS, demoEnabled } from './simulator';
import { OPEN_TASK } from './work';

/**
 * Læsemodeller til skærmene (kap. 8). Server-komponenter kalder dem direkte;
 * API'et eksponerer de samme modeller til agenter og integrationer.
 */

export type Tone = 'ok' | 'waiting' | 'failed' | 'neutral' | 'warn';
export type DeadlineTone = 'overdue' | 'soon' | 'ok';

export const maskAccount = (ref: string | null) => (ref ? `••••${ref.replace(/\D/g, '').slice(-4)}` : '–');
const shortName = (name: string | undefined) => {
  if (!name) return '–';
  const parts = name.split(' ');
  return parts.length > 1 ? `${parts[0]![0]}. ${parts.slice(1).join(' ')}` : name;
};

export function deadlineTone(deadline: IsoDate | null | undefined, date: IsoDate): DeadlineTone | null {
  if (!deadline) return null;
  if (deadline < date) return 'overdue';
  return workdaysBetween(date, deadline) <= 3 ? 'soon' : 'ok';
}

async function usersById(db: Db) {
  return new Map((await db.user.findMany()).map((u) => [u.id, u]));
}

/** Sager, brugeren må se (10.4). Migrerede historiske sager vises kun som "sidste år". */
export async function visibleCases(db: Db, actor: Actor, opts: { includeHistory?: boolean } = {}) {
  const cases = await db.case.findMany({ orderBy: [{ balanceDate: 'asc' }, { createdAt: 'asc' }] });
  const out = [];
  for (const c of cases) {
    if (!opts.includeHistory && c.id.startsWith('sag-hist')) continue;
    if (await canActorSeeCase(db, actor, c)) out.push(c);
  }
  return out;
}

export async function shellInfo(db: Db, actor: Actor) {
  const [date, unread, lastRun, users] = await Promise.all([
    today(db),
    db.notification.count({ where: { recipientId: actor.id, readAt: null } }),
    db.setting.findUnique({ where: { key: 'lastDailyRun' } }),
    db.user.findMany({ orderBy: { id: 'asc' } }),
  ]);
  return {
    actor: { ...actor, roleLabel: ROLE_LABELS[actor.role] },
    today: date,
    unread,
    lastDailyRun: lastRun?.value ?? null,
    demo: demoEnabled(),
    users: users.map((u) => ({ id: u.id, name: u.name, role: u.role as Role, roleLabel: ROLE_LABELS[u.role as Role], department: u.department })),
    can: {
      queue: can(actor.role, 'SEE_QUEUE'),
      cases: can(actor.role, 'SEE_CASES'),
      kpi: can(actor.role, 'SEE_KPI'),
      register: actor.role === 'KM' || actor.role === 'KL' || actor.role === 'PE',
      rules: actor.role === 'PE' || actor.role === 'KL',
      runJobs: can(actor.role, 'RUN_JOBS'),
    },
  };
}

// ---------------------------------------------------------------------------
// S01 Arbejdskø
// ---------------------------------------------------------------------------

export interface QueueRow {
  id: string;
  reference: string;
  caseId: string;
  customer: string;
  cvr: string;
  balanceDate: IsoDate;
  institute: string;
  instituteId: string;
  channel: string;
  channelLabel: string;
  status: InquiryStatus;
  statusLabel: string;
  tone: Tone;
  nextAction: string;
  deadline: IsoDate | null;
  deadlineTone: DeadlineTone | null;
  auditor: string;
  department: string;
  sendable: boolean;
  needsAction: boolean;
  responseId: string | null;
  bucket: 'KLAR' | 'FULDMAGT' | 'SVAR' | 'VERIFIKATION' | 'AFVIST' | 'OEVRIGE';
}

export interface QueueFilter {
  balanceDate?: string;
  instituteId?: string;
  view?: 'HANDLING' | 'ALLE';
  auditorId?: string;
  department?: string;
  q?: string;
  bucket?: QueueRow['bucket'] | 'OVERSKREDET';
}

export async function workQueue(db: Db, actor: Actor, filter: QueueFilter = {}) {
  const date = await today(db);
  const users = await usersById(db);
  const cases = (await visibleCases(db, actor)).filter((c) => c.status !== 'LAAST');
  const customers = new Map((await db.srcCustomer.findMany()).map((c) => [c.id, c]));
  const institutes = new Map((await db.institute.findMany()).map((i) => [i.id, i]));
  const inquiries = await db.inquiry.findMany({ where: { caseId: { in: cases.map((c) => c.id) }, status: { notIn: ['AFSLUTTET', 'ANNULLERET'] } } });
  const tasks = await db.task.findMany({ where: { status: { in: OPEN_TASK } } });
  const rows: QueueRow[] = [];

  for (const i of inquiries) {
    const c = cases.find((x) => x.id === i.caseId)!;
    const params = await paramsAt(db, c.rulesAsOf);
    const inst = institutes.get(i.instituteId)!;
    const own = tasks.filter((t) => t.inquiryId === i.id && t.role === 'KM').sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const response = await db.response.findFirst({ where: { inquiryId: i.id }, orderBy: { receivedAt: 'desc' } });
    let statusLabel = INQUIRY_STATUS_LABELS[i.status as InquiryStatus];
    let tone: Tone = 'neutral';
    let nextAction = own[0]?.title ?? '';
    let deadline: IsoDate | null = own[0]?.dueDate ?? null;
    let sendable = false;
    let needsAction = own.length > 0;
    let bucket: QueueRow['bucket'] = 'OEVRIGE';

    if (i.status === 'KLADDE' || i.status === 'KLAR') {
      const checks = await inquiryChecks(db, i, date, params);
      const authBlocked = checks.prerequisites.some((b) => b.ruleId === 'VR-04');
      if (i.status === 'KLAR' && checks.timingReached) {
        statusLabel = 'Klar til afsendelse'; tone = 'ok'; sendable = checks.blockers.length === 0; needsAction = true; bucket = 'KLAR';
        nextAction = 'Afsend i batch';
        deadline = await sendDueDate(db, i, params);
      } else if (i.status === 'KLAR') {
        statusLabel = `Planlagt ${formatDanish(i.plannedSendDate)}`; nextAction = `Afsendes ${formatDanish(i.plannedSendDate)} (TR-10)`; deadline = i.plannedSendDate;
      } else if (authBlocked) {
        statusLabel = 'Afventer fuldmagt'; tone = 'warn'; bucket = 'FULDMAGT';
        const f = await db.fuldmagt.findFirst({ where: { customerId: c.customerId, status: { in: ['UDKAST', 'SENDT_TIL_SIGNERING', 'UNDERSKREVET'] } }, orderBy: { createdAt: 'desc' } });
        const authTask = tasks.filter((t) => t.caseId === c.id && t.type.startsWith('OPG-05') && t.type !== 'OPG-05').sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
        nextAction = authTask?.title ?? (f?.status === 'SENDT_TIL_SIGNERING' ? 'Kunden underskriver i Penneo' : f?.status === 'UNDERSKREVET' ? 'Kontrollér underskrivere' : 'Indhent fuldmagt');
        if (f?.status === 'UNDERSKREVET') nextAction = 'Kontrollér underskrivere';
        deadline = authTask?.dueDate ?? caseTimeline(c.balanceDate, c.plannedSignOff, params).authDeadline;
        needsAction = !!authTask || f?.status === 'UNDERSKREVET' || f?.status === 'UDKAST';
      } else {
        statusLabel = 'Kladde'; tone = 'neutral';
        nextAction = checks.prerequisites.map((b) => `${b.ruleId}: ${b.message}`)[0] ?? 'Mangler forudsætninger';
      }
    } else if (i.status === 'SENDT' || i.status === 'RYKKET') {
      bucket = 'SVAR';
      const overdue = !!i.responseDeadline && i.responseDeadline < date;
      statusLabel = i.status === 'RYKKET' ? `Rykket (${i.reminderCount}.)` : overdue ? 'Frist overskredet' : 'Sendt';
      tone = i.status === 'RYKKET' || overdue ? 'failed' : 'neutral';
      if (i.escalatedAt) { nextAction = 'Eskaleret til revisor (ER-03)'; deadline = tasks.find((t) => t.inquiryId === i.id && t.type === 'OPG-11')?.dueDate ?? i.responseDeadline; }
      else if (!nextAction) { nextAction = `Afvent svar (SLA ${inst.responseWorkdays} hverdage)`; deadline = i.responseDeadline; }
    } else if (i.status === 'AFVIST') {
      statusLabel = 'Afvist af institut'; tone = 'failed'; bucket = 'AFVIST'; needsAction = true;
      if (!own.length) nextAction = `Ret: ${REJECTION_REASON_LABELS[i.rejectionReason as 'ANDET']?.toLowerCase() ?? 'afvisning'}`;
    } else if (i.status === 'SVAR_MODTAGET') {
      bucket = 'VERIFIKATION'; needsAction = true;
      if (response?.extractionApprovedAt) {
        const open = await db.deviation.count({ where: { inquiryId: i.id, status: { not: 'LUKKET' } } });
        statusLabel = 'Under afstemning'; tone = 'waiting';
        nextAction = `${open} ${open === 1 ? 'afvigelse' : 'afvigelser'} – send til revisor`;
        deadline = deadline ?? response.extractionApprovedAt.slice(0, 10);
      } else {
        statusLabel = 'Svar modtaget'; tone = 'ok';
        nextAction = 'Verificér udtræk';
      }
    } else if (i.status === 'AFVENTER_REVISOR' || i.status === 'UDEN_SVAR') {
      tone = 'waiting'; needsAction = false;
      nextAction = i.status === 'UDEN_SVAR' ? 'Revisor dokumenterer alternative handlinger' : 'Revisor vurderer afvigelser';
      deadline = tasks.filter((t) => t.inquiryId === i.id || t.caseId === c.id && t.type === 'OPG-10').map((t) => t.dueDate).sort()[0] ?? null;
    }
    const tone2 = deadlineTone(deadline, date);
    if (tone2 === 'overdue' && (i.status === 'SENDT' || i.status === 'RYKKET')) needsAction = true;
    rows.push({
      id: i.id, reference: i.reference, caseId: c.id, customer: customers.get(c.customerId)!.name, cvr: c.cvr, balanceDate: c.balanceDate, institute: inst.name, instituteId: inst.id,
      channel: i.channel, channelLabel: CHANNEL_LABELS[i.channel as Channel], status: i.status as InquiryStatus, statusLabel, tone, nextAction, deadline, deadlineTone: tone2,
      auditor: shortName(users.get(c.responsibleId ?? '')?.name), department: c.department, sendable, needsAction, responseId: response?.id ?? null, bucket,
    });
  }

  const unmatched = await db.response.count({ where: { matchStatus: 'UNMATCHED' } });
  const kpis = {
    klar: rows.filter((r) => r.bucket === 'KLAR').length,
    fuldmagt: rows.filter((r) => r.bucket === 'FULDMAGT').length,
    svar: rows.filter((r) => r.status === 'SENDT' || r.status === 'RYKKET').length,
    overskredet: rows.filter((r) => r.deadlineTone === 'overdue').length,
    verifikation: rows.filter((r) => r.bucket === 'VERIFIKATION').length + unmatched,
    afvist: rows.filter((r) => r.bucket === 'AFVIST').length,
  };
  const q = filter.q?.trim().toLowerCase();
  const filtered = rows
    .filter((r) => (filter.view ?? 'HANDLING') === 'ALLE' || r.needsAction)
    .filter((r) => !filter.balanceDate || r.balanceDate === filter.balanceDate)
    .filter((r) => !filter.instituteId || r.instituteId === filter.instituteId)
    .filter((r) => !filter.department || r.department === filter.department)
    .filter((r) => !filter.auditorId || cases.find((c) => c.id === r.caseId)?.responsibleId === filter.auditorId)
    .filter((r) => !filter.bucket || (filter.bucket === 'OVERSKREDET' ? r.deadlineTone === 'overdue' : r.bucket === filter.bucket))
    .filter((r) => !q || r.customer.toLowerCase().includes(q) || r.cvr.includes(q) || r.reference.toLowerCase().includes(q))
    .sort((a, b) => (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999') || a.reference.localeCompare(b.reference));

  // Kerneteamets opgaver uden en forespørgsel: banklister fra kunder, fuldmagter, uidentificerede svar.
  const caseIds = new Set(cases.map((c) => c.id));
  const other = tasks
    .filter((t) => t.role === 'KM' && !t.inquiryId && (t.caseId === null || caseIds.has(t.caseId)) && t.status !== 'VENTER')
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .map((t) => {
      const c = cases.find((x) => x.id === t.caseId);
      return {
        id: t.id, type: t.type, title: t.title, dueDate: t.dueDate, deadlineTone: deadlineTone(t.dueDate, date), assignee: users.get(t.assigneeId ?? '')?.name ?? 'Kerneteamet',
        customer: c ? customers.get(c.customerId)?.name ?? '' : '', link: t.caseId ? (t.type.startsWith('OPG-05') ? '/fuldmagter' : `/sager/${t.caseId}`) : '/svar/uidentificerede',
      };
    });

  return {
    today: date,
    kpis,
    rows: filtered,
    total: rows.length,
    other,
    filters: {
      balanceDates: [...new Set(rows.map((r) => r.balanceDate))].sort(),
      institutes: [...new Map(rows.map((r) => [r.instituteId, r.institute])).entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
      auditors: [...new Set(cases.map((c) => c.responsibleId).filter(Boolean))].map((id) => ({ id: id!, name: users.get(id!)?.name ?? id! })),
      departments: [...new Set(cases.map((c) => c.department))].sort(),
    },
  };
}

// ---------------------------------------------------------------------------
// S02 Mine sager
// ---------------------------------------------------------------------------

export async function caseList(db: Db, actor: Actor, filter: { scope?: 'MINE' | 'ALLE'; balanceDate?: string; status?: string; mineOnly?: boolean } = {}) {
  const date = await today(db);
  const users = await usersById(db);
  const cases = await visibleCases(db, actor);
  const customers = new Map((await db.srcCustomer.findMany()).map((c) => [c.id, c]));
  const tasks = await db.task.findMany({ where: { status: { in: OPEN_TASK }, type: { not: 'OPG-01' } } });
  const scope = filter.scope ?? (actor.role === 'OR' || actor.role === 'RM' ? 'MINE' : 'ALLE');
  const rows = [];
  for (const c of cases) {
    const team = (await db.srcTeamMember.findMany({ where: { engagementId: c.engagementId } })).map((t) => t.userId);
    const mine = c.responsibleId === actor.id || c.delegateId === actor.id || team.includes(actor.id) || c.coreUserId === actor.id;
    if (scope === 'MINE' && !mine) continue;
    if (filter.balanceDate && c.balanceDate !== filter.balanceDate) continue;
    if (filter.status && c.status !== filter.status) continue;
    const inquiries = await db.inquiry.findMany({ where: { caseId: c.id } });
    const params = await paramsAt(db, c.rulesAsOf);
    const auth = await authEvaluation(db, c.customerId, null, date, params);
    const myTasks = tasks.filter((t) => t.caseId === c.id && t.assigneeId === actor.id);
    const forMe = myTasks.length > 0 || c.nextOwner.includes(actor.name);
    if (filter.mineOnly && !forMe) continue;
    rows.push({
      id: c.id, customer: customers.get(c.customerId)!.name, cvr: c.cvr, type: ENGAGEMENT_TYPE_LABELS[c.engagementType] ?? c.engagementType, balanceDate: c.balanceDate,
      plannedSignOff: c.plannedSignOff, status: c.status, statusLabel: CASE_STATUS_LABELS[c.status as CaseStatus], nextAction: c.nextAction, nextOwner: c.nextOwner,
      responsible: users.get(c.responsibleId ?? '')?.name ?? '–', forMe, myTasks: myTasks.length,
      myNext: myTasks.sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0]?.title ?? null,
      tracking: trackingSteps({ status: c.status as CaseStatus, bankListApproved: !!c.bankListApprovedAt, authValid: authUsable(auth.result), inquiries: inquiries.map((i) => i.status as InquiryStatus) }),
    });
  }
  const params = await paramsAt(db, date);
  const optIn = actor.role === 'OR'
    ? (await db.srcEngagement.findMany({ where: { responsibleId: actor.id, optIn: false, status: 'AKTIV', type: { in: params.optInTypes } } }))
      .filter((e) => e.plannedSignOff >= date)
      .map((e) => ({ id: e.id, customer: customers.get(e.customerId)?.name ?? e.customerId, type: ENGAGEMENT_TYPE_LABELS[e.type] ?? e.type, balanceDate: e.periodEnd }))
    : [];
  return { today: date, scope, rows, optIn, balanceDates: [...new Set(cases.map((c) => c.balanceDate))].sort() };
}

// ---------------------------------------------------------------------------
// S03/S04 Sagsvisning og bankliste
// ---------------------------------------------------------------------------

export async function caseDetail(db: Db, actor: Actor, caseId: string) {
  const c = await db.case.findUnique({ where: { id: caseId } });
  if (!c || !(await canActorSeeCase(db, actor, c))) throw new DomainError('NOT_FOUND', 'Sagen findes ikke, eller du har ikke adgang til den.');
  const date = await today(db);
  const params = await paramsAt(db, c.rulesAsOf);
  const users = await usersById(db);
  const customer = await db.srcCustomer.findUniqueOrThrow({ where: { id: c.customerId } });
  const institutes = new Map((await db.institute.findMany()).map((i) => [i.id, i]));
  const lines = await db.bankListLine.findMany({ where: { caseId }, orderBy: { createdAt: 'asc' } });
  const inquiries = await db.inquiry.findMany({ where: { caseId }, orderBy: { createdAt: 'asc' } });
  const responses = await db.response.findMany({ where: { inquiryId: { in: inquiries.map((i) => i.id) } }, orderBy: { receivedAt: 'asc' } });
  const deviations = await db.deviation.findMany({ where: { caseId }, orderBy: { createdAt: 'asc' } });
  const fuldmagter = await db.fuldmagt.findMany({ where: { customerId: c.customerId }, orderBy: { createdAt: 'desc' } });
  const signers = await db.fuldmagtSigner.findMany({ where: { fuldmagtId: { in: fuldmagter.map((f) => f.id) } } });
  const general = await authEvaluation(db, c.customerId, null, date, params);
  const t = caseTimeline(c.balanceDate, c.plannedSignOff, params);
  const delegated = await isDelegate(db, actor, c);
  const isResponsible = actor.role === 'OR' && c.responsibleId === actor.id;
  const locked = !!c.lockedAt;
  const tasks = await db.task.findMany({ where: { caseId, status: { in: OPEN_TASK } }, orderBy: { dueDate: 'asc' } });
  const fName = (id: string | null) => fuldmagter.find((f) => f.id === id);

  const inquiryRows = [];
  for (const i of inquiries) {
    const inst = institutes.get(i.instituteId)!;
    const line = lines.find((l) => l.instituteId === i.instituteId);
    const dev = deviations.filter((d) => d.inquiryId === i.id);
    const openDev = dev.filter((d) => d.status !== 'LUKKET');
    const critical = openDev.filter((d) => d.severity === 'KRITISK').length;
    const response = responses.filter((r) => r.inquiryId === i.id).at(-1);
    const checks = i.status === 'KLADDE' || i.status === 'KLAR' ? await inquiryChecks(db, i, date, params) : null;
    const f = fName(i.fuldmagtId) ?? (checks?.auth.authId ? fName(checks.auth.authId) : undefined);
    let recon = 'Afventer svar';
    if (i.status === 'AFSLUTTET') recon = i.alternativeActions ? 'Alternative handlinger' : '✓ Afstemt';
    else if (critical) recon = `${critical} kritisk${critical === 1 ? '' : 'e'} afvigelse${critical === 1 ? '' : 'r'}`;
    else if (openDev.length) recon = `${openDev.length} afvigelse${openDev.length === 1 ? '' : 'r'}`;
    else if (response && !response.extractionApprovedAt && i.status === 'SVAR_MODTAGET') recon = 'Udtræk verificeres';
    else if (i.status === 'KLADDE' || i.status === 'KLAR') recon = '–';
    else if (i.status === 'ANNULLERET') recon = '–';
    inquiryRows.push({
      id: i.id, reference: i.reference, institute: inst.name, instituteId: inst.id, type: i.type, status: i.status, statusLabel: INQUIRY_STATUS_LABELS[i.status as InquiryStatus],
      channel: CHANNEL_LABELS[i.channel as Channel], plannedSendDate: i.plannedSendDate, sentAt: i.sentAt, responseDeadline: i.responseDeadline, expectedResponseDate: i.expectedResponseDate,
      reminderCount: i.reminderCount, escalatedAt: i.escalatedAt, rejection: i.rejectionReason ? REJECTION_REASON_LABELS[i.rejectionReason as 'ANDET'] : null, cancelReason: i.cancelReason,
      adhocReason: i.adhocReason, requestedBy: users.get(i.requestedById ?? '')?.name ?? null, approvedBy: users.get(i.approvedById ?? '')?.name ?? null, alternativeActions: i.alternativeActions,
      statementDate: i.statementDate,
      source: line ? (JSON.parse(line.sources) as BankListSource[]).map((s) => SOURCE_LABELS[s]).join(' + ') : 'Ad hoc',
      fuldmagt: f ? `${f.scope === 'GENEREL' ? 'Generel' : 'Bankspecifik'} · ${f.signedDate?.slice(0, 4) ?? AUTH_STATUS_LABELS[f.status as AuthStatus]}` : (checks ? AUTH_CHECK_LABELS[checks.auth.result] : '–'),
      recon, reconTone: (critical ? 'failed' : openDev.length ? 'warn' : i.status === 'AFSLUTTET' ? 'ok' : 'neutral') as Tone,
      blockers: checks?.blockers.map((b) => `${b.ruleId}: ${b.message}`) ?? [], warnings: checks?.warnings.map((b) => `${b.ruleId}: ${b.message}`) ?? [],
      responseId: response?.id ?? null,
    });
  }

  const bankList = lines.map((l) => {
    const inst = institutes.get(l.instituteId)!;
    const inquiry = inquiries.filter((i) => i.instituteId === l.instituteId && i.status !== 'ANNULLERET').at(-1);
    return {
      id: l.id, instituteId: l.instituteId, institute: inst.name, channel: CHANNEL_LABELS[inst.channel as Channel], authRequirement: inst.authRequirement,
      sources: (JSON.parse(l.sources) as BankListSource[]).map((s) => ({ key: s, label: SOURCE_LABELS[s] })), included: l.included, deselectReason: l.deselectReason,
      customerConfirmed: l.customerConfirmed, addedAfterApproval: l.addedAfterApproval, pendingApproval: l.addedAfterApproval && l.included && !inquiry,
      inquiryStatus: inquiry ? INQUIRY_STATUS_LABELS[inquiry.status as InquiryStatus] : null,
    };
  });

  const specificAuth = [];
  for (const l of lines.filter((x) => x.included && institutes.get(x.instituteId)?.authRequirement === 'BANKSPECIFIK')) {
    const inst = institutes.get(l.instituteId)!;
    const e = await authEvaluation(db, c.customerId, inst, date, params);
    specificAuth.push({ institute: inst.name, result: e.result, label: AUTH_CHECK_LABELS[e.result], reason: e.reason, ruleId: e.ruleId });
  }

  const noteLines = await db.responseLine.findMany({ where: { responseId: { in: responses.map((r) => r.id) }, category: { in: NOTE_CATEGORIES } } });
  const events = await db.event.findMany({ where: { caseId }, orderBy: { id: 'desc' }, take: 80 });
  const docs = await db.document.findMany({ where: { caseId }, orderBy: { createdAt: 'desc' } });
  const previous = await db.case.findFirst({ where: { customerId: c.customerId, balanceDate: { lt: c.balanceDate } }, orderBy: { balanceDate: 'desc' } });
  const previousLines = previous ? await db.bankListLine.findMany({ where: { caseId: previous.id } }) : [];
  const mgmt = await managementAt(db, c.customerId, date);
  const myTask = tasks.find((x) => x.assigneeId === actor.id && x.type !== 'OPG-01');
  const severityRank: Record<string, number> = { KRITISK: 0, VAESENTLIG: 1, FORKLARET: 2, UVAESENTLIG: 3 };
  const firstForAuditor = deviations.filter((d) => d.status !== 'LUKKET' && d.sentToAuditorAt).sort((a, b) => severityRank[a.severity]! - severityRank[b.severity]!)[0];
  const allResolved = inquiries.length > 0 && inquiries.every((i) => i.status === 'AFSLUTTET' || i.status === 'ANNULLERET');
  const resolvedCount = inquiries.filter((i) => i.status === 'AFSLUTTET' || i.status === 'ANNULLERET').length;

  return {
    today: date,
    case: {
      id: c.id, status: c.status, statusLabel: CASE_STATUS_LABELS[c.status as CaseStatus], balanceDate: c.balanceDate, plannedSignOff: c.plannedSignOff,
      type: ENGAGEMENT_TYPE_LABELS[c.engagementType] ?? c.engagementType, department: c.department, isNewCustomer: c.isNewCustomer, rulesAsOf: c.rulesAsOf,
      responsible: users.get(c.responsibleId ?? '')?.name ?? '–', responsibleId: c.responsibleId, core: users.get(c.coreUserId ?? '')?.name ?? '–',
      delegate: c.delegateId ? { id: c.delegateId, name: users.get(c.delegateId)?.name ?? c.delegateId, until: c.delegateUntil } : null,
      bankListApprovedAt: c.bankListApprovedAt, bankListApprovedBy: users.get(c.bankListApprovedById ?? '')?.name ?? null,
      conclusion: c.conclusion, concludedAt: c.concludedAt, concludedBy: users.get(c.concludedById ?? '')?.name ?? null, lockedAt: c.lockedAt, reopenReason: c.reopenReason,
      nextAction: c.nextAction, nextOwner: c.nextOwner,
    },
    customer: { id: customer.id, name: customer.name, cvr: customer.cvr, signingRule: customer.signingRule, cvrStatus: customer.cvrStatus, confidential: customer.confidential, contactEmail: customer.contactEmail },
    management: mgmt.map((m) => ({ ...m, roleLabel: m.role === 'DIREKTOER' ? 'Direktør' : m.role === 'FORMAND' ? 'Bestyrelsesformand' : 'Bestyrelsesmedlem' })),
    tracking: trackingSteps({ status: c.status as CaseStatus, bankListApproved: !!c.bankListApprovedAt, authValid: authUsable(general.result), inquiries: inquiries.map((i) => i.status as InquiryStatus) }),
    timeline: t,
    bankList,
    bankListWarnings: c.bankListApprovedAt ? [] : await bankListWarnings(db, caseId),
    auth: { result: general.result, label: AUTH_CHECK_LABELS[general.result], reason: general.reason, ruleId: general.ruleId, specific: specificAuth },
    fuldmagter: fuldmagter.map((f) => ({
      id: f.id, status: f.status, statusLabel: AUTH_STATUS_LABELS[f.status as AuthStatus], scope: f.scope, institute: f.instituteId ? institutes.get(f.instituteId)?.name ?? null : null,
      signedDate: f.signedDate, holderName: f.holderName, holderCvr: f.holderCvr, source: f.signingSource, penneoCaseId: f.penneoCaseId, documentRef: f.documentRef,
      invalidReason: f.invalidReason, sentForSigningAt: f.sentForSigningAt, signers: signers.filter((s) => s.fuldmagtId === f.id).map((s) => ({ name: s.name, role: s.role, signedAt: s.signedAt, mitid: s.mitidVerified })),
    })),
    inquiries: inquiryRows,
    population: await populationCheck(db, caseId),
    deviations: deviations.map((d) => ({ id: d.id, type: DEVIATION_TYPE_LABELS[d.type as 'SALDODIFFERENCE'], severity: d.severity, severityLabel: SEVERITY_LABELS[d.severity as Severity], status: d.status, description: d.description, decision: d.decision ? DEVIATION_DECISION_LABELS[d.decision as 'FORKLARET'] : null, justification: d.justification, sentToAuditorAt: d.sentToAuditorAt, inquiryId: d.inquiryId })),
    notes: noteLines.map((n) => ({ id: n.id, category: CATEGORY_LABELS[n.category as LineCategory], description: n.securityDescription ?? n.description, amountDkkOre: n.amountDkkOre, institute: institutes.get(inquiries.find((i) => responses.find((r) => r.id === n.responseId)?.inquiryId === i.id)?.instituteId ?? '')?.name ?? '' })),
    responses: responses.map((r) => ({ id: r.id, receivedAt: r.receivedAt, sender: r.sender, senderVerified: r.senderVerified, invalidReason: r.invalidReason, approved: !!r.extractionApprovedAt, inquiryId: r.inquiryId, institute: institutes.get(inquiries.find((i) => i.id === r.inquiryId)?.instituteId ?? '')?.name ?? '' })),
    history: events.map((e) => ({ id: e.id, at: e.at, action: e.action, objectType: e.objectType, actor: e.actorId === 'system' ? 'EF-service' : users.get(e.actorId)?.name ?? e.actorId, onBehalfOf: e.onBehalfOf ? users.get(e.onBehalfOf)?.name ?? e.onBehalfOf : null, source: e.source, reason: e.reason, after: e.after })),
    documents: docs.map((d) => ({ id: d.id, kind: d.kind, title: d.title, ref: d.ref, createdAt: d.createdAt })),
    tasks: tasks.map((x) => ({ id: x.id, type: x.type, title: x.title, dueDate: x.dueDate, deadlineTone: deadlineTone(x.dueDate, date), assignee: users.get(x.assigneeId ?? '')?.name ?? (x.assigneeId === 'system' ? 'EF-service' : 'Kerneteamet'), role: x.role, createdByRule: x.createdByRule, mine: x.assigneeId === actor.id })),
    lastYear: previous ? { balanceDate: previous.balanceDate, conclusion: previous.conclusion, institutes: previousLines.filter((l) => l.included).map((l) => institutes.get(l.instituteId)?.name ?? l.instituteId) } : null,
    nextForMe: myTask
      ? { title: myTask.title, dueDate: myTask.dueDate, type: myTask.type, inquiryId: myTask.inquiryId, deviationId: myTask.deviationId }
      : c.nextOwner.includes(actor.name)
        ? { title: c.nextAction, dueDate: null, type: null, inquiryId: null, deviationId: firstForAuditor?.id ?? null }
        : null,
    conclusion: {
      ready: c.status === 'KLAR_TIL_KONKLUSION', resolved: resolvedCount, total: inquiries.length, allResolved,
      draft: c.status === 'KLAR_TIL_KONKLUSION' ? await conclusionDraft(db, caseId) : null,
    },
    institutesForAdhoc: [...institutes.values()].filter((i) => i.active).map((i) => ({ id: i.id, name: i.name })).sort((a, b) => a.name.localeCompare(b.name)),
    team: (await db.srcTeamMember.findMany({ where: { engagementId: c.engagementId } })).map((m) => users.get(m.userId)).filter((u) => u && u.role === 'RM').map((u) => ({ id: u!.id, name: u!.name })),
    permissions: {
      approveBankList: !locked && (isResponsible || (actor.role === 'RM' && delegated)),
      editBankList: !locked && can(actor.role, 'EDIT_BANKLIST'),
      proposeBankList: !locked && actor.role === 'AGENT',
      delegate: !locked && isResponsible,
      requestAdhoc: !locked && can(actor.role, 'REQUEST_ADHOC'),
      approveAdhoc: !locked && isResponsible,
      conclude: !locked && isResponsible,
      reopen: locked && isResponsible,
      decide: !locked && isResponsible,
      documentAlternatives: !locked && (isResponsible || actor.role === 'RM'),
      kerneteam: !locked && (actor.role === 'KM' || actor.role === 'KL'),
      demo: demoEnabled() && !locked,
    },
    replyVariants: Object.entries(REPLY_VARIANTS).map(([key, label]) => ({ key, label })),
  };
}

// ---------------------------------------------------------------------------
// S05 Fuldmagter
// ---------------------------------------------------------------------------

export async function fuldmagtOverview(db: Db, actor: Actor) {
  const date = await today(db);
  const params = await paramsAt(db, date);
  const cases = (await visibleCases(db, actor)).filter((c) => c.status !== 'LAAST');
  const users = await usersById(db);
  const byCustomer = new Map<string, typeof cases>();
  for (const c of cases) byCustomer.set(c.customerId, [...(byCustomer.get(c.customerId) ?? []), c]);
  const rows = [];
  for (const [customerId, own] of byCustomer) {
    const customer = await db.srcCustomer.findUniqueOrThrow({ where: { id: customerId } });
    const e = await authEvaluation(db, customerId, null, date, params);
    const fuldmagter = await db.fuldmagt.findMany({ where: { customerId }, orderBy: { createdAt: 'desc' } });
    const active = fuldmagter.find((f) => f.scope === 'GENEREL' && ['UDKAST', 'SENDT_TIL_SIGNERING', 'UNDERSKREVET'].includes(f.status));
    const current = e.authId ? fuldmagter.find((f) => f.id === e.authId) : null;
    const signers = active ? await db.fuldmagtSigner.findMany({ where: { fuldmagtId: active.id } }) : [];
    const mgmt = await managementAt(db, customerId, date);
    const institutes = await db.institute.findMany({ where: { authRequirement: 'BANKSPECIFIK' } });
    const lines = await db.bankListLine.findMany({ where: { caseId: { in: own.map((c) => c.id) }, included: true, instituteId: { in: institutes.map((i) => i.id) } } });
    const specific = [];
    for (const l of lines) {
      const inst = institutes.find((i) => i.id === l.instituteId)!;
      const se = await authEvaluation(db, customerId, inst, date, params);
      const pendingSpecific = await db.fuldmagt.findFirst({ where: { customerId, scope: 'BANKSPECIFIK', instituteId: inst.id, status: { in: ['UDKAST', 'SENDT_TIL_SIGNERING', 'UNDERSKREVET'] } } });
      specific.push({ instituteId: inst.id, institute: inst.name, label: AUTH_CHECK_LABELS[se.result], result: se.result, reason: se.reason, pending: pendingSpecific ? { id: pendingSpecific.id, status: pendingSpecific.status, statusLabel: AUTH_STATUS_LABELS[pendingSpecific.status as AuthStatus] } : null });
    }
    rows.push({
      customerId, customer: customer.name, cvr: customer.cvr, signingRule: customer.signingRule, result: e.result, resultLabel: AUTH_CHECK_LABELS[e.result], ruleId: e.ruleId, reason: e.reason,
      current: current ? { id: current.id, signedDate: current.signedDate, holderName: current.holderName, source: current.signingSource } : null,
      active: active ? {
        id: active.id, status: active.status, statusLabel: AUTH_STATUS_LABELS[active.status as AuthStatus], scope: active.scope, sentForSigningAt: active.sentForSigningAt,
        daysSinceSent: active.sentForSigningAt ? Math.max(0, Math.round((Date.parse(date) - Date.parse(active.sentForSigningAt.slice(0, 10))) / 86400000)) : null,
        penneoCaseId: active.penneoCaseId, uploadedBy: users.get(active.uploadedById ?? '')?.name ?? null, uploadedById: active.uploadedById, source: active.signingSource,
        signers: signers.map((s) => ({ unitNumber: s.unitNumber, name: s.name, role: s.role, signedAt: s.signedAt })),
      } : null,
      management: mgmt,
      specific,
      cases: own.map((c) => ({ id: c.id, balanceDate: c.balanceDate })),
      authDeadline: own.map((c) => caseTimeline(c.balanceDate, c.plannedSignOff, params).authDeadline).sort()[0] ?? null,
      history: fuldmagter.length,
      needsAction: e.result !== 'GYLDIG' || specific.some((s) => !authUsable(s.result)),
    });
  }
  rows.sort((a, b) => Number(b.needsAction) - Number(a.needsAction) || (a.authDeadline ?? '').localeCompare(b.authDeadline ?? ''));
  const coverage = { total: rows.length, valid: rows.filter((r) => authUsable(r.result)).length };
  return { today: date, rows, coverage, canAct: actor.role === 'KM' || actor.role === 'KL', canVerify: actor.role === 'KM' || actor.role === 'KL', demo: demoEnabled(), actorId: actor.id };
}

// ---------------------------------------------------------------------------
// S06 Svar og afstemning
// ---------------------------------------------------------------------------

export async function responseDetail(db: Db, actor: Actor, responseId: string) {
  const r = await db.response.findUnique({ where: { id: responseId } });
  if (!r) throw new DomainError('NOT_FOUND', 'Svaret findes ikke.');
  const date = await today(db);
  const msg = JSON.parse(r.content) as InboundMessage;
  const lines = await db.responseLine.findMany({ where: { responseId }, orderBy: { sortOrder: 'asc' } });
  const base = {
    today: date,
    response: { id: r.id, receivedAt: r.receivedAt, channel: r.channel, sender: r.sender, senderVerified: r.senderVerified, subject: r.subject, statementDate: r.statementDate, documentRef: r.documentRef, matchStatus: r.matchStatus, invalidReason: r.invalidReason, approvedAt: r.extractionApprovedAt },
    document: { body: msg.body, attachment: msg.attachmentName, lines: msg.extracted?.lines ?? [], signingRights: msg.extracted?.signingRights ?? [] },
  };
  if (!r.inquiryId) return { ...base, inquiry: null, case: null, lines: [], recon: [], deviations: [], notes: [], signingRights: null, checks: null, tiles: null, permissions: { register: actor.role === 'KM' || actor.role === 'KL' } };
  const inquiry = await db.inquiry.findUniqueOrThrow({ where: { id: r.inquiryId } });
  const c = await db.case.findUniqueOrThrow({ where: { id: inquiry.caseId } });
  if (!(await canActorSeeCase(db, actor, c))) throw new DomainError('NOT_FOUND', 'Svaret findes ikke, eller du har ikke adgang til det.');
  const customer = await db.srcCustomer.findUniqueOrThrow({ where: { id: c.customerId } });
  const inst = await db.institute.findUniqueOrThrow({ where: { id: inquiry.instituteId } });
  const params = await paramsAt(db, c.rulesAsOf);
  const booked = await db.srcLedgerAccount.findMany({ where: { customerId: c.customerId, balanceDate: inquiry.statementDate, instituteId: inquiry.instituteId } });
  const materiality = await db.srcMateriality.findUnique({ where: { engagementId: c.engagementId } });
  const stored = await db.reconLine.findMany({ where: { inquiryId: inquiry.id } });
  const preview = reconcile(
    lines.map((l) => ({ id: l.id, category: l.category as LineCategory, accountRef: l.accountRef, description: l.description, amountDkkOre: l.amountDkkOre })),
    booked.map((b) => ({ id: b.id, accountRef: b.accountRef, name: b.name, balanceOre: b.balanceOre })),
    { toleranceOre: params.toleranceOre, trivialOre: materiality?.trivialThreshold ?? 0 },
  );
  const reconSource = r.extractionApprovedAt && stored.length ? stored : preview.recon;
  const recon = reconSource.map((x) => {
    const line = lines.find((l) => l.id === x.responseLineId);
    const acc = booked.find((b) => b.id === x.ledgerAccountId);
    return {
      responseLineId: x.responseLineId, category: line ? CATEGORY_LABELS[line.category as LineCategory] + (line.currency !== 'DKK' ? ` (${line.currency})` : '') : acc?.name ?? '',
      account: maskAccount(line?.accountRef ?? acc?.accountRef ?? null), bankOre: line?.amountDkkOre ?? null, bookedOre: x.bookedOre, differenceOre: x.differenceOre, matchStatus: x.matchStatus,
    };
  });
  const deviations = await db.deviation.findMany({ where: { inquiryId: inquiry.id }, orderBy: { createdAt: 'asc' } });
  const cvrSigners = (await managementAt(db, c.customerId, inquiry.statementDate)).map((p) => p.name);
  const bankSigners = msg.extracted?.signingRights ?? [];
  const extra = bankSigners.filter((b) => !cvrSigners.map((x) => x.toLowerCase()).includes(b.toLowerCase()));
  const checks = await extractionChecks(db, r.id);
  const balanceLines = recon.filter((x) => x.matchStatus);
  return {
    ...base,
    inquiry: { id: inquiry.id, reference: inquiry.reference, statementDate: inquiry.statementDate, status: inquiry.status, statusLabel: INQUIRY_STATUS_LABELS[inquiry.status as InquiryStatus], institute: inst.name, mailbox: CENTRAL_MAILBOX },
    case: { id: c.id, customer: customer.name, cvr: customer.cvr },
    lines: lines.map((l) => ({
      id: l.id, category: l.category, categoryLabel: CATEGORY_LABELS[l.category as LineCategory], accountRef: l.accountRef, account: maskAccount(l.accountRef), description: l.description,
      currency: l.currency, amountOre: l.amountOre, amountDkkOre: l.amountDkkOre, aiConfidence: l.aiConfidence, verified: !!l.verifiedById, low: l.aiConfidence !== null && l.aiConfidence < params.aiThreshold,
      securityDescription: l.securityDescription, isBalance: BALANCE_CATEGORIES.includes(l.category as LineCategory),
    })),
    recon,
    deviations: deviations.map((d) => ({ id: d.id, severity: d.severity, severityLabel: SEVERITY_LABELS[d.severity as Severity], status: d.status, type: DEVIATION_TYPE_LABELS[d.type as 'SALDODIFFERENCE'], description: d.description, sentToAuditorAt: d.sentToAuditorAt, decision: d.decision ? DEVIATION_DECISION_LABELS[d.decision as 'FORKLARET'] : null, justification: d.justification })),
    previewDeviations: r.extractionApprovedAt ? [] : preview.deviations.map((d) => ({ severity: d.severity, severityLabel: SEVERITY_LABELS[d.severity], description: d.description })),
    notes: lines.filter((l) => NOTE_CATEGORIES.includes(l.category as LineCategory)).map((l) => ({ label: l.securityDescription ?? l.description, amountDkkOre: l.amountDkkOre })),
    signingRights: { bank: bankSigners, matches: extra.length === 0, extra },
    checks,
    tiles: { matched: balanceLines.filter((x) => x.matchStatus === 'MATCH').length, total: balanceLines.length, deviations: r.extractionApprovedAt ? deviations.filter((d) => d.status !== 'LUKKET').length : preview.deviations.filter((d) => !d.autoClosed).length, aiConfidence: checks.aiConfidence },
    permissions: {
      register: (actor.role === 'KM' || actor.role === 'KL') && !c.lockedAt,
      sendToAuditor: (actor.role === 'KM' || actor.role === 'KL') && !c.lockedAt && deviations.some((d) => d.status !== 'LUKKET' && !d.sentToAuditorAt),
      assess: can(actor.role, 'MARK_EXPLAINED') && !c.lockedAt,
    },
    categories: Object.entries(CATEGORY_LABELS).map(([key, label]) => ({ key, label })),
  };
}

export async function unmatchedResponses(db: Db, actor: Actor) {
  const responses = await db.response.findMany({ where: { matchStatus: 'UNMATCHED' }, orderBy: { receivedAt: 'asc' } });
  const institutes = await db.institute.findMany();
  const cases = await visibleCases(db, actor);
  const customers = new Map((await db.srcCustomer.findMany()).map((c) => [c.id, c]));
  const open = await db.inquiry.findMany({ where: { caseId: { in: cases.map((c) => c.id) }, status: { in: ['SENDT', 'RYKKET', 'UDEN_SVAR'] } } });
  const date = await today(db);
  return {
    today: date,
    canMatch: actor.role === 'KM' || actor.role === 'KL',
    rows: responses.map((r) => {
      const domain = r.sender.split('@')[1] ?? '';
      const inst = institutes.find((i) => (JSON.parse(i.senderDomains) as string[]).includes(domain));
      const msg = JSON.parse(r.content) as InboundMessage;
      const candidates = open.filter((i) => !inst || i.instituteId === inst.id).map((i) => {
        const c = cases.find((x) => x.id === i.caseId)!;
        return { id: i.id, label: `${i.reference} · ${customers.get(c.customerId)?.name} · ${formatDanish(i.statementDate)}`, likely: !!msg.statementDate && msg.statementDate === i.statementDate };
      }).sort((a, b) => Number(b.likely) - Number(a.likely));
      return {
        id: r.id, receivedAt: r.receivedAt, sender: r.sender, subject: r.subject, institute: inst?.name ?? 'Ukendt afsender', statementDate: r.statementDate, body: msg.body, lines: msg.extracted?.lines.length ?? 0,
        due: workdaysBetween(r.receivedAt.slice(0, 10), date) >= 2 ? 'overdue' : 'ok', candidates,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// S07 Afvigelse
// ---------------------------------------------------------------------------

export async function deviationDetail(db: Db, actor: Actor, deviationId: string) {
  const d = await db.deviation.findUnique({ where: { id: deviationId } });
  if (!d) throw new DomainError('NOT_FOUND', 'Afvigelsen findes ikke.');
  const c = await db.case.findUniqueOrThrow({ where: { id: d.caseId } });
  if (!(await canActorSeeCase(db, actor, c))) throw new DomainError('NOT_FOUND', 'Afvigelsen findes ikke, eller du har ikke adgang til den.');
  const users = await usersById(db);
  const customer = await db.srcCustomer.findUniqueOrThrow({ where: { id: c.customerId } });
  const inquiry = d.inquiryId ? await db.inquiry.findUnique({ where: { id: d.inquiryId } }) : null;
  const inst = inquiry ? await db.institute.findUnique({ where: { id: inquiry.instituteId } }) : null;
  const recon = d.reconLineId ? await db.reconLine.findUnique({ where: { id: d.reconLineId } }) : null;
  const line = recon?.responseLineId ? await db.responseLine.findUnique({ where: { id: recon.responseLineId } }) : null;
  const ledger = recon?.ledgerAccountId ? await db.srcLedgerAccount.findUnique({ where: { id: recon.ledgerAccountId } }) : null;
  const response = inquiry ? await db.response.findFirst({ where: { inquiryId: inquiry.id, extractionApprovedAt: { not: null } } }) : null;
  const events = await db.event.findMany({ where: { objectId: deviationId }, orderBy: { id: 'desc' } });
  const isResponsible = actor.role === 'OR' && c.responsibleId === actor.id;
  return {
    deviation: {
      id: d.id, type: DEVIATION_TYPE_LABELS[d.type as 'SALDODIFFERENCE'], severity: d.severity, severityLabel: SEVERITY_LABELS[d.severity as Severity], status: d.status, description: d.description,
      amountOre: d.amountOre, decision: d.decision, decisionLabel: d.decision ? DEVIATION_DECISION_LABELS[d.decision as 'FORKLARET'] : null, justification: d.justification,
      preparedBy: users.get(d.preparedById ?? '')?.name ?? null, approvedBy: d.approvedById === 'system' ? 'EF-service' : users.get(d.approvedById ?? '')?.name ?? null, approvedAt: d.approvedAt, sentToAuditorAt: d.sentToAuditorAt, createdAt: d.createdAt,
    },
    case: { id: c.id, customer: customer.name, cvr: customer.cvr, balanceDate: c.balanceDate, responsible: users.get(c.responsibleId ?? '')?.name ?? '–' },
    inquiry: inquiry ? { id: inquiry.id, reference: inquiry.reference, institute: inst?.name ?? '' } : null,
    responseId: response?.id ?? null,
    evidence: { bank: line ? { description: line.description, account: maskAccount(line.accountRef), amountDkkOre: line.amountDkkOre, currency: line.currency } : null, ledger: ledger ? { name: ledger.name, account: maskAccount(ledger.accountRef), balanceOre: ledger.balanceOre } : null, differenceOre: recon?.differenceOre ?? null },
    history: events.map((e) => ({ id: e.id, at: e.at, action: e.action, actor: e.actorId === 'system' ? 'EF-service' : users.get(e.actorId)?.name ?? e.actorId, reason: e.reason })),
    permissions: {
      assess: can(actor.role, 'MARK_EXPLAINED') && d.status !== 'LUKKET' && !c.lockedAt,
      canClose: canCloseDeviation(d.severity as Severity, actor.role, isResponsible),
      reclassify: isResponsible && d.status !== 'LUKKET',
      askCustomer: can(actor.role, 'MARK_EXPLAINED') && d.status !== 'LUKKET',
    },
    decisions: Object.entries(DEVIATION_DECISION_LABELS).map(([key, label]) => ({ key, label })),
    severities: Object.entries(SEVERITY_LABELS).map(([key, label]) => ({ key, label })),
  };
}

// ---------------------------------------------------------------------------
// S09 Bankregister, S10 Regler, notifikationer
// ---------------------------------------------------------------------------

export async function registerOverview(db: Db, actor: Actor) {
  const institutes = await db.institute.findMany({ orderBy: { name: 'asc' } });
  const changes = await db.instituteChange.findMany({ orderBy: { requestedAt: 'desc' } });
  const users = await usersById(db);
  const open = await db.inquiry.groupBy({ by: ['instituteId'], where: { status: { notIn: ['AFSLUTTET', 'ANNULLERET'] } }, _count: true });
  return {
    today: await today(db),
    institutes: institutes.map((i) => ({
      ...i, senderDomains: JSON.parse(i.senderDomains) as string[], regNos: JSON.parse(i.regNos) as string[], channelLabel: CHANNEL_LABELS[i.channel as Channel],
      mergedInto: i.mergedIntoId ? institutes.find((x) => x.id === i.mergedIntoId)?.name ?? null : null, verifiedBy: users.get(i.verifiedById ?? '')?.name ?? null,
      openInquiries: open.find((o) => o.instituteId === i.id)?._count ?? 0, pending: changes.filter((c) => c.instituteId === i.id && c.status === 'PENDING').length,
    })),
    changes: changes.map((c) => ({ ...c, institute: institutes.find((i) => i.id === c.instituteId)?.name ?? c.instituteId, requestedBy: users.get(c.requestedById)?.name ?? c.requestedById, decidedBy: users.get(c.decidedById ?? '')?.name ?? null, mine: c.requestedById === actor.id })),
    channels: Object.entries(CHANNEL_LABELS).map(([key, label]) => ({ key, label })),
    permissions: { edit: can(actor.role, 'EDIT_REGISTER'), approve: can(actor.role, 'APPROVE_CHANNEL_CHANGE') },
  };
}

export async function rulesOverview(db: Db, actor: Actor) {
  const date = await today(db);
  const versions = await db.rule.findMany({ orderBy: [{ ruleId: 'asc' }, { version: 'desc' }] });
  const users = await usersById(db);
  return {
    today: date,
    canEdit: can(actor.role, 'EDIT_RULES'),
    paramLabels: PARAM_LABELS,
    typeLabels: RULE_TYPE_LABELS,
    rules: RULE_CATALOG.map((r) => {
      const own = versions.filter((v) => v.ruleId === r.ruleId);
      const current = own.find((v) => v.activeFrom <= date && (!v.activeTo || date < v.activeTo)) ?? own.at(-1);
      return {
        ruleId: r.ruleId, type: r.type, title: r.title, description: r.description, params: current ? JSON.parse(current.params) : r.params, version: current?.version ?? 1, activeFrom: current?.activeFrom ?? null,
        versions: own.map((v) => ({ version: v.version, params: JSON.parse(v.params), activeFrom: v.activeFrom, activeTo: v.activeTo, changedBy: users.get(v.changedById)?.name ?? v.changedById, reason: v.reason })),
        scheduled: own.filter((v) => v.activeFrom > date).length,
      };
    }),
  };
}

export async function notificationsFor(db: Db, actor: Actor) {
  const rows = await db.notification.findMany({ where: { recipientId: actor.id }, orderBy: { createdAt: 'desc' }, take: 100 });
  return rows.map((n) => ({ ...n, channels: n.channel.split(',') }));
}

export async function tasksFor(db: Db, actor: Actor) {
  const date = await today(db);
  const tasks = await db.task.findMany({ where: { assigneeId: actor.id, status: { in: OPEN_TASK }, type: { not: 'OPG-01' } }, orderBy: { dueDate: 'asc' } });
  const cases = new Map((await db.case.findMany({ where: { id: { in: tasks.map((t) => t.caseId).filter(Boolean) as string[] } } })).map((c) => [c.id, c]));
  const customers = new Map((await db.srcCustomer.findMany()).map((c) => [c.id, c]));
  return tasks.map((t) => ({ id: t.id, type: t.type, title: t.title, dueDate: t.dueDate, deadlineTone: deadlineTone(t.dueDate, date), caseId: t.caseId, customer: t.caseId ? customers.get(cases.get(t.caseId)?.customerId ?? '')?.name ?? '' : '', createdByRule: t.createdByRule, deviationId: t.deviationId, inquiryId: t.inquiryId }));
}
