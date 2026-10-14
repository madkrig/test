import { RULE_CATALOG, workdaysBetween, type IsoDate } from '@/domain/ef';
import { now, today } from './clock';
import { assertCan, type Actor } from './context';
import type { Db } from './db';
import { DomainError } from './errors';
import { appendEvent } from './event-log';
import { newId } from './ids';
import { refreshCustomer } from './readiness';
import { notify } from './work';

/**
 * Bankregister (S09, K4, SOP-EF-10) – erstatter banklister i Excel og Access.
 * Ét register er eneste kilde til kanal, adresse, fuldmagtskrav og SLA.
 * Kanal, kanaladresse og afsenderdomæner ændres kun med 4-øjne.
 */
export const CRITICAL_FIELDS = ['channel', 'channelAddress', 'senderDomains'] as const;
export type CriticalField = (typeof CRITICAL_FIELDS)[number];

export interface InstitutePatch {
  name?: string;
  regNos?: string[];
  channel?: string;
  channelAddress?: string;
  senderDomains?: string[];
  authRequirement?: 'GENEREL' | 'BANKSPECIFIK';
  authMaxAgeMonths?: number | null;
  responseWorkdays?: number;
  seasonDeadline?: string | null;
  earliestSendOffset?: number;
  latestSendOffset?: number | null;
  fee?: string | null;
  bulkFileRule?: string | null;
  source?: string;
}

const serialize = (field: string, value: unknown) => (Array.isArray(value) ? JSON.stringify(value) : String(value ?? ''));

export async function updateInstitute(db: Db, actor: Actor, instituteId: string, patch: InstitutePatch) {
  assertCan(actor, 'EDIT_REGISTER');
  const inst = await db.institute.findUnique({ where: { id: instituteId } });
  if (!inst) throw new DomainError('NOT_FOUND', 'Instituttet findes ikke.');
  const at = await now(db);
  const direct: Record<string, unknown> = {};
  const pending: string[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const current = (inst as Record<string, unknown>)[key];
    const stored = Array.isArray(value) ? JSON.stringify(value) : value;
    if (stored === current) continue;
    if ((CRITICAL_FIELDS as readonly string[]).includes(key)) {
      await db.instituteChange.create({ data: { id: newId('chg'), instituteId, field: key, oldValue: serialize(key, current), newValue: serialize(key, stored), reason: 'Ændring i bankregister', requestedById: actor.id, requestedAt: at, status: 'PENDING' } });
      pending.push(key);
    } else direct[key] = stored;
  }
  if (Object.keys(direct).length) {
    await db.institute.update({ where: { id: instituteId }, data: { ...direct, version: inst.version + 1 } });
    await appendEvent(db, { objectType: 'Institut', objectId: instituteId, action: 'institut.opdateret', actorId: actor.id, before: Object.fromEntries(Object.keys(direct).map((k) => [k, (inst as Record<string, unknown>)[k]])), after: direct });
  }
  if (pending.length) {
    await appendEvent(db, { objectType: 'Institut', objectId: instituteId, action: 'institut.aendring_anmodet', actorId: actor.id, after: { fields: pending }, reason: 'Kræver godkendelse af en anden person (4-øjne)' });
    const leads = await db.user.findMany({ where: { role: 'KL', id: { not: actor.id } } });
    for (const l of leads) await notify(db, { recipientId: l.id, type: 'REGISTER_AENDRING', message: `Ændring af ${pending.join(', ')} for ${inst.name} afventer godkendelse`, link: '/bankregister', channels: ['BRUGERFLADE'] });
  }
  return { applied: Object.keys(direct), pending };
}

