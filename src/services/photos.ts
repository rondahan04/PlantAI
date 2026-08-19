import { Directory, File, Paths } from 'expo-file-system';
import { createPhotoStore, type PhotoDeps } from './photoStore';

/*
 * The one place `expo-file-system` is bound to the photo store, mirroring
 * `plantLibrary.ts`. Keeping it out of `photoStore.ts` is what allows the
 * interesting cases — a purged source, a full disk, a copy that writes nothing
 * — to be tested by `node --test` rather than hoped for on a device.
 *
 * expo-file-system 56 (`File`/`Directory`, not the deprecated functional API):
 * `copy` is async, everything else here is synchronous.
 */
const deviceFs: PhotoDeps = {
  documentDir: Paths.document.uri,

  ensureDir: (uri) => {
    // `idempotent` so a second save does not throw on the directory the first
    // one created.
    new Directory(uri).create({ idempotent: true, intermediates: true });
  },

  exists: (uri) => {
    try {
      return new File(uri).exists;
    } catch {
      // An unreadable or malformed URI is indistinguishable from a missing
      // file as far as every caller here is concerned.
      return false;
    }
  },

  list: (uri) => {
    const directory = new Directory(uri);
    if (!directory.exists) return [];
    return directory.list().map((entry) => entry.name);
  },

  copy: async (from, to) => {
    await new File(from).copy(new File(to));
  },

  remove: (uri) => {
    try {
      const file = new File(uri);
      if (file.exists) file.delete();
    } catch {
      /* best effort — a file we cannot delete is a leak, not a user-facing error */
    }
  },
};

export const plantPhotos = createPhotoStore(deviceFs);
