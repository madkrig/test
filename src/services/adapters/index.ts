import { mockAuditFlow, type AuditFlowAdapter } from './auditflow-adapter';
import { mockNotifications, type NotificationAdapter } from './notification-adapter';
import { mockSharePoint, type SharePointAdapter } from './sharepoint-adapter';

/** Samlet adaptersæt. Prototypen bruger mocks; produktion kan injicere rigtige adaptere. */
export interface Adapters {
  auditFlow: AuditFlowAdapter;
  sharePoint: SharePointAdapter;
  notifications: NotificationAdapter;
}

export const adapters: Adapters = {
  auditFlow: mockAuditFlow,
  sharePoint: mockSharePoint,
  notifications: mockNotifications,
};

export { KERNE_QUEUE, SERVICE_OWNER } from './notification-adapter';
export { setSharePointFailure } from './sharepoint-adapter';