export async function decideInstituteChange(db: Db, actor: Actor, changeId: string, approve: boolean) {
  assertCan(actor, 'APPROVE_CHANNEL_CHANGE');
  const change = await db.instituteChange.findUnique({ where: { id: changeId } });
  if (!change) throw new DomainError('NOT_FOUND', 'Ændringen findes ikke.');
  if (change.status !== 'PENDING') throw new DomainError('INVALID_STATE', 'Ændringen er allerede behandlet.');
  if (change.requestedById === actor.id) throw new DomainError('FORBIDDEN', 'Du kan ikke godkende din egen ændring (4-øjne).', { owner: 'En anden kerneteamleder' });
  const at = await now(db);
  await db.instituteChange.update({ where: { id: changeId }, data: { status: approve ? 'APPROVED' : 'REJECTED', decidedById: actor.id, decidedAt: at } });
  const inst = await db.institute.findUniqueOrThrow({ where: { id: change.instituteId } });
  if (approve) {
    await db.institute.update({ where: { id: inst.id }, data: { [change.field]: change.newValue, version: inst.version + 1, verifiedAt: (await today(db)), verifiedById: actor.id } });
    // Ny kanal gælder også forespørgsler, der endnu ikke er sendt.
    if (change.field === 'channel') await db.inquiry.updateMany({ where: { instituteId: inst.id, status: { in: ['KLADDE', 'KLAR'] } }, data: { channel: change.newValue } });
  }
  await appendEvent(db, { objectType: 'Institut', objectId: inst.id, action: approve ? 'institut.aendring_godkendt' : 'institut.aendring_afvist', actorId: actor.id, before: { [change.field]: change.oldValue }, after: { [change.field]: change.newValue }, reason: `Anmodet af ${change.requestedById}` });
  return { ok: true };
}

export async function createInstitute(db: Db, actor: Actor, input: InstitutePatch & { name: string; cvr: string; channel: string; channelAddress: string; responseWorkdays: number }) {
  assertCan(actor, 'EDIT_REGISTER');
  if (await db.institute.findFirst({ where: { cvr: input.cvr } })) throw new DomainError('CONFLICT', 'Et institut med dette CVR-nummer findes allerede.');
  const id = newId('inst');
  await db.institute.create({
    data: {
      id, name: input.name, cvr: input.cvr, regNos: JSON.stringify(input.regNos ?? []), channel: input.channel, channelAddress: input.channelAddress,
      senderDomains: JSON.stringify(input.senderDomains ?? []), authRequirement: input.authRequirement ?? 'GENEREL', authMaxAgeMonths: input.authMaxAgeMonths ?? null,
      responseWorkdays: input.responseWorkdays, seasonDeadline: input.seasonDeadline ?? null, earliestSendOffset: input.earliestSendOffset ?? 1, latestSendOffset: input.latestSendOffset ?? null,
      fee: input.fee ?? null, bulkFileRule: input.bulkFileRule ?? null, source: input.source ?? 'Oprettet manuelt', verifiedAt: '', verifiedById: null,
    },
  });
  await appendEvent(db, { objectType: 'Institut', objectId: id, action: 'institut.oprettet', actorId: actor.id, after: input, reason: 'Skal verificeres af en anden person' });
  return { id };
}

/** Verificering af et institut (SOP-EF-10): en anden end den, der senest ændrede det. */
export async function verifyInstitute(db: Db, actor: Actor, instituteId: string) {
  assertCan(actor, 'EDIT_REGISTER');
  const last = await db.event.findFirst({ where: { objectId: instituteId, action: { in: ['institut.oprettet', 'institut.opdateret'] } }, orderBy: { id: 'desc' } });
  if (last?.actorId === actor.id) throw new DomainError('FORBIDDEN', 'Du ændrede instituttet senest. En anden skal verificere (4-øjne).');
  await db.institute.update({ where: { id: instituteId }, data: { verifiedAt: await today(db), verifiedById: actor.id } });
  await appendEvent(db, { objectType: 'Institut', objectId: instituteId, action: 'institut.verificeret', actorId: actor.id });
  return { ok: true };
}

/** Fusion (fx Spar Nord → Nykredit): det gamle institut bliver inaktivt, og nye banklister bruger det overtagende. */
export async function mergeInstitute(db: Db, actor: Actor, instituteId: string, intoId: string) {
  assertCan(actor, 'APPROVE_CHANNEL_CHANGE');
  if (instituteId === intoId) throw new DomainError('VALIDATION', 'Et institut kan ikke fusioneres med sig selv.');
  const [from, into] = await Promise.all([db.institute.findUnique({ where: { id: instituteId } }), db.institute.findUnique({ where: { id: intoId } })]);
  if (!from || !into) throw new DomainError('NOT_FOUND', 'Instituttet findes ikke.');
  await db.institute.update({ where: { id: instituteId }, data: { mergedIntoId: intoId, active: false, version: from.version + 1 } });
  await appendEvent(db, { objectType: 'Institut', objectId: instituteId, action: 'institut.fusioneret', actorId: actor.id, after: { into: into.name } });
  const affected = await db.inquiry.findMany({ where: { instituteId, status: { in: ['KLADDE', 'KLAR'] } } });
  for (const caseId of new Set(affected.map((i) => i.caseId))) {
    const c = await db.case.findUniqueOrThrow({ where: { id: caseId } });
    await refreshCustomer(db, c.customerId);
  }
  return { ok: true, affectedInquiries: affected.length };
}

