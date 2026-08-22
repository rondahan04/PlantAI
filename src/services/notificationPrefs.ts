import Storage from 'expo-sqlite/kv-store';
import { createNotificationPrefsStore, type StorageDeps } from './notificationPrefsStore';

/* Same split as onboarding.ts - the pure store bound to real device storage. */
const deviceStorage: StorageDeps = {
  getItem: (key) => Storage.getItemSync(key),
  setItem: (key, value) => Storage.setItemSync(key, value),
};

export const notificationPrefs = createNotificationPrefsStore(deviceStorage);
