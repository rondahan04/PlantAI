import Storage from 'expo-sqlite/kv-store';
import { createPlantStore, type StorageDeps, LIBRARY_KEY, QUARANTINE_KEY } from './plantStore';

/*
 * The local read cache of a logged-in account's cloud plants - a second
 * binding of the same `createPlantStore` machinery `plantLibrary.ts` uses,
 * under its own key so it is never confused with (or overwrites) a guest
 * library that has not been imported yet.
 */
export const MIRROR_KEY = 'plantai.library.cloudMirror';
const MIRROR_CORRUPT_KEY = `${MIRROR_KEY}.corrupt`;

const mirrorStorage: StorageDeps = {
  getItem: (key) => Storage.getItemSync(remap(key)),
  setItem: (key, value) => Storage.setItemSync(remap(key), value),
  removeItem: (key) => Storage.removeItemSync(remap(key)),
};

// `createPlantStore` addresses its own `LIBRARY_KEY`/`QUARANTINE_KEY`
// constants internally; remap those two onto the mirror's namespace so this
// binding never touches the guest keys.
function remap(key: string): string {
  if (key === LIBRARY_KEY) return MIRROR_KEY;
  if (key === QUARANTINE_KEY) return MIRROR_CORRUPT_KEY;
  return key;
}

export const cloudMirror = createPlantStore(mirrorStorage);

/* Logout (a later task): drop the mirror and its quarantine slot entirely. */
export function wipeCloudMirror(): void {
  Storage.removeItemSync(MIRROR_KEY);
  Storage.removeItemSync(MIRROR_CORRUPT_KEY);
}
