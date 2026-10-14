import {
  addDays, addWorkdays, authUsable, caseTimeline, isoWeek, REJECTION_REASON_LABELS, sendWindow, SEVERITY_LABELS, weekStart, workdaysBetween,
  type IsoDate, type RejectionReason,
} from '@/domain/ef';
import { authEvaluation } from './auth-check';
import { today } from './clock';
import { assertCan, paramsAt, type Actor } from './context';
import type { Db } from './db';

/**
 * Rapporter og KPI (S11, K7), årshjul og kapacitet (S08) og eksport af
 * hændelsesloggen til procesanalyse (OCEL 2.0). Alt beregnes af
 * hændelsesloggen og objekterne – ingen manuel dataindsamling i regneark.
 */

const pct = (n: number, d: number) => (d === 0 ? null : Math.round((n / d) * 1000) / 10);

export interface KpiFilter {
  from?: IsoDate;
  to?: IsoDate;
  department?: string;
}

export async function kpiReport(db: Db, actor: Actor, filter: KpiFilter = {}) {
  assertCan(actor, 'SEE_KPI');
  // Migreret historik (fase 0) indgår ikke i KPI'erne – den er kun grundlag for banklisteforslaget.
  const cases = (await db.case.findMany({ where: filter.department ? { department: filter.department } : {} })).filter((c) => !c.id.startsWith('sag-hist'));
  const caseById = new Map(cases.map((c) => [c.id, c]));
  const all = await db.inquiry.findMany({ where: { caseId: { in: cases.map((c) => c.id) }, sentAt: { not: null } } });
  const inquiries = all.filter((i) => (!filter.from || i.sentAt!.slice(0, 10) >= filter.from) && (!filter.to || i.sentAt!.slice(0, 10) <= filter.to));
  const institutes = await db.institute.findMany();
  const responses = await db.response.findMany({ where: { inquiryId: { in: inquiries.map((i) => i.id) }, senderVerified: true, invalidReason: null } });
  const firstResponse = new Map<string, string>();
  for (const r of responses.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))) if (!firstResponse.has(r.inquiryId!)) firstResponse.set(r.inquiryId!, r.receivedAt.slice(0, 10));

  const onTimeSend = async (i: (typeof inquiries)[number]) => {
    const c = caseById.get(i.caseId)!;
    if (i.type !== 'AARLIG') return i.sentAt!.slice(0, 10) <= addWorkdays(i.createdAt.slice(0, 10), 5);
    const inst = institutes.find((x) => x.id === i.instituteId)!;
    return i.sentAt!.slice(0, 10) <= sendWindow(c.balanceDate, inst, await paramsAt(db, c.rulesAsOf)).due;
  };
  let sentOnTime = 0;
  for (const i of inquiries) if (await onTimeSend(i)) sentOnTime++;
  const answered = inquiries.filter((i) => firstResponse.has(i.id));
  const answeredInTime = answered.filter((i) => firstResponse.get(i.id)! <= (i.responseDeadline ?? '9999'));
  const responseDays = answered.map((i) => workdaysBetween(i.sentAt!.slice(0, 10), firstResponse.get(i.id)!));

  const rejectionEvents = await db.event.findMany({ where: { action: 'forespoergsel.afvist', objectId: { in: inquiries.map((i) => i.id) } } });
  const rejections: Record<string, number> = {};
  for (const e of rejectionEvents) {
    const reason = (JSON.parse(e.after ?? '{}').rejectionReason ?? 'ANDET') as RejectionReason;
    rejections[REJECTION_REASON_LABELS[reason]] = (rejections[REJECTION_REASON_LABELS[reason]] ?? 0) + 1;
  }
  const deviations = await db.deviation.findMany({ where: { caseId: { in: cases.map((c) => c.id) } } });
  const bySeverity = Object.fromEntries(Object.entries(SEVERITY_LABELS).map(([k, label]) => [label, deviations.filter((d) => d.severity === k).length]));

  const concluded = cases.filter((c) => c.concludedAt);
  let concludedOnTime = 0;
  for (const c of concluded) if (c.concludedAt!.slice(0, 10) <= caseTimeline(c.balanceDate, c.plannedSignOff, await paramsAt(db, c.rulesAsOf)).conclusionDeadline) concludedOnTime++;

  const perInstitute = institutes
    .map((inst) => {
      const own = inquiries.filter((i) => i.instituteId === inst.id);
      const ownAnswered = own.filter((i) => firstResponse.has(i.id));
      const days = ownAnswered.map((i) => workdaysBetween(i.sentAt!.slice(0, 10), firstResponse.get(i.id)!));
      return {
        id: inst.id, name: inst.name, sla: inst.responseWorkdays, sent: own.length, answered: ownAnswered.length,
        avgDays: days.length ? Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10 : null,
        slaDeviation: inst.slaSampleSize ? inst.slaDeviationWorkdays : null,
        rejections: rejectionEvents.filter((e) => own.some((i) => i.id === e.objectId)).length,
        reminders: own.reduce((a, i) => a + i.reminderCount, 0),
      };
    })
    .filter((x) => x.sent > 0)
    .sort((a, b) => b.sent - a.sent);

  const weeks = new Map<string, { week: string; start: IsoDate; sent: number; answered: number }>();
  const bump = (date: IsoDate, key: 'sent' | 'answered') => {
    const w = isoWeek(date);
    const id = `${w.year}-U${String(w.week).padStart(2, '0')}`;
    if (!weeks.has(id)) weeks.set(id, { week: id, start: weekStart(date), sent: 0, answered: 0 });
    weeks.get(id)![key]++;
  };
  for (const i of inquiries) bump(i.sentAt!.slice(0, 10), 'sent');
  for (const d of firstResponse.values()) bump(d, 'answered');
  // Sammenhængende uger, så tidsaksen ikke springer tomme uger over.
  const starts = [...weeks.values()].map((w) => w.start).sort();
  if (starts.length) {
    for (let d = starts[0]!; d <= starts.at(-1)!; d = addDays(d, 7)) {
      const w = isoWeek(d);
      const id = `${w.year}-U${String(w.week).padStart(2, '0')}`;
      if (!weeks.has(id)) weeks.set(id, { week: id, start: d, sent: 0, answered: 0 });
    }
  }

  const departments = [...new Set(cases.map((c) => c.department))].sort().map((dep) => {
    const own = inquiries.filter((i) => caseById.get(i.caseId)?.department === dep);
    return { department: dep, sent: own.length, answered: own.filter((i) => firstResponse.has(i.id)).length, cases: cases.filter((c) => c.department === dep).length };
  });

  return {
    filter,
    totals: {
      cases: cases.length,
      sent: inquiries.length,
      sentOnTimePct: pct(sentOnTime, inquiries.length),
      answerRatePct: pct(answered.length, inquiries.length),
      answeredInTimePct: pct(answeredInTime.length, answered.length),
      avgResponseWorkdays: responseDays.length ? Math.round((responseDays.reduce((a, b) => a + b, 0) / responseDays.length) * 10) / 10 : null,
      reminders: inquiries.reduce((a, i) => a + i.reminderCount, 0),
      escalations: inquiries.filter((i) => i.escalatedAt).length,
      rejections: rejectionEvents.length,
      adhoc: inquiries.filter((i) => i.type !== 'AARLIG').length,
      concluded: concluded.length,
      concludedOnTimePct: pct(concludedOnTime, concluded.length),
      deviations: deviations.length,
    },
    rejections,
    bySeverity,
    perInstitute,
    perWeek: [...weeks.values()].sort((a, b) => a.start.localeCompare(b.start)),
    departments,
  };
}

