import {
  addDays, addWorkdays, authUsable, caseTimeline, checkSigners, fuldmagtText, proposeSigners, TEMPLATE_VERSIONS,
  type IsoDate,
} from '@/domain/ef';
import { archive, logCall, penneoCreateCase, penneoRemind } from './adapters';
import { authEvaluation, managementAt } from './auth-check';
import { now, today } from './clock';
import { assertCan, paramsAt, type Actor } from './context';
import type { Db } from './db';
import { DomainError } from './errors';
import { appendEvent } from './event-log';
import { newId } from './ids';
import { refreshCase, refreshCustomer } from './readiness';
import { closeTasks, ensureTask, notify } from './work';

/**
 * Fuldmagtsservice (P04–P05, SOP-EF-03) – erstatter fuldmagter i Word og
 * mail: skabelon (bilag A), Penneo-signering med MitID og automatisk kontrol
 * af underskriverne mod tegningsreglen i CVR (FR-02).
 */

async function loadFuldmagt(db: Db, id: string) {
  const f = await db.fuldmagt.findUnique({ where: { id } });
  if (!f) throw new DomainError('NOT_FOUND', 'Fuldmagten findes ikke.');
  return f;
}

/** Sager for kunden, der venter på fuldmagten – bruges til opgaver og påmindelser. */
async function openCasesFor(db: Db, customerId: string) {
  return db.case.findMany({ where: { customerId, status: { notIn: ['KONKLUDERET', 'LAAST'] } } });
}

/**
 * TR-04: kør fuldmagtskontrollen for en sag og opret OPG-05 med subopgaver,
 * hvis der ikke er en brugbar fuldmagt – også for institutter, der kræver en
 * bankspecifik fuldmagt (FR-01).
 */
export async function ensureAuthTasks(db: Db, caseId: string): Promise<void> {
  const c = await db.case.findUniqueOrThrow({ where: { id: caseId } });
  const date = await today(db);
  const params = await paramsAt(db, c.rulesAsOf);
  const t = caseTimeline(c.balanceDate, c.plannedSignOff, params);
  const general = await authEvaluation(db, c.customerId, null, date, params);
  const lines = await db.bankListLine.findMany({ where: { caseId, included: true } });
  const specific = await db.institute.findMany({ where: { id: { in: lines.map((l) => l.instituteId) }, authRequirement: 'BANKSPECIFIK' } });

  const needs: { scope: 'GENEREL' | 'BANKSPECIFIK'; instituteId: string | null; title: string; rule: string }[] = [];
  if (general.result !== 'GYLDIG') {
    const verb = general.result === 'BOER_FORNYES' ? 'Forny fuldmagt (bør fornyes)' : 'Indhent fuldmagt';
    needs.push({ scope: 'GENEREL', instituteId: null, title: verb, rule: general.ruleId ?? 'TR-04' });
  }
  for (const inst of specific) {
    const e = await authEvaluation(db, c.customerId, inst, date, params);
    if (!authUsable(e.result)) needs.push({ scope: 'BANKSPECIFIK', instituteId: inst.id, title: `Indhent bankspecifik fuldmagt til ${inst.name}`, rule: e.ruleId ?? 'FR-01' });
  }

  for (const need of needs) {
    const pending = await db.fuldmagt.findFirst({
      where: { customerId: c.customerId, scope: need.scope, instituteId: need.instituteId, status: { in: ['UDKAST', 'SENDT_TIL_SIGNERING', 'UNDERSKREVET'] } },
    });
    const parent = await ensureTask(db, {
      caseId, type: 'OPG-05', title: need.title, role: 'KM', assigneeId: c.coreUserId, dueDate: t.authDeadline, createdByRule: need.rule, fuldmagtId: null,
    });
    if (pending) continue;
    // OPG-05.1 og 05.2 udføres af EF-service med det samme: CVR-data hentes, og udkastet dannes.
    const draft = await prepareDraft(db, { customerId: c.customerId, scope: need.scope, instituteId: need.instituteId, actorId: 'system' });
    for (const [type, title] of [['OPG-05.1', 'Hent tegningsregel og ledelse fra CVR'], ['OPG-05.2', 'Generér fuldmagt fra skabelon']] as const) {
      const sub = await ensureTask(db, { caseId, parentId: parent.id, type, title, role: 'SYSTEM', assigneeId: 'system', dueDate: date, createdByRule: 'OPG-05', fuldmagtId: draft.id });
      await closeTasks(db, { type: sub.type, fuldmagtId: draft.id });
    }
    await ensureTask(db, {
      caseId, parentId: parent.id, type: 'OPG-05.3', title: 'Send fuldmagt til signering i Penneo', role: 'KM', assigneeId: c.coreUserId,
      dueDate: addWorkdays(date, 1), createdByRule: 'OPG-05', fuldmagtId: draft.id,
    });
  }
}

