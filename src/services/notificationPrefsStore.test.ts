import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNotificationPrefsStore, NOTIFICATION_PREFS_KEY } from './notificationPrefsStore.ts';

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

test('defaults to watering reminders enabled with nothing stored', () => {
  const store = createNotificationPrefsStore(memoryStorage());
  assert.equal(store.load().wateringRemindersEnabled, true);
});

test('setWateringRemindersEnabled(false) persists and is read back', () => {
  const storage = memoryStorage();
  const store = createNotificationPrefsStore(storage);
  store.setWateringRemindersEnabled(false);
  assert.equal(store.load().wateringRemindersEnabled, false);
});

test('toggling back on persists too', () => {
  const storage = memoryStorage();
  const store = createNotificationPrefsStore(storage);
  store.setWateringRemindersEnabled(false);
  store.setWateringRemindersEnabled(true);
  assert.equal(store.load().wateringRemindersEnabled, true);
});

test('corrupt JSON falls back to defaults instead of throwing', () => {
  const storage = memoryStorage();
  storage.setItem(NOTIFICATION_PREFS_KEY, 'not json');
  const store = createNotificationPrefsStore(storage);
  assert.equal(store.load().wateringRemindersEnabled, true);
});

test('a storage that throws on read falls back to defaults', () => {
  const store = createNotificationPrefsStore({
    getItem: () => {
      throw new Error('disk error');
    },
    setItem: () => {},
  });
  assert.equal(store.load().wateringRemindersEnabled, true);
});
