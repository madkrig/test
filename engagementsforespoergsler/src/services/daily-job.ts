import { addDays, addWorkdays, caseTimeline, followUpDates, formatDanish, minDate, type IsoDate } from '@/domain/ef';
import { now, setToday, today } from './clock';
import { bankListProposalReady, createDueCases } from './cases';
import { assertCan, paramsAt, type Actor } from './context';
import type { Db } from './db';
import { DomainError } from './errors';
import { appendEvent } from './event-log';
import { customerName, refreshCase, refreshInquiry } from './readiness';
import { updateSlaHistory } from './register';
import { demoEnabled } from './simulator';
import { ensureTask, firstTime, notify } from './work';

/**
 * Daglig kørsel – reglerne gør arbejdet, så ingen skal huske det (K5):
 * oprettelse af sager (TR-01/02), bankliste (TR-05, ER-06), afsendelse
 * (TR-10), rykkere og eskalering (ER-02/03), fuldmagter (ER-05),
 * afvigelser (ER-07) og konklusion (ER-08). Idempotent pr. dag.
 */
export interface DailySummary {
  date: IsoDate;
  casesCreated: number;
  remindersSuggested: number;
  escalations: number;
  notifications: number;
  sendTasks: number;
}

export async function runDailyJob(db: Db): Promise<DailySummary> {
  const date = await today(db);
  const notificationsBefore = await db.notification.count();
  const sendTasksBefore = await db.task.count({ where: { type: 'OPG-06' } });
  const summary: DailySummary = { date, casesCreated: 0, remindersSuggested: 0, escalations: 0, notifications: 0, sendTasks: 0 };
  summary.casesCreated = (await createDueCases(db)).length;

  const cases = await db.case.findMany({ where: { status: { notIn: ['KONKLUDERET', 'LAAST'] } } });
  const leads = await db.user.findMany({ where: { role: 'KL' } });
  for (const c of cases) {
    const params = await paramsAt(db, c.rulesAsOf);
    const t = caseTimeline(c.balanceDate, c.plannedSignOff, params);
    const name = await customerName(db, c.customerId);

    if (!c.bankListApprovedAt) {
      if (date >= t.proposal) await bankListProposalReady(db, c.id);
      if (date >= t.bankListReminder && (await firstTime(db, c.id, 'bankliste.paamindelse'))) {
        await notify(db, { recipientId: c.delegateId ?? c.responsibleId, type: 'BANKLISTE_PAAMINDELSE', message: `Påmindelse: godkend banklisten for ${name} senest ${formatDanish(t.approvalDeadline)}`, link: `/sager/${c.id}?fane=bankliste`, channels: ['TEAMS', 'BRUGERFLADE'] });
        await appendEvent(db, { objectType: 'Sag', objectId: c.id, caseId: c.id, action: 'bankliste.paamindelse', actorId: 'system', reason: 'ER-06' });
      }
      if (date >= t.bankListEscalation && (await firstTime(db, c.id, 'bankliste.eskaleret'))) {
        for (const l of leads) await notify(db, { recipientId: l.id, type: 'BANKLISTE_ESKALERING', message: `Bankliste ikke godkendt for ${name} (frist ${formatDanish(t.approvalDeadline)})`, link: `/sager/${c.id}?fane=bankliste`, channels: ['TEAMS', 'BRUGERFLADE'] });
        await appendEvent(db, { objectType: 'Sag', objectId: c.id, caseId: c.id, action: 'bankliste.eskaleret', actorId: 'system', reason: 'ER-06: eskaleret til kerneteamleder' });
        summary.escalations++;
      }
    }

    for (const i of await db.inquiry.findMany({ where: { caseId: c.id, status: { in: ['KLADDE', 'KLAR'] } } })) await refreshInquiry(db, i.id);

    for (const i of await db.inquiry.findMany({ where: { caseId: c.id, status: { in: ['SENDT', 'RYKKET'] }, responseDeadline: { not: null } } })) {
      const fu = followUpDates(i.responseDeadline!, c.plannedSignOff, params);
      const inst = await db.institute.findUniqueOrThrow({ where: { id: i.instituteId } });
      if (i.reminderCount === 0 && date >= fu.reminder1) {
        await ensureTask(db, { caseId: c.id, type: 'OPG-07', title: `Send 1. rykker til ${inst.name}`, role: 'KM', assigneeId: c.coreUserId, dueDate: date, createdByRule: 'ER-02', inquiryId: i.id });
        summary.remindersSuggested++;
      } else if (i.reminderCount === 1 && date >= fu.reminder2) {
        await ensureTask(db, { caseId: c.id, type: 'OPG-07', title: `Send 2. rykker til ${inst.name}`, role: 'KM', assigneeId: c.coreUserId, dueDate: date, createdByRule: 'ER-02', inquiryId: i.id });
        summary.remindersSuggested++;
      }
      if (!i.escalatedAt && date >= fu.escalation) {
        await db.inquiry.update({ where: { id: i.id }, data: { escalatedAt: date, updatedAt: await now(db) } });
        await appendEvent(db, { objectType: 'Forespørgsel', objectId: i.id, caseId: c.id, action: 'forespoergsel.eskaleret', actorId: 'system', reason: `ER-03: frist + ${params.escalationWorkdays} hverdage eller P−${params.escalationDaysBeforeP}` });
        await ensureTask(db, { caseId: c.id, type: 'OPG-11', title: `Beslut handling: manglende svar fra ${inst.name}`, role: 'OR', assigneeId: c.responsibleId, dueDate: minDate(addWorkdays(date, 2), t.alternativesDeadline), createdByRule: 'ER-03', inquiryId: i.id });
        await notify(db, { recipientId: c.responsibleId, type: 'ESKALERING', message: `Manglende svar fra ${inst.name} for ${name} (${i.reference}) – beslut næste skridt`, link: `/sager/${c.id}?fane=forespoergsler`, channels: ['TEAMS', 'EMAIL', 'BRUGERFLADE'] });
        summary.escalations++;
      }
    }

    if (date >= t.conclusionDeadline && (await firstTime(db, c.id, 'sag.advarsel_p5'))) {
      await notify(db, { recipientId: c.responsibleId, type: 'IKKE_KONKLUDERET', message: `${name} er ikke konkluderet – planlagt påtegning ${formatDanish(c.plannedSignOff)}`, link: `/sager/${c.id}`, channels: ['TEAMS', 'BRUGERFLADE'] });
      await appendEvent(db, { objectType: 'Sag', objectId: c.id, caseId: c.id, action: 'sag.advarsel_p5', actorId: 'system', reason: 'ER-08' });
    }
  }

  // ER-05: fuldmagt ikke underskrevet – påmindelse dag 5 og 10, revisor orienteres dag 15.
  for (const f of await db.fuldmagt.findMany({ where: { status: 'SENDT_TIL_SIGNERING', sentForSigningAt: { not: null } } })) {
    const params = await paramsAt(db, date);
    const sent = f.sentForSigningAt!.slice(0, 10);
    const fCases = await db.case.findMany({ where: { customerId: f.customerId, status: { notIn: ['KONKLUDERET', 'LAAST'] } } });
    const c = fCases[0];
    for (const day of params.authReminderDays) {
      if (date >= addDays(sent, day) && (await firstTime(db, f.id, `fuldmagt.paamindelse_dag${day}`))) {
        await appendEvent(db, { objectType: 'Fuldmagt', objectId: f.id, action: `fuldmagt.paamindelse_dag${day}`, actorId: 'system', reason: 'ER-05' });
        const open = await db.task.findFirst({ where: { type: 'OPG-05.4', fuldmagtId: f.id, status: { in: ['AABEN', 'I_GANG', 'VENTER'] } } });
        if (open) await db.task.update({ where: { id: open.id }, data: { title: `Påmind kunde (dag ${day})`, dueDate: date } });
        else if (c) await ensureTask(db, { caseId: c.id, type: 'OPG-05.4', title: `Påmind kunde (dag ${day})`, role: 'KM', assigneeId: c.coreUserId, dueDate: date, createdByRule: 'ER-05', fuldmagtId: f.id });
        summary.remindersSuggested++;
      }
    }
    if (date >= addDays(sent, params.authEscalationDay) && (await firstTime(db, f.id, 'fuldmagt.eskaleret'))) {
      await appendEvent(db, { objectType: 'Fuldmagt', objectId: f.id, action: 'fuldmagt.eskaleret', actorId: 'system', reason: `ER-05: ikke underskrevet dag ${params.authEscalationDay}` });
      for (const x of fCases) await notify(db, { recipientId: x.responsibleId, type: 'FULDMAGT_DAG15', message: `Fuldmagten for ${await customerName(db, f.customerId)} er ikke underskrevet efter ${params.authEscalationDay} dage`, link: `/sager/${x.id}?fane=fuldmagt`, channels: ['TEAMS', 'BRUGERFLADE'] });
      summary.escalations++;
    }
  }

  // ER-07: afvigelse ubehandlet 5 hverdage efter oprettelse.
  for (const d of await db.deviation.findMany({ where: { status: { not: 'LUKKET' } } })) {
    const c = await db.case.findUniqueOrThrow({ where: { id: d.caseId } });
    const params = await paramsAt(db, c.rulesAsOf);
    if (date >= addWorkdays(d.createdAt.slice(0, 10), params.deviationReminderWorkdays) && (await firstTime(db, d.id, 'afvigelse.paamindelse'))) {
      const team = await db.srcTeamMember.findMany({ where: { engagementId: c.engagementId } });
      const rms = await db.user.findMany({ where: { id: { in: team.map((t) => t.userId) }, role: 'RM' } });
      for (const r of [c.responsibleId, ...rms.map((x) => x.id)]) await notify(db, { recipientId: r, type: 'AFVIGELSE_PAAMINDELSE', message: `Afvigelse ubehandlet i ${params.deviationReminderWorkdays} hverdage: ${d.description}`, link: `/afvigelser/${d.id}`, channels: ['BRUGERFLADE'] });
      await appendEvent(db, { objectType: 'Afvigelse', objectId: d.id, caseId: c.id, action: 'afvigelse.paamindelse', actorId: 'system', reason: 'ER-07' });
    }
  }

  // Udskudte opgaver vågner.
  await db.task.updateMany({ where: { status: 'VENTER', snoozedUntil: { lte: date } }, data: { status: 'AABEN', snoozedUntil: null } });
  for (const c of cases) await refreshCase(db, c.id);
  await updateSlaHistory(db);

  summary.notifications = (await db.notification.count()) - notificationsBefore;
  summary.sendTasks = (await db.task.count({ where: { type: 'OPG-06' } })) - sendTasksBefore;
  await db.setting.upsert({ where: { key: 'lastDailyRun' }, update: { value: date }, create: { key: 'lastDailyRun', value: date } });
  await appendEvent(db, { objectType: 'Job', objectId: `dagligt-${date}`, action: 'job.daglig_koersel', actorId: 'system', after: summary });
  return summary;
}

