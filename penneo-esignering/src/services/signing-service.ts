import type { Prisma } from '@prisma/client';
import {
  canTransition,
  defaultDocumentTitle,
  defaultMessage,
  eventKey,
  findService,
  nextStep,
  PENNEO_CASEFILE_STATUS,
  PENNEO_STATUS_LABELS,
  progress,
  ROLE_LABELS,
  SIGNER_STATUS_LABELS,
  SIGNING_SERVICES,
  signersFor,
  STATUS_LABELS,
  type PenneoWebhook,
  type SignerRole,
  type SignerStatus,
  type SigningPerson,
  type SigningService,
  type SigningStatus,
  type User,
} from '@/domain/e-signing';
import { requireAuditor, requireClientAccess, SYSTEM_ACTOR } from './access';
import { adapters } from './adapters';
import { now, today } from './clock';
import { prisma, transaction, type Db } from './db';
import { assertOrThrow, DomainError } from './errors';
import { appendEvent, listEvents } from './event-log';
import { withIdempotency } from './idempotency';
import { newId } from './ids';
import { isPdf, minimalPdf } from './pdf';

const MAX_PDF_BYTES = 10 * 1024 * 1024;
const include = { signers: { orderBy: { sortOrder: 'asc' } }, client: true } as const;
type RequestRow = Prisma.SigningRequestGetPayload<{ include: typeof include }>;

/* ---------------- Visning ---------------- */

function toView(row: RequestRow) {
  const status = row.status as SigningStatus;
  return {
    id: row.id,
    client: { id: row.client.id, name: row.client.name, cvr: row.client.cvr },
    serviceType: row.serviceType,
    serviceLabel: findService(row.serviceType)?.label ?? row.serviceType,
    documentTitle: row.documentTitle,
    fileName: row.fileName,
    status,
    statusLabel: STATUS_LABELS[status],
    progress: progress(row.signers.map((s) => ({ name: s.name, status: s.status as SignerStatus }))),
    signers: row.signers.map((s) => ({
      id: s.id,
      name: s.name,
      email: s.email,
      role: s.role,
      roleLabel: ROLE_LABELS[s.role as SignerRole],
      status: s.status,
      statusLabel: SIGNER_STATUS_LABELS[s.status as SignerStatus],
      signedAt: s.signedAt,
    })),
    nextAction: row.nextAction,
    nextOwner: row.nextOwner,
    archiveFailed: row.archiveFailed,
    penneo: {
      caseFileId: row.penneoCaseFileId,
      documentId: row.penneoDocumentId,
      status: row.penneoStatus,
      statusLabel: row.penneoStatus === null ? null : PENNEO_STATUS_LABELS[row.penneoStatus] ?? null,
    },
    sharePoint: row.sharePointUrl ? { documentId: row.sharePointDocumentId, url: row.sharePointUrl, integrityHash: row.integrityHash } : null,
    requestedById: row.requestedById,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
  };
}

export type SigningRequestView = ReturnType<typeof toView>;

function toPerson(p: { id: string; name: string; email: string | null; role: string; active: boolean }): SigningPerson {
  return { ...p, role: p.role as SignerRole };
}

/* ---------------- Interne byggeklodser ---------------- */

async function loadRequest(db: Db, id: string): Promise<RequestRow> {
  const row = await db.signingRequest.findUnique({ where: { id }, include });
  if (!row) throw new DomainError('NOT_FOUND', 'Underskriftsopgaven findes ikke.');
  return row;
}

function requireService(type: string): SigningService {
  const service = findService(type);
  if (!service) throw new DomainError('VALIDATION', `Ukendt ydelse: ${type}.`);
  return service;
}

async function requireRequestAccess(actor: User, id: string): Promise<RequestRow> {
  const row = await loadRequest(prisma, id);
  if (row.requestedById !== actor.id) await requireClientAccess(prisma, actor, row.clientId);
  return row;
}

