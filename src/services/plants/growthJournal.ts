import Storage from 'expo-sqlite/kv-store';
import { createGrowthStore, type StorageDeps } from './growthStore';

/*
 * The one place `expo-sqlite` is bound to the growth journal, mirroring
 * `plantLibrary.ts`. It lives apart from `growthStore.ts` so that module stays
 * free of native imports and can be exercised by `node --test` without an Expo
 * runtime.
 *
 * The *Sync accessors for the same reason the library uses them: the journal is
 * read while a screen is rendering, and an async read would paint an empty
 * timeline before filling it in - a plant with forty photographs would flash
 * "nothing tracked yet" on every open.
 */
const deviceStorage: StorageDeps = {
  getItem: (key) => Storage.getItemSync(key),
  setItem: (key, value) => Storage.setItemSync(key, value),
  removeItem: (key) => Storage.removeItemSync(key),
};

/* A single shared instance. The store holds no cache - every call reads
 * storage - so this is a convenience, not a singleton with state to corrupt. */
export const growthJournal = createGrowthStore(deviceStorage);
