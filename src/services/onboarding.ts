import Storage from 'expo-sqlite/kv-store';
import { createOnboardingStore, type StorageDeps } from './onboardingStore';

/*
 * The one place `expo-sqlite` is bound to the onboarding store - the same
 * split, and for the same reason, as plantLibrary ↔ plantStore: the logic
 * module stays free of native imports so `node --test` can run it.
 *
 * The *Sync accessors are required, not preferred: App.tsx chooses its initial
 * route from this during the first render.
 */
const deviceStorage: StorageDeps = {
  getItem: (key) => Storage.getItemSync(key),
  setItem: (key, value) => Storage.setItemSync(key, value),
  removeItem: (key) => Storage.removeItemSync(key),
};

/* Holds no cache - every call reads storage - so sharing one instance is safe. */
export const onboarding = createOnboardingStore(deviceStorage);
