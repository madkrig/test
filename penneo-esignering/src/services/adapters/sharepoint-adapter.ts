import { createHash } from 'node:crypto';
import { now } from '../clock';
import type { Db } from '../db';
import { DomainError } from '../errors';
import { newId } from '../ids';

export const SHAREPOINT_FOLDER = '/Kunder/{clientId}/E-signering';

export interface SharePointUpload {
  clientId: string;
  fileName: string;
  contentBase64: string;
}

export interface SharePointResult {
  documentId: string;
  url: string;
  integrityHash: string;
}

/** Interface – kan erstattes af en rigtig SharePoint-integration. */
export interface SharePointAdapter {
  uploadSignedDocument(db: Db, upload: SharePointUpload): Promise<SharePointResult>;
}

let simulateFailure = false;
/** Til demo/test af tilstanden "arkivering fejlet". */
export function setSharePointFailure(on: boolean): void {
  simulateFailure = on;
}

export const mockSharePoint: SharePointAdapter = {
  async uploadSignedDocument(db, upload) {
    const folder = SHAREPOINT_FOLDER.replace('{clientId}', upload.clientId);
    const ok = !simulateFailure;
    await db.integrationCall.create({
      data: { id: newId('ic'), system: 'SHAREPOINT', operation: 'uploadSignedDocument', payload: JSON.stringify({ folder, fileName: upload.fileName }), ok, at: now() },
    });
    if (!ok) {
      throw new DomainError('INTEGRATION', 'SharePoint svarede ikke. Dokumentet er underskrevet, men ikke arkiveret.', {
        owner: 'Revisor',
        recovery: 'Prøv arkiveringen igen fra Opgaver.',
      });
    }
    const content = Buffer.from(upload.contentBase64, 'base64');
    const documentId = `SP-${createHash('sha1').update(upload.clientId + upload.fileName + now()).digest('hex').slice(0, 6).toUpperCase()}`;
    return {
      documentId,
      url: `https://sharepoint.cedra.example${folder}/${encodeURIComponent(upload.fileName)}?id=${documentId}`,
      integrityHash: `sha256:${createHash('sha256').update(content).digest('hex')}`,
    };
  },
};