/** OPG-05.1–05.2: hent tegningsregel og ledelse fra CVR og dan udkast med foreslåede underskrivere. */
async function prepareDraft(db: Db, input: { customerId: string; scope: 'GENEREL' | 'BANKSPECIFIK'; instituteId: string | null; actorId: string }) {
  const customer = await db.srcCustomer.findUniqueOrThrow({ where: { id: input.customerId } });
  const date = await today(db);
  const params = await paramsAt(db, date);
  const mgmt = await managementAt(db, customer.id, date);
  const proposal = proposeSigners(customer.signingRule, mgmt) ?? [];
  const id = newId('fm');
  await db.fuldmagt.create({
    data: {
      id, customerId: customer.id, cvr: customer.cvr, holderName: params.holderName, holderCvr: params.holderCvr,
      scope: input.scope, instituteId: input.instituteId, status: 'UDKAST', signingRuleSnapshot: customer.signingRule,
      signingSource: 'PENNEO', createdAt: await now(db),
    },
  });
  for (const p of proposal) {
    await db.fuldmagtSigner.create({ data: { id: newId('fs'), fuldmagtId: id, unitNumber: p.unitNumber, name: p.name, role: p.role } });
  }
  await logCall(db, 'CVR', 'hent tegningsregel og ledelse', { cvr: customer.cvr, signingRule: customer.signingRule, persons: mgmt.length });
  await appendEvent(db, {
    objectType: 'Fuldmagt', objectId: id, action: 'fuldmagt.udkast', actorId: input.actorId,
    after: { scope: input.scope, template: TEMPLATE_VERSIONS.fuldmagt, proposedSigners: proposal.map((p) => p.name), signingRule: customer.signingRule },
    reason: proposal.length ? 'Underskrivere foreslået ud fra tegningsreglen (FR-02)' : 'Tegningsreglen kan ikke fortolkes automatisk – vælg underskrivere manuelt',
  });
  return db.fuldmagt.findUniqueOrThrow({ where: { id } });
}

export async function prepareFuldmagt(db: Db, actor: Actor, input: { customerId: string; scope: 'GENEREL' | 'BANKSPECIFIK'; instituteId?: string | null }) {
  assertCan(actor, 'SEND_AUTH');
  const existing = await db.fuldmagt.findFirst({ where: { customerId: input.customerId, scope: input.scope, instituteId: input.instituteId ?? null, status: { in: ['UDKAST', 'SENDT_TIL_SIGNERING'] } } });
  if (existing) return existing;
  return prepareDraft(db, { customerId: input.customerId, scope: input.scope, instituteId: input.instituteId ?? null, actorId: actor.id });
}

/** Fuldmagtsteksten (bilag A) flettet med kundens data og underskrivere. */
export async function fuldmagtDocument(db: Db, fuldmagtId: string): Promise<string> {
  const f = await loadFuldmagt(db, fuldmagtId);
  const customer = await db.srcCustomer.findUniqueOrThrow({ where: { id: f.customerId } });
  const signers = await db.fuldmagtSigner.findMany({ where: { fuldmagtId } });
  const roleLabel: Record<string, string> = { DIREKTOER: 'Direktør', FORMAND: 'Bestyrelsesformand', BESTYRELSESMEDLEM: 'Bestyrelsesmedlem' };
  return fuldmagtText({
    company: customer.name, cvr: customer.cvr, holderName: f.holderName, holderCvr: f.holderCvr,
    date: f.signedDate ?? (await today(db)), signers: signers.map((s) => ({ name: s.name, role: roleLabel[s.role] ?? s.role })),
  });
}