/**
 * S08: forventede handlinger pr. uge og institut – også for opgaver, der
 * endnu ikke har en sag (planlægges ud fra Maconomy, sidste år og SAF-T).
 */
export async function capacityForecast(db: Db, actor: Actor, opts: { from?: IsoDate; weeks?: number } = {}) {
  assertCan(actor, 'SEE_KPI');
  const date = await today(db);
  const from = weekStart(opts.from ?? date);
  const horizon = opts.weeks ?? 20;
  const end = addDays(from, horizon * 7 - 1);
  const params = await paramsAt(db, date);
  const engagements = await db.srcEngagement.findMany({ where: { status: 'AKTIV' } });
  const institutes = await db.institute.findMany();
  type Week = { week: string; start: IsoDate; created: number; approvals: number; authDeadlines: number; sends: number; responses: number; conclusions: number; byInstitute: Record<string, number> };
  const weeks = new Map<string, Week>();
  for (let i = 0; i < horizon; i++) {
    const ws = addDays(from, i * 7);
    const w = isoWeek(ws);
    weeks.set(ws, { week: `U${w.week} ${w.year}`, start: ws, created: 0, approvals: 0, authDeadlines: 0, sends: 0, responses: 0, conclusions: 0, byInstitute: {} });
  }
  const add = (d: IsoDate, key: keyof Omit<Week, 'week' | 'start' | 'byInstitute'>, institute?: string) => {
    const w = weeks.get(weekStart(d));
    if (!w) return;
    w[key]++;
    if (institute) w.byInstitute[institute] = (w.byInstitute[institute] ?? 0) + 1;
  };
  const coverage = { customers: 0, covered: 0 };
  const seen = new Set<string>();
  for (const e of engagements) {
    if (!params.mandatoryTypes.includes(e.type) && !(params.optInTypes.includes(e.type) && e.optIn)) continue;
    if (e.plannedSignOff < from || e.periodEnd > end) continue;
    const t = caseTimeline(e.periodEnd, e.plannedSignOff, params);
    const c = await db.case.findUnique({ where: { engagementId: e.id } });
    if (c?.status === 'LAAST') continue;
    add(t.create, 'created');
    add(t.approvalDeadline, 'approvals');
    add(t.authDeadline, 'authDeadlines');
    add(t.conclusionDeadline, 'conclusions');
    let instituteIds: string[];
    if (c) instituteIds = (await db.bankListLine.findMany({ where: { caseId: c.id, included: true } })).map((l) => l.instituteId);
    else {
      const prev = await db.case.findFirst({ where: { customerId: e.customerId }, orderBy: { balanceDate: 'desc' } });
      const fromPrev = prev ? (await db.bankListLine.findMany({ where: { caseId: prev.id, included: true } })).map((l) => l.instituteId) : [];
      const fromSaft = (await db.srcLedgerAccount.findMany({ where: { customerId: e.customerId, instituteId: { not: null } } })).map((l) => l.instituteId!);
      instituteIds = [...new Set([...fromPrev, ...fromSaft])];
    }
    for (const id of instituteIds) {
      const inst = institutes.find((x) => x.id === id);
      const target = inst?.mergedIntoId ? institutes.find((x) => x.id === inst.mergedIntoId) : inst;
      if (!target) continue;
      const sent = c ? await db.inquiry.findFirst({ where: { caseId: c.id, instituteId: target.id, sentAt: { not: null } } }) : null;
      if (sent) continue;
      const window = sendWindow(e.periodEnd, target, params);
      add(window.planned, 'sends', target.name);
      add(addWorkdays(window.planned, target.responseWorkdays), 'responses');
    }
    if (!seen.has(e.customerId)) {
      seen.add(e.customerId);
      coverage.customers++;
      if (authUsable((await authEvaluation(db, e.customerId, null, date, params)).result)) coverage.covered++;
    }
  }
  const list = [...weeks.values()];
  const peak = list.reduce((a, b) => (b.sends > a.sends ? b : a), list[0]!);
  const peakInstitutes = Object.entries(peak?.byInstitute ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 3);
  return { from, weeks: list, peak: peak && peak.sends > 0 ? { week: peak.week, sends: peak.sends, institutes: peakInstitutes } : null, coverage: { ...coverage, pct: pct(coverage.covered, coverage.customers) } };
}