/** Genberegner næste handling og ejer ud fra status og underskrivere. */
async function recompute(db: Db, id: string): Promise<SigningRequestView> {
  const row = await loadRequest(db, id);
  const auditor = await db.user.findUnique({ where: { id: row.requestedById } });
  const next = nextStep(
    row.status as SigningStatus,
    row.signers.map((s) => ({ name: s.name, status: s.status as SignerStatus })),
    { archiveFailed: row.archiveFailed, auditorName: auditor?.name ?? 'Revisor' },
  );
  const updated = await db.signingRequest.update({ where: { id }, data: { ...next, updatedAt: now() }, include });
  return toView(updated);
}

async function transition(db: Db, row: RequestRow, to: SigningStatus, actorId: string, data: Prisma.SigningRequestUpdateInput = {}) {
  const from = row.status as SigningStatus;
  const check = canTransition(from, to);
  if (!check.ok) throw new DomainError('INVALID_STATE', check.reason);
  await db.signingRequest.update({ where: { id: row.id }, data: { ...data, status: to, updatedAt: now() } });
  await appendEvent(db, {
    objectType: 'SIGNING_REQUEST', objectId: row.id, requestId: row.id, action: 'STATUS_CHANGED', actorId,
    change: `${STATUS_LABELS[from]} → ${STATUS_LABELS[to]}`,
  });
}

function result(data: SigningRequestView) {
  return { data, nextAction: data.nextAction, nextOwner: data.nextOwner };
}

function slug(text: string): string {
  return text.toLowerCase()
    .replace(/æ/g, 'ae').replace(/ø/g, 'oe').replace(/å/g, 'aa')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function validatePdf(doc: { fileName: string; contentBase64: string }) {
  const content = Buffer.from(doc.contentBase64, 'base64');
  if (!isPdf(content)) throw new DomainError('VALIDATION', 'Dokumentet skal være en PDF.', { recovery: 'Vælg en PDF-fil.' });
  if (content.length > MAX_PDF_BYTES) throw new DomainError('VALIDATION', 'Dokumentet er større end 10 MB.');
  const fileName = doc.fileName.toLowerCase().endsWith('.pdf') ? doc.fileName : `${doc.fileName}.pdf`;
  return { fileName, contentBase64: doc.contentBase64 };
}

function demoDocument(title: string, clientName: string, signers: SigningPerson[]) {
  const pdf = minimalPdf([
    title,
    clientName,
    'Demodokument genereret af prototypen. Syntetiske data.',
    '',
    'Underskrivere:',
    ...signers.map((s) => `${s.name}, ${ROLE_LABELS[s.role]}`),
  ]);
  return { fileName: `${slug(title)}.pdf`, contentBase64: pdf.toString('base64') };
}

/* ---------------- Markedsplads-dialogen ---------------- */

export function listServices() {
  return { data: SIGNING_SERVICES.map((s) => ({ ...s, signerRoleLabels: s.signerRoles.map((r) => ROLE_LABELS[r]) })) };
}

/** Revisors egne kunder til dropdown'en. */
export async function listClients(actor: User) {
  requireAuditor(actor);
  const clients = await prisma.client.findMany({
    where: { responsibleAuditorId: actor.id },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, cvr: true },
  });
  return { data: clients };
}

/** Underskrivere for den valgte ydelse, præcis som de står i kundens stamdata. */
export async function getSigners(actor: User, clientId: string, serviceType: string) {
  requireAuditor(actor);
  const client = await requireClientAccess(prisma, actor, clientId);
  const service = requireService(serviceType);
  const persons = await prisma.signingPerson.findMany({ where: { clientId } });
  const { signers, blockers } = signersFor(service, persons.map(toPerson));
  return {
    data: {
      client: { id: client.id, name: client.name },
      service: { type: service.type, label: service.label },
      signers: signers.map((s) => ({ ...s, roleLabel: ROLE_LABELS[s.role] })),
      blockers,
      documentTitle: defaultDocumentTitle(service, client.name, today()),
      message: defaultMessage(service, client.name),
    },
  };
}

export interface CreateSigningRequestInput {
  clientId: string;
  serviceType: string;
  documentTitle?: string;
  message?: string;
  document?: { fileName: string; contentBase64: string };
}