/** OPG-05.3: send til signering. Underskriverne kontrolleres mod tegningsreglen, før kunden får noget. */
export async function sendForSigning(db: Db, actor: Actor, fuldmagtId: string, signerUnits?: string[]) {
  assertCan(actor, 'SEND_AUTH');
  const f = await loadFuldmagt(db, fuldmagtId);
  if (f.status === 'SENDT_TIL_SIGNERING') return f;
  if (f.status !== 'UDKAST') throw new DomainError('INVALID_STATE', 'Kun et udkast kan sendes til signering.', { recovery: 'Dan et nyt udkast fra kundens side i Fuldmagter.' });
  const customer = await db.srcCustomer.findUniqueOrThrow({ where: { id: f.customerId } });
  const date = await today(db);
  const mgmt = await managementAt(db, customer.id, date);
  if (signerUnits) {
    await db.fuldmagtSigner.deleteMany({ where: { fuldmagtId } });
    for (const u of signerUnits) {
      const p = mgmt.find((m) => m.unitNumber === u);
      if (!p) throw new DomainError('VALIDATION', `Personen ${u} er ikke i ledelsen i CVR.`);
      await db.fuldmagtSigner.create({ data: { id: newId('fs'), fuldmagtId, unitNumber: p.unitNumber, name: p.name, role: p.role } });
    }
  }
  const signers = await db.fuldmagtSigner.findMany({ where: { fuldmagtId } });
  if (signers.length === 0) throw new DomainError('VALIDATION', 'Vælg mindst én underskriver.', { recovery: 'Vælg underskrivere efter tegningsreglen.' });
  const check = checkSigners(customer.signingRule, signers.map((s) => s.unitNumber), mgmt);
  if (check.status === 'MANGLER') {
    throw new DomainError('INVALID_STATE', 'Underskriverne opfylder ikke tegningsreglen (FR-02).', {
      reasons: [`Tegningsregel: ${customer.signingRule}`, `Mangler: ${check.missing.join(', ')} (${check.alternative})`],
      recovery: 'Tilføj de manglende underskrivere.',
    });
  }
  const penneo = await penneoCreateCase(db, {
    title: `Fuldmagt – ${customer.name}`,
    signers: signers.map((s) => ({ name: s.name, email: customer.contactEmail })),
    document: await fuldmagtDocument(db, fuldmagtId),
  });
  const at = await now(db);
  await db.fuldmagt.update({ where: { id: fuldmagtId }, data: { status: 'SENDT_TIL_SIGNERING', penneoCaseId: penneo.caseId, sentForSigningAt: at } });
  await appendEvent(db, { objectType: 'Fuldmagt', objectId: fuldmagtId, action: 'fuldmagt.sendt_til_signering', actorId: actor.id, before: { status: 'UDKAST' }, after: { status: 'SENDT_TIL_SIGNERING', penneoCaseId: penneo.caseId, signers: signers.map((s) => s.name) }, reason: check.status === 'MANUEL' ? check.reason : `Opfylder: ${check.alternative}` });
  await closeTasks(db, { type: 'OPG-05.3', fuldmagtId });
  for (const c of await openCasesFor(db, f.customerId)) await refreshCase(db, c.id);
  return db.fuldmagt.findUniqueOrThrow({ where: { id: fuldmagtId } });
}

/** S05 bulk: dan udkast og send til signering for flere kunder i ét hug. */
export async function bulkSendForSigning(db: Db, actor: Actor, customerIds: string[]) {
  assertCan(actor, 'SEND_AUTH');
  const results: { customerId: string; ok: boolean; message: string }[] = [];
  for (const customerId of customerIds) {
    try {
      const draft = await prepareFuldmagt(db, actor, { customerId, scope: 'GENEREL' });
      const sent = await sendForSigning(db, actor, draft.id);
      results.push({ customerId, ok: true, message: `Sendt til signering (${sent.penneoCaseId})` });
    } catch (e) {
      results.push({ customerId, ok: false, message: e instanceof DomainError ? `${e.message} ${(e.details.reasons ?? []).join(' ')}` : 'Uventet fejl' });
    }
  }
  return results;
}