export async function runDailyJobAs(db: Db, actor: Actor) {
  assertCan(actor, 'RUN_JOBS');
  return runDailyJob(db);
}

/**
 * Demo: flyt systemdatoen frem og kør den daglige kørsel for hver dag
 * imellem, så rykkere, eskaleringer og frister opstår, som de ville i drift.
 */
export async function advanceDemoDate(db: Db, actor: Actor, to: IsoDate) {
  if (!demoEnabled()) throw new DomainError('FORBIDDEN', 'Demo-dato kan kun ændres i demo.');
  if (actor.role === 'AGENT') throw new DomainError('FORBIDDEN', 'Agenter kan ikke ændre systemdatoen.');
  const from = await today(db);
  if (to < from) throw new DomainError('VALIDATION', 'Datoen kan kun flyttes frem – hændelsesloggen er uforanderlig.');
  const days: IsoDate[] = [];
  for (let d = addDays(from, 1); d <= to; d = addDays(d, 1)) days.push(d);
  if (days.length > 120) throw new DomainError('VALIDATION', 'Flyt højst 120 dage ad gangen.');
  const summaries: DailySummary[] = [];
  for (const d of days) {
    await setToday(db, d);
    summaries.push(await runDailyJob(db));
  }
  await appendEvent(db, { objectType: 'Demo', objectId: 'dato', action: 'demo.dato_flyttet', actorId: actor.id, before: { date: from }, after: { date: to } });
  return {
    from, to, days: days.length,
    casesCreated: summaries.reduce((a, s) => a + s.casesCreated, 0),
    remindersSuggested: summaries.reduce((a, s) => a + s.remindersSuggested, 0),
    escalations: summaries.reduce((a, s) => a + s.escalations, 0),
    notifications: summaries.reduce((a, s) => a + s.notifications, 0),
  };
}
