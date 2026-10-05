import type { PrismaClient } from '@prisma/client';
import type { PopulationSource } from '@/domain/bank-confirmations';
import { loadActor } from '@/services/access';
import * as authorizations from '@/services/authorization-service';
import * as bankConfirmations from '@/services/bank-confirmation-service';
import * as bankTasks from '@/services/bank-task-service';
import { setClock } from '@/services/clock';
import * as completeness from '@/services/completeness-service';
import { resetDatabase } from './reset';

/**
 * Syntetiske prototypedata (brief afsnit 16). Alle navne, CVR-numre og beløb er opdigtede.
 *
 * - "start": udgangspunkt for demo-scriptet (12.11.2026): Nordhavn afventer populationsgodkendelse.
 * - "brief": Nordhavn kørt frem til briefets tilstand (15.01.2027) gennem de rigtige services.
 */
export type SeedState = 'start' | 'brief';

const USERS = [
  ['u-sofie', 'Sofie Lund', 'AUDITOR'],
  ['u-martin', 'Martin Friis', 'AUDITOR'],
  ['u-katrine', 'Katrine Holm', 'AUDITOR'],
  ['u-jonas', 'Jonas Mikkelsen', 'KERNE'],
  ['u-amalie', 'Amalie Sørensen', 'KERNE'],
  ['u-emil', 'Emil Rahbek', 'KERNE'],
  ['u-mia', 'Mia Kragh', 'SERVICE_OWNER'],
  ['u-lars', 'Lars Bech', 'SERVICE_OWNER'],
  ['u-henrik', 'Henrik Dahl', 'METHOD_QUALITY'],
  ['u-admin', 'Systemadministrator', 'SYSTEM_ADMIN'],
  ['system', 'System', 'SYSTEM'],
] as const;

const BANKS = [
  ['danske', 'Danske Bank'], ['sydbank', 'Sydbank'], ['jyske', 'Jyske Bank'],
  ['nordea', 'Nordea'], ['sparnord', 'Spar Nord'], ['arbejdernes', 'Arbejdernes Landsbank'],
] as const;

type MethodSeed = { id: string; bankId: string; version: number; channel: string; url: string; auth: string; days: number; status: string; reviewed: string | null; validFrom: string; reminder: string };

const METHODS: MethodSeed[] = [
  { id: 'm-danske-2', bankId: 'danske', version: 2, channel: 'EMAIL', url: 'revision@danskebank.example', auth: 'GENERAL', days: 10, status: 'RETIRED', reviewed: '2025-06-01', validFrom: '2025-01-01', reminder: 'E-mail' },
  { id: 'm-danske-3', bankId: 'danske', version: 3, channel: 'EMAIL', url: 'revision@danskebank.example', auth: 'GENERAL', days: 10, status: 'ACTIVE', reviewed: '2026-08-14', validFrom: '2026-02-01', reminder: 'E-mail til revisionsteam' },
  { id: 'm-sydbank-2', bankId: 'sydbank', version: 2, channel: 'UPLOAD_PORTAL', url: 'https://revisor.sydbank.example', auth: 'GENERAL', days: 10, status: 'ACTIVE', reviewed: '2026-03-01', validFrom: '2026-03-01', reminder: 'Portalbesked' },
  { id: 'm-jyske-1', bankId: 'jyske', version: 1, channel: 'OTHER', url: 'Jyske Banks særskilte revisorportal', auth: 'BANK_SPECIFIC', days: 15, status: 'ACTIVE', reviewed: '2025-02-02', validFrom: '2025-02-01', reminder: 'Portal + e-mail til erhvervsservice' },
  { id: 'm-nordea-4', bankId: 'nordea', version: 4, channel: 'PLATFORM', url: 'Bekræftelsesplatform', auth: 'GENERAL', days: 8, status: 'ACTIVE', reviewed: '2026-09-20', validFrom: '2026-01-01', reminder: 'Automatisk via platform' },
  { id: 'm-sparnord-1', bankId: 'sparnord', version: 1, channel: 'EMAIL', url: 'revision@sparnord.example', auth: 'GENERAL', days: 10, status: 'ACTIVE', reviewed: '2025-10-01', validFrom: '2025-10-01', reminder: 'E-mail' },
  { id: 'm-sparnord-2', bankId: 'sparnord', version: 2, channel: 'PLATFORM', url: 'Bekræftelsesplatform', auth: 'GENERAL', days: 8, status: 'DRAFT', reviewed: null, validFrom: '2026-12-01', reminder: 'Automatisk via platform' },
  { id: 'm-arbejdernes-1', bankId: 'arbejdernes', version: 1, channel: 'PLATFORM', url: 'Bekræftelsesplatform', auth: 'GENERAL', days: 8, status: 'ACTIVE', reviewed: '2026-05-01', validFrom: '2026-05-01', reminder: 'Automatisk via platform' },
];