/**
 * Penneo-webhook "underskrevet" (OPG-05.5): underskrivere med MitID
 * kontrolleres automatisk mod tegningsreglen på underskriftsdatoen.
 * I demoen kaldes den fra knappen "Simulér underskrift i Penneo".
 */
export async function penneoSigned(db: Db, fuldmagtId: string, input: { signerUnits?: string[] } = {}) {
  const f = await loadFuldmagt(db, fuldmagtId);
  if (f.status !== 'SENDT_TIL_SIGNERING') throw new DomainError('INVALID_STATE', 'Fuldmagten er ikke sendt til signering.');
  const date = await today(db);
  const at = await now(db);
  const signers = await db.fuldmagtSigner.findMany({ where: { fuldmagtId } });
  const signed = signers.filter((s) => !input.signerUnits || input.signerUnits.includes(s.unitNumber));
  for (const s of signed) await db.fuldmagtSigner.update({ where: { id: s.id }, data: { signedAt: at, mitidVerified: true } });
  await db.fuldmagt.update({ where: { id: fuldmagtId }, data: { status: 'UNDERSKREVET', signedDate: date } });
  await appendEvent(db, { objectType: 'Fuldmagt', objectId: fuldmagtId, action: 'fuldmagt.underskrevet', actorId: 'system', after: { signers: signed.map((s) => s.name), mitid: true }, reason: `Penneo-sag ${f.penneoCaseId}` });
  await closeTasks(db, { type: 'OPG-05.4', fuldmagtId });
  return verifySigners(db, fuldmagtId, { actorId: 'system' });
}

