import {
  addWorkdays, authUsable, caseTimeline, CASE_STATUS_LABELS, deriveCaseStatus, formatDanish, sendWindow, verifyBeforeSend,
  type AuthEvaluation, type CaseStatus, type Finding, type InquiryStatus, type IsoDate, type RuleParams,
} from '@/domain/ef';
import { authEvaluation } from './auth-check';
import { now, today } from './clock';
import { CENTRAL_MAILBOX, paramsAt } from './context';
import type { Db } from './db';
import { appendEvent } from './event-log';
import { ensureTask, notify } from './work';

type InquiryRow = Awaited<ReturnType<Db['inquiry']['findUniqueOrThrow']>>;

export interface InquiryChecks {
  blockers: Finding[];
  warnings: Finding[];
  /** Blokeringer ekskl. VR-09 – afgør Kladde/Klar. */
  prerequisites: Finding[];
  auth: AuthEvaluation;
  timingReached: boolean;
}

/** VR-01–VR-09 for én forespørgsel (P06). */
export async function inquiryChecks(db: Db, inquiry: InquiryRow, date: IsoDate, params: RuleParams): Promise<InquiryChecks> {
  const c = await db.case.findUniqueOrThrow({ where: { id: inquiry.caseId } });
  const [customer, engagement, institute, duplicates] = await Promise.all([
    db.srcCustomer.findUniqueOrThrow({ where: { id: c.customerId } }),
    db.srcEngagement.findUniqueOrThrow({ where: { id: c.engagementId } }),
    db.institute.findUnique({ where: { id: inquiry.instituteId } }),
    db.inquiry.count({
      where: {
        id: { not: inquiry.id }, instituteId: inquiry.instituteId, statementDate: inquiry.statementDate,
        status: { notIn: ['ANNULLERET', 'AFSLUTTET', 'UDEN_SVAR'] }, caseId: { in: (await db.case.findMany({ where: { cvr: c.cvr }, select: { id: true } })).map((x) => x.id) },
      },
    }),
  ]);
  const auth = await authEvaluation(db, c.customerId, institute, date, params);
  const result = verifyBeforeSend({
    today: date,
    cvrStatus: customer.cvrStatus as 'NORMAL',
    balanceDate: inquiry.type === 'AARLIG' ? c.balanceDate : engagement.periodEnd,
    periodEnd: engagement.periodEnd,
    bankListApproved: !!c.bankListApprovedAt,
    authCheck: auth.result,
    instituteKnown: !!institute && institute.active && !institute.mergedIntoId,
    duplicateOpen: duplicates > 0,
    replyTo: CENTRAL_MAILBOX,
    centralMailbox: CENTRAL_MAILBOX,
    plannedSendDate: inquiry.plannedSendDate,
  });
  if (inquiry.type !== 'AARLIG' && inquiry.requestedById && !inquiry.approvedById) {
    result.blockers.push({ ruleId: 'SOP-EF-09', message: 'Ad hoc-forespørgslen afventer opgaveansvarlig revisors godkendelse.' });
  }
  if (institute?.mergedIntoId) {
    const into = await db.institute.findUnique({ where: { id: institute.mergedIntoId } });
    const b = result.blockers.find((x) => x.ruleId === 'VR-05');
    if (b && into) b.message = `${institute.name} er fusioneret ind i ${into.name} – erstat linjen på banklisten.`;
  }
  if (auth.result === 'BOER_FORNYES') result.warnings.push({ ruleId: auth.ruleId ?? 'FR-05', message: auth.reason });
  return {
    ...result,
    prerequisites: result.blockers.filter((b) => b.ruleId !== 'VR-09'),
    auth,
    timingReached: date >= inquiry.plannedSendDate,
  };
}

/** Frist for at sende (OPG-06): TR-10-vinduet for årlige, 5 hverdage for ad hoc (SOP-EF-09). */
export async function sendDueDate(db: Db, inquiry: InquiryRow, params: RuleParams): Promise<IsoDate> {
  if (inquiry.type !== 'AARLIG') return addWorkdays(inquiry.createdAt.slice(0, 10), 5);
  const c = await db.case.findUniqueOrThrow({ where: { id: inquiry.caseId } });
  const inst = await db.institute.findUniqueOrThrow({ where: { id: inquiry.instituteId } });
  return sendWindow(c.balanceDate, inst, params).due;
}

