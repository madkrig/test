import { now } from '../clock';
import type { Db } from '../db';
import { newId } from '../ids';

/** Handlingsorienterede notifikationer – altid med direkte link til handlingen. */
export type NotificationType =
  | 'POPULATION_READY'
  | 'POPULATION_DEADLINE'
  | 'AUTHORIZATION_MISSING'
  | 'READY_TO_SEND'
  | 'RESPONSE_RECEIVED'
  | 'REMINDERS_EXHAUSTED'
  | 'T10_ESCALATION'
  | 'EXCEPTION_DECISION'
  | 'BLOCKED'
  | 'REVIEW_PACKAGE_READY'
  | 'BANK_METHOD_APPROVAL'
  | 'CLARIFICATION_REQUIRED';

export interface NotificationAdapter {
  notify(db: Db, recipient: string, type: NotificationType, message: string, link: string): Promise<void>;
}

export const mockNotifications: NotificationAdapter = {
  async notify(db, recipient, type, message, link) {
    await db.notification.create({ data: { id: newId('nt'), recipient, type, message, link, createdAt: now() } });
  },
};

export const KERNE_QUEUE = 'ROLE:KERNE';
export const SERVICE_OWNER = 'ROLE:SERVICE_OWNER';