/** FR-02: kontrol af underskrivere mod tegningsreglen på underskriftsdatoen. */
async function verifySigners(db: Db, fuldmagtId: string, opts: { actorId: string; manualApproval?: boolean; note?: string }) {
  const f = await loadFuldmagt(db, fuldmagtId);
  const customer = await db.srcCustomer.findUniqueOrThrow({ where: { id: f.customerId } });
  const signers = await db.fuldmagtSigner.findMany({ where: { fuldmagtId, signedAt: { not: null } } });
  const mgmt = await managementAt(db, customer.id, f.signedDate!);
  const check = checkSigners(customer.signingRule, signers.map((s) => s.unitNumber), mgmt);
  const at = await now(db);
  const cases = await openCasesFor(db, f.customerId);
  const coreUser = cases.find((c) => c.coreUserId)?.coreUserId ?? null;

  if (check.status === 'MANUEL' && !opts.manualApproval) {
    for (const c of cases.slice(0, 1)) {
      await ensureTask(db, { caseId: c.id, type: 'OPG-05.5', title: 'Verificér underskrivere manuelt (tegningsregel kan ikke fortolkes)', role: 'KM', assigneeId: c.coreUserId, dueDate: addWorkdays(f.signedDate!, 1), createdByRule: 'FR-02', fuldmagtId });
    }
    await appendEvent(db, { objectType: 'Fuldmagt', objectId: fuldmagtId, action: 'fuldmagt.manuel_vurdering', actorId: opts.actorId, reason: check.reason });
    return db.fuldmagt.findUniqueOrThrow({ where: { id: fuldmagtId } });
  }
  if (check.status === 'MANGLER') {
    const reason = `Underskriverne opfylder ikke tegningsreglen: mangler ${check.missing.join(', ')} (FR-02).`;
    await db.fuldmagt.update({ where: { id: fuldmagtId }, data: { status: 'UGYLDIG', invalidReason: reason, verifiedAt: at, verifiedById: opts.actorId } });
    await appendEvent(db, { objectType: 'Fuldmagt', objectId: fuldmagtId, action: 'fuldmagt.afvist_ved_verifikation', actorId: opts.actorId, before: { status: f.status }, after: { status: 'UGYLDIG' }, reason });
    await notify(db, { recipientId: coreUser, type: 'FULDMAGT_AFVIST', message: `Fuldmagt for ${customer.name} afvist ved verifikation: ${check.missing.join(', ')} mangler`, link: '/fuldmagter', channels: ['BRUGERFLADE'] });
    for (const c of cases) await ensureAuthTasks(db, c.id);
    await refreshCustomer(db, f.customerId);
    return db.fuldmagt.findUniqueOrThrow({ where: { id: fuldmagtId } });
  }

  // Gyldig: arkivér (FR-08), inaktivér tidligere fuldmagter med samme omfang, og lad sagerne gå videre.
  const ref = await archive(db, { caseId: cases[0]?.id ?? null, kind: 'FULDMAGT', title: `Fuldmagt ${customer.name} (${f.scope.toLowerCase()})`, cvr: customer.cvr, fileName: `Fuldmagt-${customer.cvr}-${f.signedDate}.pdf` });
  await db.fuldmagt.update({ where: { id: fuldmagtId }, data: { status: 'GYLDIG', verifiedAt: at, verifiedById: opts.actorId, documentRef: ref, invalidReason: null } });
  const older = await db.fuldmagt.findMany({ where: { customerId: f.customerId, scope: f.scope, instituteId: f.instituteId, id: { not: fuldmagtId }, status: { in: ['GYLDIG', 'BOER_FORNYES', 'SKAL_FORNYES', 'UDKAST'] } } });
  for (const o of older) {
    await db.fuldmagt.update({ where: { id: o.id }, data: { status: 'INAKTIV' } });
    await appendEvent(db, { objectType: 'Fuldmagt', objectId: o.id, action: 'fuldmagt.erstattet', actorId: 'system', before: { status: o.status }, after: { status: 'INAKTIV' }, reason: `Erstattet af ${fuldmagtId}` });
  }
  await appendEvent(db, {
    objectType: 'Fuldmagt', objectId: fuldmagtId, action: 'fuldmagt.verificeret', actorId: opts.actorId, before: { status: f.status }, after: { status: 'GYLDIG', documentRef: ref },
    reason: opts.manualApproval ? `4-øjne-kontrol (FR-09)${opts.note ? `: ${opts.note}` : ''}` : check.status === 'OK' ? `Opfylder tegningsreglen: ${check.alternative}` : 'Manuel vurdering godkendt',
  });
  await notify(db, { recipientId: coreUser, type: 'FULDMAGT_UNDERSKREVET', message: `Fuldmagt for ${customer.name} er underskrevet og verificeret`, link: '/fuldmagter', channels: ['BRUGERFLADE'] });
  await closeTasks(db, { type: ['OPG-05.5', 'OPG-05.3', 'OPG-05.4'], fuldmagtId });
  for (const c of cases) {
    const params = await paramsAt(db, c.rulesAsOf);
    const scopeOk = f.scope === 'GENEREL' ? (await authEvaluation(db, c.customerId, null, await today(db), params)).result === 'GYLDIG' : true;
    if (scopeOk) await closeTasks(db, { type: 'OPG-05', caseId: c.id });
    await ensureAuthTasks(db, c.id);
  }
  await refreshCustomer(db, f.customerId);
  return db.fuldmagt.findUniqueOrThrow({ where: { id: fuldmagtId } });
}