/** Kladde ↔ Klar efter forudsætningerne; Klar og tidspunkt nået → OPG-06 i køen. */
export async function refreshInquiry(db: Db, inquiryId: string): Promise<void> {
  const inquiry = await db.inquiry.findUniqueOrThrow({ where: { id: inquiryId } });
  if (inquiry.status !== 'KLADDE' && inquiry.status !== 'KLAR') return;
  const c = await db.case.findUniqueOrThrow({ where: { id: inquiry.caseId } });
  const date = await today(db);
  const params = await paramsAt(db, c.rulesAsOf);
  const checks = await inquiryChecks(db, inquiry, date, params);
  const ready = checks.prerequisites.length === 0;
  let status = inquiry.status as InquiryStatus;
  if (status === 'KLADDE' && ready) status = 'KLAR';
  if (status === 'KLAR' && !ready) status = 'KLADDE';
  if (status !== inquiry.status) {
    await db.inquiry.update({ where: { id: inquiry.id }, data: { status, updatedAt: await now(db) } });
    await appendEvent(db, {
      objectType: 'Forespørgsel', objectId: inquiry.id, caseId: c.id, action: status === 'KLAR' ? 'forespoergsel.klar' : 'forespoergsel.tilbage_til_kladde', actorId: 'system',
      before: { status: inquiry.status }, after: { status }, reason: status === 'KLADDE' ? checks.prerequisites.map((b) => `${b.ruleId}: ${b.message}`).join(' ') : 'VR-01–VR-08 opfyldt',
    });
  }
  if (status === 'KLAR' && checks.timingReached) {
    const inst = await db.institute.findUniqueOrThrow({ where: { id: inquiry.instituteId } });
    await ensureTask(db, {
      caseId: c.id, type: 'OPG-06', title: `Afsend forespørgsel til ${inst.name}`, role: 'KM', assigneeId: c.coreUserId,
      dueDate: await sendDueDate(db, { ...inquiry, status }, params), createdByRule: 'TR-10', inquiryId: inquiry.id,
    });
  }
}

export interface NextAction {
  action: string;
  owner: string;
}

async function userLabel(db: Db, id: string | null | undefined, role: string): Promise<string> {
  if (!id) return role;
  const u = await db.user.findUnique({ where: { id } });
  return u ? `${role} · ${u.name}` : role;
}

/** "Hvem har bolden?" (K3) – én næste handling og én ejer pr. sag. */
export async function nextActionFor(db: Db, caseId: string): Promise<NextAction> {
  const c = await db.case.findUniqueOrThrow({ where: { id: caseId } });
  if (c.status === 'LAAST' || c.status === 'KONKLUDERET') return { action: 'Ingen – sagen er konkluderet og låst', owner: '–' };
  const date = await today(db);
  const params = await paramsAt(db, c.rulesAsOf);
  const t = caseTimeline(c.balanceDate, c.plannedSignOff, params);
  const auditor = await userLabel(db, c.responsibleId, 'Revisor');
  const core = await userLabel(db, c.coreUserId, 'Kerneteam');

  if (!c.bankListApprovedAt) {
    if (date < t.proposal) return { action: `Bankliste foreslås ${formatDanish(t.proposal)} (TR-05)`, owner: 'EF-service' };
    const delegate = c.delegateId && (!c.delegateUntil || c.delegateUntil >= date) ? await userLabel(db, c.delegateId, 'Delegeret') : null;
    return { action: `Godkend bankliste senest ${formatDanish(t.approvalDeadline)}`, owner: delegate ?? auditor };
  }
  const inquiries = await db.inquiry.findMany({ where: { caseId } });
  const institutes = await db.institute.findMany({ where: { id: { in: inquiries.map((i) => i.instituteId) } } });
  const name = (id: string) => institutes.find((x) => x.id === id)?.name ?? id;
  const by = (...s: string[]) => inquiries.filter((i) => s.includes(i.status));

  const auth = await authEvaluation(db, c.customerId, null, date, params);
  if (!authUsable(auth.result) && by('KLADDE', 'KLAR').length > 0) {
    const signing = await db.fuldmagt.findFirst({ where: { customerId: c.customerId, status: 'SENDT_TIL_SIGNERING' } });
    if (signing) return { action: 'Kunden underskriver fuldmagten i Penneo', owner: 'Kunde' };
    const manual = await db.fuldmagt.findFirst({ where: { customerId: c.customerId, status: 'UNDERSKREVET' } });
    if (manual) return { action: 'Verificér underskrivere (4-øjne)', owner: core };
    return { action: `Indhent fuldmagt senest ${formatDanish(t.authDeadline)} (${auth.ruleId ?? 'P04'})`, owner: core };
  }
  const rejected = by('AFVIST');
  if (rejected.length) return { action: `Ret afvisning fra ${name(rejected[0]!.instituteId)} og genfremsend`, owner: core };
  const escalated = by('SENDT', 'RYKKET').filter((i) => i.escalatedAt);
  if (escalated.length) return { action: `Beslut handling: manglende svar fra ${name(escalated[0]!.instituteId)}`, owner: auditor };
  const deviations = await db.deviation.findMany({ where: { caseId, status: { not: 'LUKKET' } } });
  const forAuditor = deviations.filter((d) => d.sentToAuditorAt);
  if (forAuditor.length) return { action: `Vurdér ${forAuditor.length} afvigelse${forAuditor.length === 1 ? '' : 'r'}`, owner: auditor };
  const noAnswer = by('UDEN_SVAR');
  if (noAnswer.length) return { action: `Dokumentér alternative handlinger for ${name(noAnswer[0]!.instituteId)}`, owner: auditor };
  const received = by('SVAR_MODTAGET');
  if (received.length) {
    const responses = await db.response.findMany({ where: { inquiryId: { in: received.map((i) => i.id) } } });
    const unapproved = received.filter((i) => !responses.some((r) => r.inquiryId === i.id && r.extractionApprovedAt));
    if (unapproved.length) return { action: `Verificér udtræk fra ${name(unapproved[0]!.instituteId)}`, owner: core };
    return { action: `Send ${deviations.length} afvigelse${deviations.length === 1 ? '' : 'r'} til revisor`, owner: core };
  }
  const ready = by('KLAR');
  const due = ready.filter((i) => i.plannedSendDate <= date);
  if (due.length) return { action: `Afsend ${due.length} forespørgsel${due.length === 1 ? '' : 'er'}`, owner: core };
  if (ready.length) return { action: `Afsendes ${formatDanish(ready.map((i) => i.plannedSendDate).sort()[0])} (TR-10)`, owner: 'EF-service' };
  const drafts = by('KLADDE');
  if (drafts.length) return { action: 'Forudsætninger for afsendelse mangler', owner: core };
  const waiting = by('SENDT', 'RYKKET').sort((a, b) => (a.responseDeadline ?? '').localeCompare(b.responseDeadline ?? ''));
  if (waiting.length) return { action: `Afventer svar fra ${name(waiting[0]!.instituteId)} (frist ${formatDanish(waiting[0]!.responseDeadline)})`, owner: 'Pengeinstitut' };
  if (c.status === 'KLAR_TIL_KONKLUSION') return { action: `Konkludér senest ${formatDanish(t.conclusionDeadline)}`, owner: auditor };
  return { action: CASE_STATUS_LABELS[c.status as CaseStatus], owner: '–' };
}