type EngSeed = { key: string; name: string; cvr: string; auditor: string; history: boolean; statusDate?: string; deadline?: string; type?: string };

const CUSTOMERS: EngSeed[] = [
  { key: 'nordhavn', name: 'Nordhavn Teknik A/S', cvr: '38472619', auditor: 'u-sofie', history: true },
  { key: 'fjord', name: 'Fjord & Form ApS', cvr: '29751468', auditor: 'u-sofie', history: false },
  { key: 'skovly', name: 'Skovly Foods A/S', cvr: '41620873', auditor: 'u-martin', history: true },
  { key: 'havbryn', name: 'Havbryn Logistik ApS', cvr: '35118204', auditor: 'u-sofie', history: true },
  { key: 'lindegaard', name: 'Lindegaard Arkitekter I/S', cvr: '27690315', auditor: 'u-sofie', history: true },
  { key: 'solbakken', name: 'Solbakken Ejendomme A/S', cvr: '33904127', auditor: 'u-sofie', history: true },
  { key: 'brinkmann', name: 'Brinkmann Gartneri ApS', cvr: '30287561', auditor: 'u-sofie', history: true, statusDate: '2026-11-30', deadline: '2027-01-15', type: 'UDVIDET_GENNEMGANG' },
  { key: 'havbrynholding', name: 'Havbryn Holding ApS', cvr: '40552983', auditor: 'u-martin', history: true },
];

type ItemSeed = [bankId: string, relation: string, sources: PopulationSource[], prior: boolean];

async function population(engagementId: string, auditorId: string, items: ItemSeed[], opts: { submit?: boolean; removed?: [string, string] } = {}) {
  const auditor = await loadActor(prismaRef(), auditorId);
  const kerne = await loadActor(prismaRef(), 'u-jonas');
  const { data } = await bankConfirmations.activate(auditor, engagementId, 'AUDITFLOW');
  for (const [bankId, relationType, sources, prior] of items) {
    await bankConfirmations.addItem(kerne, data.subtaskId, {
      bankId, relationType, sources, priorYearRelation: prior, customerConfirmed: true, change: prior ? 'UNCHANGED' : 'ADDED',
    });
  }
  if (opts.removed) {
    const pop = await bankConfirmations.getPopulation(kerne, data.subtaskId);
    const item = pop.current!.items.find((i) => i.bankId === opts.removed![0])!;
    await bankConfirmations.patchItem(kerne, data.subtaskId, item.id, { change: 'REMOVED', removalReason: opts.removed[1] });
  }
  if (opts.submit !== false) await bankConfirmations.submit(kerne, data.subtaskId);
  return data.subtaskId;
}

let ref: PrismaClient;
const prismaRef = () => ref;