/** FR-09: fuldmagt underskrevet på papir – uploades og kræver 4-øjne-kontrol. */
export async function uploadManualFuldmagt(
  db: Db,
  actor: Actor,
  input: { customerId: string; signedDate: IsoDate; signerUnits: string[]; scope: 'GENEREL' | 'BANKSPECIFIK'; instituteId?: string | null; fileName: string },
) {
  assertCan(actor, 'SEND_AUTH');
  const customer = await db.srcCustomer.findUniqueOrThrow({ where: { id: input.customerId } });
  const params = await paramsAt(db, await today(db));
  if (input.signedDate > (await today(db))) throw new DomainError('VALIDATION', 'Underskriftsdatoen kan ikke ligge i fremtiden.');
  const mgmt = await managementAt(db, customer.id, input.signedDate);
  const id = newId('fm');
  await db.fuldmagt.create({
    data: {
      id, customerId: customer.id, cvr: customer.cvr, holderName: params.holderName, holderCvr: params.holderCvr, scope: input.scope,
      instituteId: input.instituteId ?? null, status: 'UNDERSKREVET', signedDate: input.signedDate, signingRuleSnapshot: customer.signingRule,
      signingSource: 'MANUEL', uploadedById: actor.id, createdAt: await now(db),
    },
  });
  for (const u of input.signerUnits) {
    const p = mgmt.find((m) => m.unitNumber === u);
    if (!p) throw new DomainError('VALIDATION', `Personen ${u} var ikke i ledelsen på underskriftsdatoen.`);
    await db.fuldmagtSigner.create({ data: { id: newId('fs'), fuldmagtId: id, unitNumber: p.unitNumber, name: p.name, role: p.role, signedAt: `${input.signedDate}T00:00:00` } });
  }
  await appendEvent(db, { objectType: 'Fuldmagt', objectId: id, action: 'fuldmagt.uploadet', actorId: actor.id, after: { fileName: input.fileName, signedDate: input.signedDate, signers: input.signerUnits }, reason: 'Manuelt underskrevet – afventer 4-øjne-kontrol (FR-09)' });
  // Udkast til samme omfang skal ikke længere sendes via Penneo.
  for (const draft of await db.fuldmagt.findMany({ where: { customerId: customer.id, scope: input.scope, instituteId: input.instituteId ?? null, status: 'UDKAST' } })) {
    await closeTasks(db, { type: 'OPG-05.3', fuldmagtId: draft.id }, 'ANNULLERET');
  }
  const cases = await openCasesFor(db, customer.id);
  for (const c of cases.slice(0, 1)) {
    await ensureTask(db, { caseId: c.id, type: 'OPG-05.5', title: '4-øjne: verificér manuelt underskrevet fuldmagt', role: 'KM', assigneeId: null, dueDate: addWorkdays(await today(db), 1), createdByRule: 'FR-09', fuldmagtId: id });
  }
  for (const c of cases) await refreshCase(db, c.id);
  return db.fuldmagt.findUniqueOrThrow({ where: { id } });
}

/** 4-øjne: en anden person end den, der uploadede, godkender eller afviser. */
export async function verifyManualFuldmagt(db: Db, actor: Actor, fuldmagtId: string, input: { approve: boolean; note?: string }) {
  assertCan(actor, 'VERIFY_MANUAL_AUTH');
  const f = await loadFuldmagt(db, fuldmagtId);
  if (f.status !== 'UNDERSKREVET') throw new DomainError('INVALID_STATE', 'Fuldmagten afventer ikke verifikation.');
  if (f.uploadedById === actor.id) {
    throw new DomainError('FORBIDDEN', 'Du har selv uploadet fuldmagten. En anden person skal verificere (4-øjne, FR-09).', { owner: 'En anden kernemedarbejder', recovery: 'Bed en kollega verificere fuldmagten.' });
  }
  if (!input.approve) {
    const reason = `Afvist ved 4-øjne-kontrol${input.note ? `: ${input.note}` : ''}`;
    await db.fuldmagt.update({ where: { id: fuldmagtId }, data: { status: 'UGYLDIG', invalidReason: reason, verifiedById: actor.id, verifiedAt: await now(db) } });
    await appendEvent(db, { objectType: 'Fuldmagt', objectId: fuldmagtId, action: 'fuldmagt.afvist_ved_verifikation', actorId: actor.id, after: { status: 'UGYLDIG' }, reason });
    await closeTasks(db, { type: 'OPG-05.5', fuldmagtId });
    for (const c of await openCasesFor(db, f.customerId)) await ensureAuthTasks(db, c.id);
    await refreshCustomer(db, f.customerId);
    return db.fuldmagt.findUniqueOrThrow({ where: { id: fuldmagtId } });
  }
  const customer = await db.srcCustomer.findUniqueOrThrow({ where: { id: f.customerId } });
  const signers = await db.fuldmagtSigner.findMany({ where: { fuldmagtId } });
  const check = checkSigners(customer.signingRule, signers.map((s) => s.unitNumber), await managementAt(db, customer.id, f.signedDate!));
  if (check.status === 'MANGLER') {
    throw new DomainError('INVALID_STATE', 'Underskriverne opfylder ikke tegningsreglen (FR-02).', { reasons: [`Mangler: ${check.missing.join(', ')}`], recovery: 'Afvis fuldmagten og indhent en ny via Penneo.' });
  }
  return verifySigners(db, fuldmagtId, { actorId: actor.id, manualApproval: true, note: input.note });
}