/** Hændelsesloggen som CSV (revisionsspor). */
export async function eventLogCsv(db: Db, actor: Actor): Promise<string> {
  assertCan(actor, 'SEE_KPI');
  const events = await db.event.findMany({ orderBy: { id: 'asc' } });
  const esc = (v: string | null) => (v === null ? '' : /[",\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const header = 'id;tidspunkt;objekttype;objekt;sag;handling;aktør;på_vegne_af;kilde;begrundelse';
  return [header, ...events.map((e) => [e.id, e.at, e.objectType, e.objectId, e.caseId, e.action, e.actorId, e.onBehalfOf, e.source, e.reason].map(esc).join(';'))].join('\n');
}

/** OCEL 2.0 (JSON) til procesanalyse (P10): hændelser med relationer til sag, forespørgsel, fuldmagt m.fl. */
export async function exportOcel(db: Db, actor: Actor) {
  assertCan(actor, 'SEE_KPI');
  const [events, cases, inquiries, fuldmagter, deviations, institutes] = await Promise.all([
    db.event.findMany({ orderBy: { id: 'asc' } }), db.case.findMany(), db.inquiry.findMany(), db.fuldmagt.findMany(), db.deviation.findMany(), db.institute.findMany(),
  ]);
  const objects = [
    ...cases.map((c) => ({ id: c.id, type: 'Sag', attributes: [{ name: 'balancedag', value: c.balanceDate, time: c.createdAt }, { name: 'status', value: c.status, time: c.updatedAt }, { name: 'afdeling', value: c.department, time: c.createdAt }], relationships: [] as { objectId: string; qualifier: string }[] })),
    ...inquiries.map((i) => ({ id: i.id, type: 'Forespørgsel', attributes: [{ name: 'reference', value: i.reference, time: i.createdAt }, { name: 'status', value: i.status, time: i.updatedAt }, { name: 'kanal', value: i.channel, time: i.createdAt }], relationships: [{ objectId: i.caseId, qualifier: 'sag' }, { objectId: i.instituteId, qualifier: 'institut' }] })),
    ...fuldmagter.map((f) => ({ id: f.id, type: 'Fuldmagt', attributes: [{ name: 'status', value: f.status, time: f.createdAt }, { name: 'omfang', value: f.scope, time: f.createdAt }], relationships: [] })),
    ...deviations.map((d) => ({ id: d.id, type: 'Afvigelse', attributes: [{ name: 'klassifikation', value: d.severity, time: d.createdAt }, { name: 'status', value: d.status, time: d.createdAt }], relationships: [{ objectId: d.caseId, qualifier: 'sag' }, ...(d.inquiryId ? [{ objectId: d.inquiryId, qualifier: 'forespørgsel' }] : [])] })),
    ...institutes.map((x) => ({ id: x.id, type: 'Institut', attributes: [{ name: 'kanal', value: x.channel, time: x.verifiedAt || '2026-10-05' }], relationships: [] })),
  ];
  const known = new Set(objects.map((o) => o.id));
  const ocelEvents = events.map((e) => ({
    id: e.id,
    type: e.action,
    time: e.at,
    attributes: [{ name: 'aktør', value: e.actorId }, { name: 'kilde', value: e.source }, ...(e.reason ? [{ name: 'begrundelse', value: e.reason }] : [])],
    relationships: [
      ...(known.has(e.objectId) ? [{ objectId: e.objectId, qualifier: e.objectType.toLowerCase() }] : []),
      ...(e.caseId && e.caseId !== e.objectId && known.has(e.caseId) ? [{ objectId: e.caseId, qualifier: 'sag' }] : []),
    ],
  }));
  const objectTypes = [...new Set(objects.map((o) => o.type))].map((name) => ({ name, attributes: [...new Set(objects.filter((o) => o.type === name).flatMap((o) => o.attributes.map((a) => a.name)))].map((a) => ({ name: a, type: 'string' })) }));
  const eventTypes = [...new Set(events.map((e) => e.action))].map((name) => ({ name, attributes: [{ name: 'aktør', type: 'string' }, { name: 'kilde', type: 'string' }, { name: 'begrundelse', type: 'string' }] }));
  return { objectTypes, eventTypes, objects, events: ocelEvents };
}

