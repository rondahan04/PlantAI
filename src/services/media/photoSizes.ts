import Storage from 'expo-sqlite/kv-store';
import { createPhotoSizeStore, type SizeStorageDeps } from './photoSizeStore';

/*
 * The one place `expo-sqlite` is bound to the photo size store, same split as
 * `plantLibrary` / `plantStore`.
 *
 * The *Sync accessors are required rather than preferred, for the same reason
 * the plant library needs them: this is read during render, to get the FIRST
 * frame right. An async read would answer after the frame it was meant to fix.
 */
const deviceStorage: SizeStorageDeps = {
  getItem: (key) => Storage.getItemSync(key),
  setItem: (key, value) => Storage.setItemSync(key, value),
};

export const photoSizes = createPhotoSizeStore(deviceStorage);