/** OPG-05.4 / ER-05: påmind kunden via Penneo. */
export async function remindSigners(db: Db, actor: Actor, fuldmagtId: string) {
  assertCan(actor, 'SEND_AUTH');
  const f = await loadFuldmagt(db, fuldmagtId);
  if (f.status !== 'SENDT_TIL_SIGNERING' || !f.penneoCaseId) throw new DomainError('INVALID_STATE', 'Fuldmagten afventer ikke underskrift.');
  await penneoRemind(db, f.penneoCaseId);
  await appendEvent(db, { objectType: 'Fuldmagt', objectId: fuldmagtId, action: 'fuldmagt.paamindelse', actorId: actor.id, reason: 'Påmindelse sendt via Penneo' });
  await closeTasks(db, { type: 'OPG-05.4', fuldmagtId });
  return { ok: true };
}

/** FR-07: tilbagekaldelse stopper åbne forespørgsler; revisor beslutter alternative handlinger. */
export async function revokeFuldmagt(db: Db, actor: Actor, fuldmagtId: string, reason: string) {
  assertCan(actor, 'SEND_AUTH');
  if (!reason.trim()) throw new DomainError('VALIDATION', 'Angiv en begrundelse.');
  const f = await loadFuldmagt(db, fuldmagtId);
  await db.fuldmagt.update({ where: { id: fuldmagtId }, data: { status: 'TILBAGEKALDT', invalidReason: reason } });
  await appendEvent(db, { objectType: 'Fuldmagt', objectId: fuldmagtId, action: 'fuldmagt.tilbagekaldt', actorId: actor.id, before: { status: f.status }, after: { status: 'TILBAGEKALDT' }, reason });
  const params = await paramsAt(db, await today(db));
  for (const c of await openCasesFor(db, f.customerId)) {
    const t = caseTimeline(c.balanceDate, c.plannedSignOff, params);
    const open = await db.inquiry.findMany({ where: { caseId: c.id, status: { in: ['SENDT', 'RYKKET'] } } });
    for (const i of open) {
      await db.inquiry.update({ where: { id: i.id }, data: { status: 'ANNULLERET', cancelReason: 'Fuldmagten er tilbagekaldt (FR-07)', updatedAt: await now(db) } });
      await appendEvent(db, { objectType: 'Forespørgsel', objectId: i.id, caseId: c.id, action: 'forespoergsel.annulleret', actorId: 'system', before: { status: i.status }, after: { status: 'ANNULLERET' }, reason: 'FR-07' });
      await closeTasks(db, { inquiryId: i.id }, 'ANNULLERET');
    }
    await ensureTask(db, { caseId: c.id, type: 'OPG-11', title: 'Alternative handlinger: kunden har tilbagekaldt fuldmagten', role: 'OR', assigneeId: c.responsibleId, dueDate: t.alternativesDeadline, createdByRule: 'FR-07' });
    await notify(db, { recipientId: c.responsibleId, type: 'FULDMAGT_TILBAGEKALDT', message: `Fuldmagten for sagen er tilbagekaldt – vurdér alternative handlinger (ISA 505.8–9)`, link: `/sager/${c.id}`, channels: ['TEAMS', 'BRUGERFLADE'] });
  }
  await refreshCustomer(db, f.customerId);
  return { ok: true };
}

/** ER-05: dagene, hvor kunden påmindes, og dagen, hvor revisor orienteres. */
export function signingFollowUpDays(sentAt: string, params: { authReminderDays: number[]; authEscalationDay: number }) {
  const sent = sentAt.slice(0, 10);
  return { reminders: params.authReminderDays.map((d) => ({ day: d, date: addDays(sent, d) })), escalation: addDays(sent, params.authEscalationDay) };
}

