import Storage from 'expo-sqlite/kv-store';
import { createPlantStore, type StorageDeps } from './plantStore';

/*
 * The one place `expo-sqlite` is bound to the plant store.
 *
 * It lives apart from plantStore.ts so that module stays free of native
 * imports and can be exercised by `node --test` without an Expo runtime - the
 * same reason the scraper keeps `PipelineDeps` separate from its providers.
 *
 * The *Sync accessors are required, not preferred: D8's adaptive Home decides
 * between first-run content and the library during render, so an async read
 * would flash marketing copy at a returning user. `expo-sqlite/kv-store` is
 * AsyncStorage-compatible but adds these synchronous variants, which is the
 * reason it was chosen over AsyncStorage itself.
 */
const deviceStorage: StorageDeps = {
  getItem: (key) => Storage.getItemSync(key),
  setItem: (key, value) => Storage.setItemSync(key, value),
  removeItem: (key) => Storage.removeItemSync(key),
};

/*
 * A single shared instance. The store holds no cache - every call reads
 * storage - so this is a convenience, not a singleton with state to corrupt.
 */
export const plantLibrary = createPlantStore(deviceStorage);
