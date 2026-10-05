import { now } from '../clock';
import type { Db } from '../db';
import { newId } from '../ids';

/** Handlingsorienterede notifikationer – altid med direkte link til opgaven. */
export type NotificationType = 'DOCUMENT_SIGNED' | 'ARCHIVE_FAILED' | 'SIGNING_REJECTED';

export interface NotificationAdapter {
  notify(db: Db, recipient: string, type: NotificationType, message: string, link: string): Promise<void>;
}

export const mockNotifications: NotificationAdapter = {
  async notify(db, recipient, type, message, link) {
    await db.notification.create({ data: { id: newId('nt'), recipient, type, message, link, createdAt: now() } });
  },
};
