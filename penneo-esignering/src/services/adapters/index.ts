import { mockNotifications, type NotificationAdapter } from './notification-adapter';
import { mockPenneo, type PenneoAdapter } from './penneo-adapter';
import { mockSharePoint, type SharePointAdapter } from './sharepoint-adapter';

/** Samlet adaptersæt. Prototypen bruger mocks; produktion kan injicere rigtige adaptere. */
export interface Adapters {
  penneo: PenneoAdapter;
  sharePoint: SharePointAdapter;
  notifications: NotificationAdapter;
}

export const adapters: Adapters = {
  penneo: mockPenneo,
  sharePoint: mockSharePoint,
  notifications: mockNotifications,
};

export { setPenneoFailure } from './penneo-adapter';
export { setSharePointFailure } from './sharepoint-adapter';