export async function seed(db: PrismaClient, state: SeedState = 'start') {
  ref = db;
  await resetDatabase(db);
  setClock('2026-10-30', '08:00:00');
  await db.user.createMany({ data: USERS.map(([id, name, role]) => ({ id, name, role })) });
  await db.bank.createMany({ data: BANKS.map(([id, name]) => ({ id, name, country: 'DK' })) });
  await db.bankMethodVersion.createMany({
    data: METHODS.map((m) => ({
      id: m.id, bankId: m.bankId, version: m.version, channel: m.channel, urlOrChannel: m.url, requiredFields: JSON.stringify(['CVR', 'Statusdato', 'Kontonumre']),
      authorizationRequirement: m.auth, expectedResponseWorkdays: m.days, reminderMethod: m.reminder, escalationContact: 'Erhvervsservice',
      validFrom: m.validFrom, status: m.status, owner: 'Mia Kragh', lastReviewed: m.reviewed, changeReason: m.version === 1 ? 'Første version' : 'Opdateret kanal',
      newOrChanged: m.status === 'DRAFT', createdBy: 'u-mia', approvedBy: m.status === 'DRAFT' ? null : 'u-lars',
    })),
  });
  for (const c of CUSTOMERS) {
    await db.customer.create({ data: { id: `cust-${c.key}`, name: c.name, cvr: c.cvr, active: true, responsibleAuditorId: c.auditor, contactPerson: 'Økonomichef (syntetisk)', hasHistory: c.history } });
    const statusDate = c.statusDate ?? '2026-12-31';
    await db.engagement.create({
      data: {
        id: `eng-${c.key}-2026`, customerId: `cust-${c.key}`, legalEntity: c.name, statementType: c.type ?? 'REVISION', periodStart: '2026-01-01',
        periodEnd: statusDate, statusDate, active: true, responsibleAuditorId: c.auditor, team: JSON.stringify([c.auditor]), professionalDeadline: c.deadline ?? '2027-02-15',
      },
    });
  }

  // Kunde A – Nordhavn Teknik A/S: tre banker, afventer revisors godkendelse.
  const nordhavn = await population('eng-nordhavn-2026', 'u-sofie', [
    ['danske', 'Konti, garanti', ['PRIOR_YEAR', 'R75'], true],
    ['sydbank', 'Konto, kassekredit', ['ERP'], false],
    ['jyske', 'Konto', ['PRIOR_YEAR', 'R75'], true],
  ]);

  // Portefølje for Sofie Lund.
  await population('eng-havbryn-2026', 'u-sofie', [['danske', 'Konto', ['PRIOR_YEAR'], true], ['nordea', 'Konto', ['PRIOR_YEAR', 'R75'], true]]);
  await population('eng-lindegaard-2026', 'u-sofie', [['sydbank', 'Konto', ['PRIOR_YEAR'], true], ['jyske', 'Konto, lån', ['PRIOR_YEAR'], true], ['nordea', 'Konto', ['PRIOR_YEAR'], true]]);
  const solbakken = await population('eng-solbakken-2026', 'u-sofie', [
    ['danske', 'Konti', ['PRIOR_YEAR'], true], ['jyske', 'Realkredit', ['PRIOR_YEAR'], true], ['nordea', 'Konto', ['PRIOR_YEAR'], true], ['sparnord', 'Konto', ['PRIOR_YEAR'], true],
  ], { removed: ['sparnord', 'Konto lukket marts 2026 (kontoudtog modtaget)'] });
  await db.subtask.update({ where: { id: solbakken }, data: { openQuestions: 1 } });
  await population('eng-brinkmann-2026', 'u-sofie', [['arbejdernes', 'Konto', ['PRIOR_YEAR', 'ERP'], true]]);

  // Kunde C – Skovly Foods A/S: version 1 godkendt, ny bank fundet efter godkendelse → delta version 2.
  setClock('2026-11-10', '10:00:00');
  const skovly = await population('eng-skovly-2026', 'u-martin', [['danske', 'Konto', ['PRIOR_YEAR', 'R75'], true], ['sydbank', 'Konto, kassekredit', ['PRIOR_YEAR'], true]]);
  const martin = await loadActor(db, 'u-martin');
  const skovlyPop = await bankConfirmations.getPopulation(martin, skovly);
  await bankConfirmations.approve(martin, skovly, skovlyPop.current!.id);
  setClock('2026-11-11', '14:00:00');
  await bankConfirmations.createDelta(await loadActor(db, 'u-amalie'), skovly, [{ bankId: 'nordea', relationType: 'Konto', sources: ['R75'] }]);

  // Månedlig kontrol 01.11.2026 finder Fjord & Form (ny kunde) og Havbryn Holding.
  setClock('2026-11-01', '06:00:00');
  const run = await completeness.runControl(await loadActor(db, 'system'), '2026-11-01');
  // Kunde B – Fjord & Form ApS: revisor tilvælger → tomt populationsudkast, afventer kundens bankliste.
  setClock('2026-11-04', '09:30:00');
  const fjordItem = await db.completenessItem.findFirstOrThrow({ where: { runId: run.data.runId, engagementId: 'eng-fjord-2026' } });
  await completeness.decideItem(await loadActor(db, 'u-sofie'), fjordItem.id, 'OPT_IN');
  const fjordSubtask = await db.subtask.findFirstOrThrow({ where: { engagementId: 'eng-fjord-2026' } });
  await db.subtask.update({ where: { id: fjordSubtask.id }, data: { nextAction: 'Indhent kundens samlede bankliste' } });

  setClock('2026-11-12', '09:00:00');
  if (state === 'brief') await advanceNordhavnToBriefState(db, nordhavn);
  return { nordhavn, skovly, fjord: fjordSubtask.id, solbakken };
}

