import { beforeEach, describe, expect, it } from 'vitest';
import * as approveRoute from '@/app/api/bank-confirmations/[id]/population/approve/route';
import * as conclusionRoute from '@/app/api/bank-confirmations/[id]/conclusion/route';
import * as completeSubtaskRoute from '@/app/api/bank-confirmations/[id]/complete/route';
import * as itemsRoute from '@/app/api/bank-confirmations/[id]/population/items/route';
import * as submitRoute from '@/app/api/bank-confirmations/[id]/population/submit/route';
import * as subtaskRoute from '@/app/api/engagements/[id]/bank-confirmations/route';
import * as checkRoute from '@/app/api/bank-tasks/[id]/administrative-check/route';
import * as completeTaskRoute from '@/app/api/bank-tasks/[id]/complete/route';
import * as fourEyesRoute from '@/app/api/bank-tasks/[id]/four-eyes/route';
import * as receiveRoute from '@/app/api/bank-tasks/[id]/receive/route';
import * as remindRoute from '@/app/api/bank-tasks/[id]/remind/route';
import * as sendRoute from '@/app/api/bank-tasks/[id]/send/route';
import * as tasksRoute from '@/app/api/bank-tasks/route';
import * as authRoute from '@/app/api/authorizations/route';
import * as decideRoute from '@/app/api/decisions/[id]/decide/route';
import * as escalationRoute from '@/app/api/jobs/escalation-check/route';
import * as reviewRoute from '@/app/api/review-package/[id]/route';
import * as deltaRoute from '@/app/api/bank-confirmations/[id]/population/delta/route';
import * as eventsRoute from '@/app/api/events/route';
import { prisma } from '@/services';
import { setClock } from '@/services/clock';
import { allChecks, call, reseed } from './helpers';

const sofie = 'u-sofie';
const jonas = 'u-jonas';
const amalie = 'u-amalie';

async function nordhavnPending(subtaskId: string) {
  return prisma.populationVersion.findFirstOrThrow({ where: { subtaskId, status: 'SUBMITTED' } });
}
const tasksOf = (subtaskId: string) => prisma.bankTask.findMany({ where: { subtaskId }, orderBy: { bankId: 'asc' } });