/**
 * Starter underskriftsforløbet: opretter og sender sagen i Penneo og gemmer
 * opgaven med et øjebliksbillede af underskriverne. Idempotent på
 * Idempotency-Key, så et dobbeltklik ikke opretter to Penneo-sager.
 */
export async function createSigningRequest(actor: User, input: CreateSigningRequestInput, idempotencyKey: string | undefined) {
  const scopedKey = idempotencyKey && `${actor.id}:${idempotencyKey}`;
  return withIdempotency(prisma, scopedKey, 'create-signing-request', async () => {
    requireAuditor(actor);
    const client = await requireClientAccess(prisma, actor, input.clientId);
    const service = requireService(input.serviceType);
    const persons = await prisma.signingPerson.findMany({ where: { clientId: client.id } });
    const { signers, blockers } = signersFor(service, persons.map(toPerson));
    assertOrThrow(blockers, 'Underskriftsforløbet kan ikke startes.', {
      owner: 'Revisor',
      recovery: 'Ret kundens underskrivere i stamdata, og prøv igen.',
    });
    const documentTitle = input.documentTitle?.trim() || defaultDocumentTitle(service, client.name, today());
    const message = input.message?.trim() || defaultMessage(service, client.name);
    const document = input.document ? validatePdf(input.document) : demoDocument(documentTitle, client.name, signers);
    const id = newId('sr');

    const caseFile = await adapters.penneo.createAndSendCaseFile(prisma, {
      title: documentTitle,
      reference: id,
      document: { title: documentTitle, ...document },
      signers: signers.map((s) => ({ ref: s.id, name: s.name, email: s.email!, role: ROLE_LABELS[s.role] })),
      signingRequest: { emailSubject: `Til underskrift: ${documentTitle}`, emailText: message },
    });
    const penneoSignerIds = new Map(caseFile.signers.map((s) => [s.ref, s.signerId]));

    return transaction(async (tx) => {
      const at = now();
      await tx.signingRequest.create({
        data: {
          id,
          clientId: client.id,
          serviceType: service.type,
          documentTitle,
          fileName: document.fileName,
          message,
          status: 'AWAITING_SIGNATURES',
          requestedById: actor.id,
          penneoCaseFileId: caseFile.caseFileId,
          penneoDocumentId: caseFile.documentId,
          penneoStatus: PENNEO_CASEFILE_STATUS.PENDING,
          nextAction: '',
          nextOwner: '',
          createdAt: at,
          updatedAt: at,
          signers: {
            create: signers.map((s, i) => ({
              id: newId('ss'),
              personId: s.id,
              name: s.name,
              email: s.email!,
              role: s.role,
              sortOrder: i,
              penneoSignerId: penneoSignerIds.get(s.id) ?? null,
              status: 'PENDING',
            })),
          },
        },
      });
      await appendEvent(tx, {
        objectType: 'SIGNING_REQUEST', objectId: id, requestId: id, action: 'SENT_TO_PENNEO', actorId: actor.id,
        change: `Penneo-sag #${caseFile.caseFileId} oprettet og sendt til ${signers.length} underskriver(e)`,
      });
      return result(await recompute(tx, id));
    });
  });
}

/* ---------------- Opgaver ---------------- */

export type Scope = 'active' | 'completed' | 'all';

/** Revisors opgaver: egne forløb og forløb på egne kunder, senest ændrede først. */
export async function listSigningRequests(actor: User, scope: Scope = 'all') {
  requireAuditor(actor);
  const rows = await prisma.signingRequest.findMany({
    where: {
      OR: [{ requestedById: actor.id }, { client: { responsibleAuditorId: actor.id } }],
      ...(scope === 'active' ? { status: { not: 'COMPLETED' } } : scope === 'completed' ? { status: 'COMPLETED' } : {}),
    },
    include,
    orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
  });
  return { data: rows.map(toView) };
}

export async function getSigningRequest(actor: User, id: string) {
  requireAuditor(actor);
  const row = await requireRequestAccess(actor, id);
  const [events, users] = await Promise.all([listEvents(prisma, { requestId: id }), prisma.user.findMany()]);
  const names = new Map(users.map((u) => [u.id, u.name]));
  return {
    data: toView(row),
    events: events.map((e) => ({ ...e, actorName: names.get(e.actorId) ?? e.actorId })),
    nextAction: row.nextAction,
    nextOwner: row.nextOwner,
  };
}