/** Kører Nordhavn gennem de rigtige services frem til briefets beskrevne tilstand. */
async function advanceNordhavnToBriefState(db: PrismaClient, subtaskId: string) {
  const sofie = await loadActor(db, 'u-sofie');
  const jonas = await loadActor(db, 'u-jonas');
  const amalie = await loadActor(db, 'u-amalie');
  const pop = await bankConfirmations.getPopulation(sofie, subtaskId);
  setClock('2026-11-12', '10:40:00');
  await bankConfirmations.approve(sofie, subtaskId, pop.current!.id);
  const tasks = await db.bankTask.findMany({ where: { subtaskId } });
  const byBank = (b: string) => tasks.find((t) => t.bankId === b)!.id;

  setClock('2026-11-20', '09:15:00');
  await authorizations.createAuthorization(jonas, { customerId: 'cust-nordhavn', signer: 'Peter Krogh (direktør)', validFrom: '2026-11-20', validTo: '2027-03-31', coveredBankTaskIds: [byBank('danske'), byBank('sydbank')], status: 'VALID', validationResult: 'Tegningsregel kontrolleret i CVR' });
  await authorizations.createAuthorization(jonas, { customerId: 'cust-nordhavn', signer: 'Peter Krogh (direktør)', validFrom: '2026-11-24', validTo: '2027-03-31', coveredBankTaskIds: [byBank('jyske')], status: 'VALID', bankRequirement: 'Jyske Banks egen fuldmagtsblanket' });

  setClock('2026-12-03', '09:00:00');
  await bankTasks.performFourEyes(amalie, byBank('danske'), jonas.id);
  for (const b of ['danske', 'sydbank', 'jyske']) await bankTasks.send(jonas, byBank(b), `seed-send-${b}`);

  setClock('2027-01-08', '11:02:00');
  await bankTasks.receive(jonas, byBank('danske'), { channel: 'EMAIL', originalFileName: 'Danske_Bank_Nordhavn_2026.pdf' }, 'seed-recv-danske');
  await bankTasks.administrativeCheck(jonas, byBank('danske'), { checks: allChecks, deviations: [], content: 'Danske Bank bekræftelse (syntetisk)' }, 'seed-check-danske');

  setClock('2027-01-12', '13:30:00');
  await bankTasks.receive(jonas, byBank('jyske'), { channel: 'OTHER', originalFileName: 'Jyske_Bank_Nordhavn_2026.pdf' }, 'seed-recv-jyske');
  await bankTasks.administrativeCheck(jonas, byBank('jyske'), { checks: allChecks, deviations: ['Uventet garanti på 2.000.000 kr. stillet over for leverandør'], content: 'Jyske Bank bekræftelse (syntetisk)' }, 'seed-check-jyske');

  setClock('2027-01-15', '08:00:00');
  await bankTasks.remind(await loadActor(db, 'system'), byBank('sydbank'), 'seed-remind-sydbank-1');
}

export const allChecks = { entity: true, bank: true, statusDate: true, reference: true, readable: true, complete: true };
