import { now } from '../clock';
import type { Db } from '../db';
import { newId } from '../ids';

export interface AuditFlowStatus {
  subtaskId: string;
  engagementId: string;
  status: string;
  banks: number;
  received: number;
  exceptions: number;
  responseLinks: string[];
}

/** Interface – AuditFlow viser status og links i den faglige kontekst. */
export interface AuditFlowAdapter {
  publishSubtaskStatus(db: Db, status: AuditFlowStatus): Promise<void>;
}

export const mockAuditFlow: AuditFlowAdapter = {
  async publishSubtaskStatus(db, status) {
    await db.integrationCall.create({
      data: { id: newId('ic'), system: 'AUDITFLOW', operation: 'publishSubtaskStatus', payload: JSON.stringify(status), ok: true, at: now() },
    });
  },
};