/* ---------------- Arkivering ---------------- */

function signedFileName(fileName: string): string {
  return fileName.replace(/\.pdf$/i, '') + '_underskrevet.pdf';
}

/**
 * Henter det forseglede dokument fra Penneo og arkiverer det i SharePoint.
 * Fejl i en integration efterlader opgaven som "Underskrevet" med flag og en
 * genforsøgsknap hos revisor; den ruller ikke underskriften tilbage.
 */
async function archive(id: string, actorId: string): Promise<{ ok: true } | { ok: false; error: DomainError }> {
  const row = await loadRequest(prisma, id);
  try {
    const signed = await adapters.penneo.downloadSignedDocument(prisma, row.penneoDocumentId!);
    const sp = await adapters.sharePoint.uploadSignedDocument(prisma, {
      clientId: row.clientId,
      fileName: signedFileName(row.fileName),
      contentBase64: signed.contentBase64,
    });
    await transaction(async (tx) => {
      await appendEvent(tx, {
        objectType: 'SIGNING_REQUEST', objectId: id, requestId: id, action: 'ARCHIVED', actorId,
        change: `Arkiveret i SharePoint (${sp.documentId})`,
      });
      await transition(tx, row, 'COMPLETED', actorId, {
        archiveFailed: false,
        sharePointDocumentId: sp.documentId,
        sharePointUrl: sp.url,
        integrityHash: sp.integrityHash,
        completedAt: now(),
      });
      await recompute(tx, id);
      await adapters.notifications.notify(tx, row.requestedById, 'DOCUMENT_SIGNED',
        `${row.documentTitle} er underskrevet af alle og arkiveret i SharePoint.`, `/opgaver?id=${id}`);
    });
    return { ok: true };
  } catch (cause) {
    // Enhver fejl efterlader en genforsøgsknap – ellers hænger opgaven i "Arkiveres".
    if (!(cause instanceof DomainError && cause.code === 'INTEGRATION')) console.error(cause);
    const e = cause instanceof DomainError && cause.code === 'INTEGRATION'
      ? cause
      : new DomainError('INTEGRATION', 'Arkiveringen fejlede uventet.', { owner: 'Revisor', recovery: 'Prøv arkiveringen igen fra Opgaver.' });
    await transaction(async (tx) => {
      await tx.signingRequest.update({ where: { id }, data: { archiveFailed: true } });
      await appendEvent(tx, { objectType: 'SIGNING_REQUEST', objectId: id, requestId: id, action: 'ARCHIVE_FAILED', actorId, reason: e.message });
      await recompute(tx, id);
      if (!row.archiveFailed) {
        await adapters.notifications.notify(tx, row.requestedById, 'ARCHIVE_FAILED',
          `${row.documentTitle} er underskrevet, men arkivering i SharePoint fejlede. Prøv igen fra Opgaver.`, `/opgaver?id=${id}`);
      }
    });
    return { ok: false, error: e };
  }
}

export async function retryArchive(actor: User, id: string) {
  requireAuditor(actor);
  const row = await requireRequestAccess(actor, id);
  if (row.status !== 'SIGNED' || !row.archiveFailed) {
    throw new DomainError('INVALID_STATE', 'Opgaven afventer ikke genforsøg af arkivering.');
  }
  const outcome = await archive(id, actor.id);
  if (!outcome.ok) throw outcome.error;
  return result(toView(await loadRequest(prisma, id)));
}

/* ---------------- Penneo-webhooks ---------------- */

export interface WebhookOutcome {
  handled: boolean;
  requestId?: string;
  reason?: string;
}

