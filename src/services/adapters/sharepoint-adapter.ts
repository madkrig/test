import { createHash } from 'node:crypto';
import { DEFAULT_CONFIG } from '@/domain/bank-confirmations';
import { now } from '../clock';
import type { Db } from '../db';
import { DomainError } from '../errors';
import { newId } from '../ids';

export interface SharePointUpload {
  customerId: string;
  engagementId: string;
  fileName: string;
  content: string;
}

export interface SharePointResult {
  documentId: string;
  url: string;
  integrityHash: string;
}

/** Interface – kan erstattes af en rigtig SharePoint-integration. */
export interface SharePointAdapter {
  uploadBankResponse(db: Db, upload: SharePointUpload): Promise<SharePointResult>;
}

let simulateFailure = false;
/** Til demo/test af tilstanden "arkivering fejlet". */
export function setSharePointFailure(on: boolean): void {
  simulateFailure = on;
}

export const mockSharePoint: SharePointAdapter = {
  async uploadBankResponse(db, upload) {
    const folder = DEFAULT_CONFIG.sharePoint.folderTemplate
      .replace('{customerId}', upload.customerId)
      .replace('{engagementId}', upload.engagementId);
    const ok = !simulateFailure;
    await db.integrationCall.create({
      data: { id: newId('ic'), system: 'SHAREPOINT', operation: 'uploadBankResponse', payload: JSON.stringify({ folder, fileName: upload.fileName }), ok, at: now() },
    });
    if (!ok) {
      throw new DomainError('INTEGRATION', 'SharePoint svarede ikke. Banksvaret er ikke arkiveret.', {
        owner: 'Kerne',
        recovery: 'Prøv uploaden igen. Opgaven kan ikke afsluttes, før arkiveringen er gennemført.',
      });
    }
    const documentId = `SP-${createHash('sha1').update(upload.engagementId + upload.fileName).digest('hex').slice(0, 6).toUpperCase()}`;
    return {
      documentId,
      url: `https://sharepoint.cedra.example${folder}/${encodeURIComponent(upload.fileName)}?id=${documentId}`,
      integrityHash: `sha256:${createHash('sha256').update(upload.content).digest('hex')}`,
    };
  },
};
