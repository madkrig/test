import { CHANNEL_LABELS, inquiryLetter, type Channel, type InquiryLetter } from '@/domain/ef';
import { now } from '../clock';
import type { Db } from '../db';
import { newId } from '../ids';

/**
 * Integrationer som mocks bag samme kontrakt, som produktionen får:
 * Microsoft Graph (funktionspostkasse), institutternes webformularer,
 * Excel-bulk, digital platform (Circit), Penneo og SharePoint.
 * Hvert kald logges som et integrationskald, så sporet er komplet (K6).
 */
export async function logCall(db: Db, system: string, operation: string, payload: unknown, ok = true) {
  const id = newId('int');
  await db.integrationCall.create({ data: { id, system, operation, payload: JSON.stringify(payload), ok, at: await now(db) } });
  return id;
}

// ---------------------------------------------------------------------------
// SharePoint – arkiv for fuldmagter, forespørgsler, svar og konklusioner.
// ---------------------------------------------------------------------------
export async function archive(db: Db, input: { caseId: string | null; kind: string; title: string; cvr: string; fileName: string }) {
  const ref = `sharepoint://Engagementsforespoergsler/${input.cvr}/${input.fileName}`;
  await db.document.create({ data: { id: newId('dok'), caseId: input.caseId, kind: input.kind, title: input.title, ref, createdAt: await now(db) } });
  await logCall(db, 'SharePoint', 'arkivér', { ref, kind: input.kind });
  return ref;
}

// ---------------------------------------------------------------------------
// Penneo – signering med MitID (erstatter fuldmagter i Word og mail).
// ---------------------------------------------------------------------------
export async function penneoCreateCase(db: Db, input: { title: string; signers: { name: string; email: string }[]; document: string }) {
  const caseId = `penneo-${Math.floor(100000 + Math.random() * 899999)}`;
  await logCall(db, 'Penneo', 'opret signeringssag', { caseId, title: input.title, signers: input.signers.map((s) => s.name), documentLength: input.document.length });
  return { caseId };
}

export async function penneoRemind(db: Db, penneoCaseId: string) {
  await logCall(db, 'Penneo', 'påmind underskrivere', { caseId: penneoCaseId });
}

// ---------------------------------------------------------------------------
// Kanaladaptere (SOP-EF-04) – én kontrakt for alle kanaler.
// ---------------------------------------------------------------------------
export interface OutboundItem {
  inquiryId: string;
  reference: string;
  company: string;
  cvr: string;
  statementDate: string;
  letter: InquiryLetter;
  fuldmagtRef: string | null;
}

export interface DispatchResult {
  channelUsed: string;
  summary: string;
  fileName: string | null;
  perItem: { inquiryId: string; receipt: string }[];
}

/**
 * Sender en batch til ét institut. Afsenderen er altid funktionspostkassen
 * (Graph med Mail.Send begrænset til postkassen), og referencen står i emne
 * og header, så svaret kan matches automatisk (AR-01).
 */
export async function dispatch(
  db: Db,
  input: { institute: { name: string; channel: string; channelAddress: string; bulkFileRule: string | null }; items: OutboundItem[]; mailbox: string },
): Promise<DispatchResult> {
  const { institute, items } = input;
  const channel = institute.channel as Channel;

  if (channel === 'EMAIL') {
    const perItem = [];
    for (const item of items) {
      const messageId = `graph-${newId('msg').slice(4)}`;
      await logCall(db, 'Graph (funktionspostkasse)', 'sendMail', {
        from: input.mailbox, to: institute.channelAddress, subject: item.letter.subject, header: { 'X-EF-Reference': item.reference }, attachments: item.fuldmagtRef ? [item.fuldmagtRef] : [], messageId,
      });
      perItem.push({ inquiryId: item.inquiryId, receipt: messageId });
    }
    return { channelUsed: 'E-mail via Graph', summary: `${items.length} e-mail(s) sendt fra ${input.mailbox} til ${institute.channelAddress}`, fileName: null, perItem };
  }

  if ((channel === 'WEBFORM' || channel === 'BULKFIL') && institute.bulkFileRule && (items.length > 1 || channel === 'BULKFIL')) {
    // Excel-bulk dannes automatisk: skabelonen udfyldes, fuldmagterne navngives efter instituttets krav og zippes.
    const fileName = `${institute.name.replace(/\s+/g, '-')}-engagementsforespoergsel-${items[0]!.statementDate}.xlsx`;
    const zipEntries = items.map((i) => `CVR no ${i.cvr}.pdf`);
    await logCall(db, `${institute.name} (bulk)`, 'upload bulkfil', { to: institute.channelAddress, fileName, rows: items.map((i) => ({ reference: i.reference, cvr: i.cvr, navn: i.company, dato: i.statementDate })), zip: { name: 'Massebesvarelse.zip', entries: zipEntries } });
    return {
      channelUsed: 'Bulkfil (dannes automatisk)',
      summary: `Skabelon med ${items.length} CVR-numre og Massebesvarelse.zip (${zipEntries.join(', ')}) sendt til ${institute.channelAddress}`,
      fileName,
      perItem: items.map((i) => ({ inquiryId: i.inquiryId, receipt: fileName })),
    };
  }

  if (channel === 'WEBFORM') {
    const perItem = [];
    for (const item of items) {
      const receipt = `KVIT-${Math.floor(1000000 + Math.random() * 8999999)}`;
      await logCall(db, `${institute.name} (webformular)`, 'indsend formular', { url: institute.channelAddress, reference: item.reference, cvr: item.cvr, dato: item.statementDate, receipt });
      perItem.push({ inquiryId: item.inquiryId, receipt });
    }
    return { channelUsed: 'Webformular', summary: `${items.length} formular(er) indsendt – kvitteringer gemt i sagen`, fileName: null, perItem };
  }

  if (channel === 'PLATFORM') {
    const perItem = [];
    for (const item of items) {
      const requestId = `circit-${Math.floor(100000 + Math.random() * 899999)}`;
      await logCall(db, `${institute.name} (platform)`, 'opret bekræftelse', { platform: institute.channelAddress, reference: item.reference, cvr: item.cvr, dato: item.statementDate, requestId });
      perItem.push({ inquiryId: item.inquiryId, receipt: requestId });
    }
    return { channelUsed: 'Digital platform', summary: `${items.length} anmodning(er) oprettet på ${institute.channelAddress}; svaret hentes fra platformen`, fileName: null, perItem };
  }

  // Manuel kanal (fx udenlandsk institut): afsendelsen registreres, dokumentationen ligger i sagen.
  return {
    channelUsed: CHANNEL_LABELS.MANUEL,
    summary: `${items.length} forespørgsel(er) registreret som sendt manuelt til ${institute.channelAddress}`,
    fileName: null,
    perItem: items.map((i) => ({ inquiryId: i.inquiryId, receipt: 'manuel' })),
  };
}

export { inquiryLetter };