/** Afleder sagens status og næste handling; opretter OPG-14, når sagen er klar til konklusion. */
export async function refreshCase(db: Db, caseId: string): Promise<void> {
  const c = await db.case.findUniqueOrThrow({ where: { id: caseId } });
  const inquiries = await db.inquiry.findMany({ where: { caseId } });
  const openForAuditor = await db.deviation.count({ where: { caseId, status: { not: 'LUKKET' }, sentToAuditorAt: { not: null } } });
  const status = deriveCaseStatus({
    current: c.status as CaseStatus,
    bankListApproved: !!c.bankListApprovedAt,
    inquiries: inquiries.map((i) => i.status as InquiryStatus),
    openDeviationsForAuditor: openForAuditor,
  });
  const at = await now(db);
  if (status !== c.status) {
    await db.case.update({ where: { id: caseId }, data: { status, updatedAt: at } });
    await appendEvent(db, { objectType: 'Sag', objectId: caseId, caseId, action: 'sag.status', actorId: 'system', before: { status: c.status }, after: { status } });
    if (status === 'KLAR_TIL_KONKLUSION') {
      const params = await paramsAt(db, c.rulesAsOf);
      const t = caseTimeline(c.balanceDate, c.plannedSignOff, params);
      await ensureTask(db, { caseId, type: 'OPG-14', title: 'Konkludér og dokumentér', role: 'OR', assigneeId: c.responsibleId, dueDate: t.conclusionDeadline, createdByRule: 'Alle forespørgsler afsluttet' });
      await notify(db, { recipientId: c.responsibleId, type: 'KONKLUSION_KLAR', message: `Konklusionsudkast klar: ${await customerName(db, c.customerId)}`, link: `/sager/${caseId}`, channels: ['BRUGERFLADE'] });
    }
  }
  const next = await nextActionFor(db, caseId);
  if (next.action !== c.nextAction || next.owner !== c.nextOwner) {
    await db.case.update({ where: { id: caseId }, data: { nextAction: next.action, nextOwner: next.owner, updatedAt: at } });
  }
}

export async function customerName(db: Db, customerId: string): Promise<string> {
  return (await db.srcCustomer.findUnique({ where: { id: customerId } }))?.name ?? customerId;
}

/** Efter ændringer i fuldmagt eller bankregister: genberegn alle åbne sager for kunden. */
export async function refreshCustomer(db: Db, customerId: string): Promise<void> {
  const cases = await db.case.findMany({ where: { customerId, status: { notIn: ['KONKLUDERET', 'LAAST'] } } });
  for (const c of cases) {
    const drafts = await db.inquiry.findMany({ where: { caseId: c.id, status: { in: ['KLADDE', 'KLAR'] } } });
    for (const i of drafts) await refreshInquiry(db, i.id);
    await refreshCase(db, c.id);
  }
}
