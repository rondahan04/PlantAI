/*
 * Local notification preferences (issue #1 follow-up).
 *
 * Pure, no native imports - same split as onboardingStore/plantStore, so
 * `node --test` can exercise it. Only one real preference exists: whether
 * watering reminders (src/services/wateringReminder.ts) get scheduled at
 * all. "Push notifications" in the UI reflects the OS permission directly
 * and is not stored here - there is nothing else to persist for it.
 */

export const NOTIFICATION_PREFS_KEY = 'plantai.notificationPrefs';

export interface NotificationPrefs {
  wateringRemindersEnabled: boolean;
}

const DEFAULTS: NotificationPrefs = { wateringRemindersEnabled: true };

export interface StorageDeps {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function createNotificationPrefsStore(storage: StorageDeps) {
  function load(): NotificationPrefs {
    let raw: string | null;
    try {
      raw = storage.getItem(NOTIFICATION_PREFS_KEY);
    } catch {
      return DEFAULTS;
    }
    if (raw === null) return DEFAULTS;

    try {
      const parsed = JSON.parse(raw) as Partial<NotificationPrefs>;
      return {
        wateringRemindersEnabled:
          typeof parsed.wateringRemindersEnabled === 'boolean'
            ? parsed.wateringRemindersEnabled
            : DEFAULTS.wateringRemindersEnabled,
      };
    } catch {
      return DEFAULTS;
    }
  }

  function setWateringRemindersEnabled(enabled: boolean): void {
    const next: NotificationPrefs = { ...load(), wateringRemindersEnabled: enabled };
    try {
      storage.setItem(NOTIFICATION_PREFS_KEY, JSON.stringify(next));
    } catch {
      /* best effort - worst case the toggle doesn't stick across a relaunch */
    }
  }

  return { load, setWateringRemindersEnabled };
}

export type NotificationPrefsStore = ReturnType<typeof createNotificationPrefsStore>;