/**
 * K4: SLA-historik. Gennemsnitlig afvigelse fra svarfristen i hverdage pr.
 * institut, beregnet automatisk ud fra svarene – bruges til forventet modtagelse.
 */
export async function updateSlaHistory(db: Db) {
  const institutes = await db.institute.findMany();
  for (const inst of institutes) {
    const answered = await db.inquiry.findMany({ where: { instituteId: inst.id, responseDeadline: { not: null }, sentAt: { not: null } } });
    const samples: number[] = [];
    for (const i of answered) {
      const r = await db.response.findFirst({ where: { inquiryId: i.id, senderVerified: true }, orderBy: { receivedAt: 'asc' } });
      if (!r) continue;
      const received = r.receivedAt.slice(0, 10);
      const delay = received > i.responseDeadline! ? workdaysBetween(i.responseDeadline!, received) : -workdaysBetween(received, i.responseDeadline!);
      samples.push(delay);
    }
    if (!samples.length) continue;
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    await db.institute.update({ where: { id: inst.id }, data: { slaDeviationWorkdays: Math.round(avg * 10) / 10, slaSampleSize: samples.length } });
  }
}

// ---------------------------------------------------------------------------
// Regelstyring (S10, 6.8): kun procesejeren; nye versioner med ikrafttrædelse.
// ---------------------------------------------------------------------------

export async function changeRule(db: Db, actor: Actor, ruleId: string, input: { params: Record<string, unknown>; activeFrom: IsoDate; reason: string }) {
  assertCan(actor, 'EDIT_RULES');
  const def = RULE_CATALOG.find((r) => r.ruleId === ruleId);
  if (!def) throw new DomainError('NOT_FOUND', `Reglen ${ruleId} findes ikke.`);
  if (!input.reason.trim()) throw new DomainError('VALIDATION', 'Angiv en begrundelse for ændringen.');
  if (input.activeFrom < (await today(db))) throw new DomainError('VALIDATION', 'Ikrafttrædelsen kan ikke ligge før i dag.', { recovery: 'Regler ændres fremadrettet; igangværende sager bevarer deres regelsæt (6.8).' });
  const reasons: string[] = [];
  for (const [key, expected] of Object.entries(def.params)) {
    const value = input.params[key];
    if (value === undefined) reasons.push(`${key} mangler`);
    else if (Array.isArray(expected) !== Array.isArray(value) || (!Array.isArray(expected) && typeof expected !== typeof value)) reasons.push(`${key} har forkert type`);
    else if (typeof value === 'number' && (value < 0 || !Number.isFinite(value))) reasons.push(`${key} skal være et ikke-negativt tal`);
  }
  for (const key of Object.keys(input.params)) if (!(key in def.params)) reasons.push(`${key} er ikke en parameter i ${ruleId}`);
  if (reasons.length) throw new DomainError('VALIDATION', 'Parametrene er ugyldige.', { reasons });
  const versions = await db.rule.findMany({ where: { ruleId }, orderBy: { version: 'desc' } });
  const current = versions.find((v) => !v.activeTo);
  if (current) await db.rule.update({ where: { id: current.id }, data: { activeTo: input.activeFrom } });
  const version = (versions[0]?.version ?? 0) + 1;
  const id = newId('regel');
  await db.rule.create({ data: { id, ruleId, version, type: def.type, title: def.title, description: def.description, params: JSON.stringify(input.params), activeFrom: input.activeFrom, changedById: actor.id, reason: input.reason.trim() } });
  await appendEvent(db, { objectType: 'Regel', objectId: ruleId, action: 'regel.ny_version', actorId: actor.id, before: current ? JSON.parse(current.params) : def.params, after: { version, params: input.params, activeFrom: input.activeFrom }, reason: input.reason });
  return { version };
}