describe('E2E 1 + 5: tilbagevendende kunde med tre banker fra aktivering til reviewpakke', () => {
  let ids: Awaited<ReturnType<typeof reseed>>;
  beforeEach(async () => { ids = await reseed('start'); });

  it('godkendelse opretter præcis én BankTask pr. bank med fastholdt metode', async () => {
    expect(await tasksOf(ids.nordhavn)).toHaveLength(0);
    const v = await nordhavnPending(ids.nordhavn);
    const res = await call(approveRoute, 'POST', '/approve', { user: sofie, params: { id: ids.nordhavn }, body: { versionId: v.id } });
    expect(res.status).toBe(200);
    expect(res.json.data.createdBankTaskIds).toHaveLength(3);
    expect(res.json.nextOwner).toBe('Kerne');
    const tasks = await tasksOf(ids.nordhavn);
    expect(tasks.map((t) => [t.bankId, t.methodVersionId])).toEqual([['danske', 'm-danske-3'], ['jyske', 'm-jyske-1'], ['sydbank', 'm-sydbank-2']]);
    expect(tasks.every((t) => t.sendDate === '2026-12-03')).toBe(true);
    const snapshot = JSON.parse((await prisma.populationVersion.findUniqueOrThrow({ where: { id: v.id } })).approvalSnapshot!);
    expect(snapshot.banks).toHaveLength(3);
  });

  it('Kerne kan ikke godkende populationen', async () => {
    const v = await nordhavnPending(ids.nordhavn);
    const res = await call(approveRoute, 'POST', '/approve', { user: jonas, params: { id: ids.nordhavn }, body: { versionId: v.id } });
    expect(res.status).toBe(403);
    expect(await prisma.event.count({ where: { action: 'ACCESS_DENIED' } })).toBeGreaterThan(0);
  });

  it('kører hele forløbet: autorisation, fire-øjne, udsendelse, svar, kontrol, SharePoint, reviewpakke og afslutning', async () => {
    const v = await nordhavnPending(ids.nordhavn);
    await call(approveRoute, 'POST', '/approve', { user: sofie, params: { id: ids.nordhavn }, body: { versionId: v.id } });
    const [danske, jyske, sydbank] = await tasksOf(ids.nordhavn);

    setClock('2026-12-03');
    // Uden autorisation blokeres udsendelse med konkret årsag.
    const blocked = await call(sendRoute, 'POST', '/send', { user: jonas, params: { id: sydbank!.id }, idempotencyKey: 'k0' });
    expect(blocked.status).toBe(409);
    expect(blocked.json.error.reasons).toContain('Gyldig autorisation, der dækker banken, mangler.');

    const auth = await call(authRoute, 'POST', '/authorizations', {
      user: jonas,
      body: { customerId: 'cust-nordhavn', signer: 'Peter Krogh', validFrom: '2026-11-20', validTo: '2027-03-31', coveredBankTaskIds: [danske!.id, sydbank!.id, jyske!.id], status: 'VALID' },
    });
    expect(auth.json.data.coveredBankTaskIds).toHaveLength(3);

    // E2E 5: manuel e-mail (Danske Bank) blokeres indtil fire-øjne er udført af en anden person.
    const noFourEyes = await call(sendRoute, 'POST', '/send', { user: jonas, params: { id: danske!.id }, idempotencyKey: 'k1' });
    expect(noFourEyes.json.error.reasons).toContain('Fire-øjne-kontrol skal udføres før udsendelse.');
    const self = await call(fourEyesRoute, 'POST', '/four-eyes', { user: jonas, params: { id: danske!.id }, body: { performerId: jonas } });
    expect(self.status).toBe(403);
    expect((await call(fourEyesRoute, 'POST', '/four-eyes', { user: amalie, params: { id: danske!.id }, body: { performerId: jonas } })).status).toBe(200);

    for (const t of [danske!, jyske!, sydbank!]) {
      const r = await call(sendRoute, 'POST', '/send', { user: jonas, params: { id: t.id }, idempotencyKey: `send-${t.id}` });
      expect(r.status).toBe(200);
      expect(r.json.data.status).toBe('AWAITING_BANK');
    }
    // Idempotency: samme nøgle giver samme svar uden ny udsendelse.
    const again = await call(sendRoute, 'POST', '/send', { user: jonas, params: { id: sydbank!.id }, idempotencyKey: `send-${sydbank!.id}` });
    expect(again.status).toBe(200);
    expect(await prisma.event.count({ where: { objectId: sydbank!.id, action: 'REQUEST_SENT' } })).toBe(1);
    // Ny nøgle → dobbelt udsendelse forhindres af domænereglen.
    expect((await call(sendRoute, 'POST', '/send', { user: jonas, params: { id: sydbank!.id }, idempotencyKey: 'other' })).status).toBe(409);

    const subtaskView = await call(subtaskRoute, 'GET', '/x', { user: sofie, params: { id: 'eng-nordhavn-2026' } });
    expect(subtaskView.json.subtask.status).toBe('AWAITING_BANK');
    expect(subtaskView.json.summary).toEqual({ banks: 3, sent: 3, received: 0, exceptions: 0 });

    setClock('2027-01-08');
    for (const t of [danske!, jyske!, sydbank!]) {
      await call(receiveRoute, 'POST', '/receive', { user: jonas, params: { id: t.id }, idempotencyKey: `r-${t.id}`, body: { channel: 'EMAIL', originalFileName: `${t.bankId}.pdf` } });
      const c = await call(checkRoute, 'POST', '/check', { user: jonas, params: { id: t.id }, idempotencyKey: `c-${t.id}`, body: { checks: allChecks, deviations: [] } });
      expect(c.status).toBe(200);
    }
    const sp = await prisma.integrationCall.findMany({ where: { system: 'SHAREPOINT' } });
    expect(sp.filter((c) => c.ok)).toHaveLength(3);

    const pkg = await call(reviewRoute, 'GET', '/review', { user: sofie, params: { id: ids.nordhavn } });
    expect(pkg.json.coverage).toEqual({ banks: 3, received: 3, awaitingBank: 0, exceptions: 0 });
    expect(pkg.json.banks.every((b: { sharePointUrl: string }) => b.sharePointUrl.startsWith('https://sharepoint.cedra.example'))).toBe(true);
    expect((await prisma.subtask.findUniqueOrThrow({ where: { id: ids.nordhavn } })).status).toBe('AWAITING_AUDITOR');

    // Revisor konkluderer; Kerne afslutter operationelt.
    expect((await call(conclusionRoute, 'POST', '/c', { user: sofie, params: { id: ids.nordhavn }, body: { conclusion: 'Bankforhold bekræftet uden bemærkninger.' } })).status).toBe(200);
    expect((await call(completeSubtaskRoute, 'POST', '/c', { user: jonas, params: { id: ids.nordhavn } })).json.error.reasons).toContain('3 bank(er) mangler endelig status.');
    for (const t of [danske!, jyske!, sydbank!]) expect((await call(completeTaskRoute, 'POST', '/c', { user: jonas, params: { id: t.id } })).status).toBe(200);
    const done = await call(completeSubtaskRoute, 'POST', '/c', { user: jonas, params: { id: ids.nordhavn } });
    expect(done.status).toBe(200);
    expect((await prisma.subtask.findUniqueOrThrow({ where: { id: ids.nordhavn } })).status).toBe('COMPLETED');

    // Én hændelseslog for begge visninger.
    const events = await call(eventsRoute, 'GET', `/events?subtaskId=${ids.nordhavn}`, { user: sofie });
    const actions = events.json.map((e: { action: string }) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['APPROVED', 'CREATED', 'FOUR_EYES_APPROVED', 'REQUEST_SENT', 'RESPONSE_RECEIVED', 'ARCHIVED_SHAREPOINT', 'CONCLUSION_RECORDED', 'STATUS_CHANGED']));
  });
});