async function onSignerSigned(penneoSignerId: number): Promise<WebhookOutcome> {
  const signer = await prisma.signingRequestSigner.findFirst({ where: { penneoSignerId }, include: { request: true } });
  if (!signer) return { handled: false, reason: 'Ukendt underskriver' };
  if (signer.status === 'SIGNED' || signer.request.status !== 'AWAITING_SIGNATURES') {
    return { handled: false, requestId: signer.requestId, reason: 'Allerede registreret' };
  }
  await transaction(async (tx) => {
    await tx.signingRequestSigner.update({ where: { id: signer.id }, data: { status: 'SIGNED', signedAt: now() } });
    await appendEvent(tx, {
      objectType: 'SIGNER', objectId: signer.id, requestId: signer.requestId, action: 'SIGNER_SIGNED', actorId: SYSTEM_ACTOR,
      change: `${signer.name} har underskrevet`,
    });
    await recompute(tx, signer.requestId);
  });
  return { handled: true, requestId: signer.requestId };
}

async function onCaseFileCompleted(caseFileId: number): Promise<WebhookOutcome> {
  const row = await prisma.signingRequest.findFirst({ where: { penneoCaseFileId: caseFileId }, include });
  if (!row) return { handled: false, reason: 'Ukendt Penneo-sag' };
  if (row.status !== 'AWAITING_SIGNATURES') return { handled: false, requestId: row.id, reason: 'Allerede afsluttet' };
  await transaction(async (tx) => {
    // Sagen er færdig i Penneo, også hvis en signer-hændelse er gået tabt.
    await tx.signingRequestSigner.updateMany({ where: { requestId: row.id, status: 'PENDING' }, data: { status: 'SIGNED', signedAt: now() } });
    await transition(tx, row, 'SIGNED', SYSTEM_ACTOR, { penneoStatus: PENNEO_CASEFILE_STATUS.COMPLETED });
    await recompute(tx, row.id);
  });
  await archive(row.id, SYSTEM_ACTOR);
  return { handled: true, requestId: row.id };
}

async function onCaseFileRejected(caseFileId: number): Promise<WebhookOutcome> {
  const row = await prisma.signingRequest.findFirst({ where: { penneoCaseFileId: caseFileId }, include });
  if (!row) return { handled: false, reason: 'Ukendt Penneo-sag' };
  if (row.status !== 'AWAITING_SIGNATURES') return { handled: false, requestId: row.id, reason: 'Allerede afsluttet' };
  await transaction(async (tx) => {
    await transition(tx, row, 'REJECTED', SYSTEM_ACTOR, { penneoStatus: PENNEO_CASEFILE_STATUS.REJECTED });
    await recompute(tx, row.id);
    await adapters.notifications.notify(tx, row.requestedById, 'SIGNING_REJECTED',
      `${row.documentTitle} blev afvist i Penneo. Afklar med kunden, og start et nyt forløb.`, `/opgaver?id=${row.id}`);
  });
  return { handled: true, requestId: row.id };
}

/**
 * Modtager Penneos webhooks. Hændelser dedupliceres på x-event-id, og hver
 * handler er desuden idempotent. Ukendte hændelser kvitteres (2xx), så Penneo
 * ikke genforsøger dem.
 */
export async function handlePenneoWebhook(event: PenneoWebhook, eventId: string | undefined): Promise<WebhookOutcome> {
  const key = eventKey(event);
  const run = async (): Promise<WebhookOutcome> => {
    await prisma.integrationCall.create({
      data: { id: newId('ic'), system: 'PENNEO', operation: `webhook:${key}`, payload: JSON.stringify({ eventId, ...event }), ok: true, at: now() },
    });
    switch (key) {
      case 'signer.signed': return onSignerSigned(event.payload.id);
      case 'casefile.completed': return onCaseFileCompleted(event.payload.id);
      case 'casefile.rejected': return onCaseFileRejected(event.payload.id);
      default: return { handled: false, reason: `Hændelsen ${key} bruges ikke` };
    }
  };
  return eventId ? withIdempotency(prisma, eventId, 'penneo-webhook', run) : run();
}

/* ---------------- Notifikationer ---------------- */

export async function listNotifications(actor: User) {
  const data = await prisma.notification.findMany({ where: { recipient: actor.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 20 });
  return { data, unread: data.filter((n) => !n.readAt).length };
}

export async function markNotificationsRead(actor: User) {
  await prisma.notification.updateMany({ where: { recipient: actor.id, readAt: null }, data: { readAt: now() } });
  return listNotifications(actor);
}
