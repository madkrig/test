import { randomInt } from 'node:crypto';
import { now } from '../clock';
import type { Db } from '../db';
import { DomainError } from '../errors';
import { newId } from '../ids';
import { minimalPdf } from '../pdf';

export interface PenneoCaseFileInput {
  title: string;
  /** Vores reference (SigningRequest-id), gemmes som metadata på sagen. */
  reference: string;
  document: { title: string; fileName: string; contentBase64: string };
  /** `ref` er vores id for underskriveren; `role` bliver signaturlinjens rolle. */
  signers: { ref: string; name: string; email: string; role: string }[];
  signingRequest: { emailSubject: string; emailText: string };
}

export interface PenneoCaseFile {
  caseFileId: number;
  documentId: number;
  signers: { ref: string; signerId: number }[];
}

/**
 * Interface mod Penneo – kan erstattes af en rigtig integration (se docs/penneo.md):
 * case file → dokument → underskrivere → signaturlinjer med rolle →
 * signing request (e-mail) → send. Penneo melder tilbage via webhooks.
 */
export interface PenneoAdapter {
  createAndSendCaseFile(db: Db, input: PenneoCaseFileInput): Promise<PenneoCaseFile>;
  /** Det forseglede dokument (base64-PDF). Kun gyldigt, når sagen er completed (5). */
  downloadSignedDocument(db: Db, documentId: number): Promise<{ contentBase64: string }>;
}

let simulateFailure = false;
/** Til test af tilstanden "Penneo svarer ikke". */
export function setPenneoFailure(on: boolean): void {
  simulateFailure = on;
}

async function log(db: Db, operation: string, payload: unknown, ok: boolean) {
  await db.integrationCall.create({
    data: { id: newId('ic'), system: 'PENNEO', operation, payload: JSON.stringify(payload), ok, at: now() },
  });
}

export const mockPenneo: PenneoAdapter = {
  async createAndSendCaseFile(db, input) {
    const ok = !simulateFailure;
    const caseFile: PenneoCaseFile = {
      caseFileId: randomInt(100000, 999999),
      documentId: randomInt(100000, 999999),
      signers: input.signers.map((s) => ({ ref: s.ref, signerId: randomInt(100000, 999999) })),
    };
    await log(db, 'createAndSendCaseFile', {
      title: input.title,
      reference: input.reference,
      document: { title: input.document.title, fileName: input.document.fileName, bytes: Buffer.from(input.document.contentBase64, 'base64').length },
      signers: input.signers.map(({ name, email, role }) => ({ name, email, role })),
      emailSubject: input.signingRequest.emailSubject,
      ...(ok ? { result: caseFile } : {}),
    }, ok);
    if (!ok) {
      throw new DomainError('INTEGRATION', 'Penneo svarede ikke. Underskriftsforløbet er ikke startet.', {
        owner: 'Revisor',
        recovery: 'Prøv igen om lidt. Der er ikke sendt noget til underskriverne.',
      });
    }
    return caseFile;
  },

  async downloadSignedDocument(db, documentId) {
    await log(db, 'downloadSignedDocument', { documentId }, true);
    const pdf = minimalPdf([
      'Underskrevet dokument (demo)',
      `Penneo-dokument #${documentId}`,
      'Forseglet af Penneo-mock. Syntetiske data.',
    ]);
    return { contentBase64: pdf.toString('base64') };
  },
};