describe('E2E 2: ny kunde uden historik', () => {
  it('tomt populationsudkast opretter ingen BankTasks før godkendelse', async () => {
    const ids = await reseed('start');
    expect(await tasksOf(ids.fjord)).toHaveLength(0);
    const empty = await call(submitRoute, 'POST', '/submit', { user: jonas, params: { id: ids.fjord } });
    expect(empty.status).toBe(409);
    expect(empty.json.error.reasons[0]).toMatch(/tom/);
    await call(itemsRoute, 'POST', '/items', { user: jonas, params: { id: ids.fjord }, body: { bankId: 'nordea', relationType: 'Konto', sources: ['CUSTOMER'] } });
    await call(itemsRoute, 'POST', '/items', { user: jonas, params: { id: ids.fjord }, body: { bankId: 'sparnord', relationType: 'Kassekredit', sources: ['CUSTOMER'] } });
    // Revisor supplerer med viden fra onboarding.
    expect((await call(submitRoute, 'POST', '/submit', { user: jonas, params: { id: ids.fjord } })).status).toBe(200);
    await call(itemsRoute, 'POST', '/items', { user: sofie, params: { id: ids.fjord }, body: { bankId: 'danske', relationType: 'Leasing', sources: ['AUDITOR'] } });
    expect(await tasksOf(ids.fjord)).toHaveLength(0);
    const v = await nordhavnPending(ids.fjord);
    expect(v.version).toBe(2);
    const res = await call(approveRoute, 'POST', '/approve', { user: sofie, params: { id: ids.fjord }, body: { versionId: v.id } });
    expect(res.json.data.createdBankTaskIds).toHaveLength(3);
  });
});

describe('E2E 3: ny bank efter godkendelse (delta)', () => {
  it('godkender kun deltaet og lader eksisterende opgaver være uændrede', async () => {
    const ids = await reseed('start');
    const before = await tasksOf(ids.skovly);
    expect(before).toHaveLength(2);
    const delta = await prisma.populationVersion.findFirstOrThrow({ where: { subtaskId: ids.skovly, kind: 'DELTA' }, include: { items: true } });
    expect(delta.version).toBe(2);
    expect(delta.items.map((i) => i.bankName)).toEqual(['Nordea']);
    const res = await call(approveRoute, 'POST', '/approve', { user: 'u-martin', params: { id: ids.skovly }, body: { versionId: delta.id } });
    expect(res.json.data.createdBankTaskIds).toHaveLength(1);
    const after = await tasksOf(ids.skovly);
    expect(after).toHaveLength(3);
    for (const t of before) expect(after.find((a) => a.id === t.id)?.updatedAt).toBe(t.updatedAt);
    const nordea = after.find((t) => t.bankId === 'nordea')!;
    expect(nordea.changedAfterApproval).toBe(true);
    const approvals = await prisma.event.findMany({ where: { subtaskId: ids.skovly, action: 'APPROVED' } });
    expect(approvals.map((a) => a.change)).toEqual([expect.stringMatching(/^Version 1/), expect.stringMatching(/^Version 2 \(delta\)/)]);
    // Ingen ny delta oven i en uafklaret version.
    await call(deltaRoute, 'POST', '/delta', { user: jonas, params: { id: ids.skovly }, body: { items: [{ bankId: 'jyske', relationType: 'Konto', sources: ['R75'] }] } });
    const dup = await call(deltaRoute, 'POST', '/delta', { user: jonas, params: { id: ids.skovly }, body: { items: [{ bankId: 'arbejdernes', relationType: 'Konto', sources: ['R75'] }] } });
    expect(dup.status).toBe(409);
  });
});

describe('E2E 4: manglende svar med to påmindelser og T-10-eskalation', () => {
  it('to påmindelser uden revisor, derefter obligatorisk beslutning med tre valg', async () => {
    const ids = await reseed('brief');
    const sydbank = (await tasksOf(ids.nordhavn)).find((t) => t.bankId === 'sydbank')!;
    expect(sydbank.reminderCount).toBe(1);
    const early = await call(remindRoute, 'POST', '/remind', { user: jonas, params: { id: sydbank.id }, idempotencyKey: 'r2-early' });
    expect(early.json.error.reasons[0]).toMatch(/først sendes 22\.01\.2027/);
    setClock('2027-01-22');
    expect((await call(remindRoute, 'POST', '/remind', { user: jonas, params: { id: sydbank.id }, idempotencyKey: 'r2' })).status).toBe(200);
    setClock('2027-01-29');
    const third = await call(remindRoute, 'POST', '/remind', { user: jonas, params: { id: sydbank.id }, idempotencyKey: 'r3' });
    expect(third.json.error.reasons).toContain('Maksimalt 2 standardpåmindelser. Videre håndtering kræver faglig beslutning.');
    // Før T-10: ingen eskalation.
    expect((await call(escalationRoute, 'POST', '/job', { user: 'system' })).json.data.escalated).toEqual([]);
    setClock('2027-02-01');
    const esc = await call(escalationRoute, 'POST', '/job', { user: 'system' });
    expect(esc.json.data.escalated).toEqual([sydbank.id]);
    expect((await call(escalationRoute, 'POST', '/job', { user: 'system' })).json.data.escalated).toEqual([]);
    const decision = await prisma.decision.findFirstOrThrow({ where: { bankTaskId: sydbank.id, type: 'MISSING_RESPONSE' } });
    expect(JSON.parse(decision.options).map((o: { id: string }) => o.id)).toEqual(['WAIT', 'ALTERNATIVE_CONTACT', 'ALTERNATIVE_PROCEDURES']);
    expect(decision.ownerId).toBe(sofie);
    // Ingen automatisk partnereskalation.
    expect(await prisma.notification.count({ where: { recipient: { contains: 'PARTNER' } } })).toBe(0);
    const missingReason = await call(decideRoute, 'POST', '/d', { user: sofie, params: { id: decision.id }, body: { option: 'ALTERNATIVE_PROCEDURES', reason: '' } });
    expect(missingReason.status).toBe(400);
    const decided = await call(decideRoute, 'POST', '/d', { user: sofie, params: { id: decision.id }, body: { option: 'ALTERNATIVE_PROCEDURES', reason: 'Kontoudtog pr. 31.12.2026 indhentes', followUpOwnerId: sofie, followUpDeadline: '2027-02-08' } });
    expect(decided.json.data.status).toBe('AWAITING_KERNE');
    const logged = await prisma.event.findFirstOrThrow({ where: { objectId: decision.id, action: 'DECIDED' } });
    expect(logged.reason).toBe('Kontoudtog pr. 31.12.2026 indhentes');
  });
});

describe('E2E 6: afslutning med åben faglig undtagelse afvises', () => {
  it('konklusion og fuldførelse blokeres med konkrete årsager', async () => {
    const ids = await reseed('brief');
    const conclusion = await call(conclusionRoute, 'POST', '/c', { user: sofie, params: { id: ids.nordhavn }, body: { conclusion: 'OK' } });
    expect(conclusion.status).toBe(409);
    expect(conclusion.json.error.reasons).toEqual(expect.arrayContaining(['2 bank(er) mangler endelig status.', '1 faglig(e) beslutning(er) er ikke truffet.']));
    const complete = await call(completeSubtaskRoute, 'POST', '/c', { user: jonas, params: { id: ids.nordhavn } });
    expect(complete.json.error.reasons).toEqual(expect.arrayContaining(['Faglig undtagelse er ikke behandlet.', 'Revisors faglige konklusion mangler.']));
    const jyske = (await tasksOf(ids.nordhavn)).find((t) => t.bankId === 'jyske')!;
    const completeTask = await call(completeTaskRoute, 'POST', '/c', { user: jonas, params: { id: jyske.id } });
    expect(completeTask.json.error.reasons).toContain('Faglig beslutning afventer revisor.');
  });
});

describe('arbejdskø', () => {
  it('prioriterer og pagineres server-side', async () => {
    await reseed('brief');
    const page1 = await call(tasksRoute, 'GET', '/api/bank-tasks?pageSize=2', { user: jonas });
    expect(page1.json.total).toBe(5);
    expect(page1.json.items).toHaveLength(2);
    const all = await call(tasksRoute, 'GET', '/api/bank-tasks?pageSize=50', { user: jonas });
    const ranks = all.json.items.map((t: { rank: number }) => t.rank);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    expect((await call(tasksRoute, 'GET', '/api/bank-tasks', { user: sofie })).status).toBe(403);
  });
});
