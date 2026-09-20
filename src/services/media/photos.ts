import { Directory, File, Paths } from 'expo-file-system';
import { GROWTH_PHOTO_DIR_NAME, createPhotoStore, type PhotoDeps } from './photoStore';

/*
 * The one place `expo-file-system` is bound to the photo store, mirroring
 * `plantLibrary.ts`. Keeping it out of `photoStore.ts` is what allows the
 * interesting cases - a purged source, a full disk, a copy that writes nothing
 * - to be tested by `node --test` rather than hoped for on a device.
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
      /* best effort - a file we cannot delete is a leak, not a user-facing error */
    }
  },
};

export const plantPhotos = createPhotoStore(deviceFs);

/*
 * The growth journal's photographs (`lib/care/growth.ts`), in their own
 * directory and swept against their own keep-list of ENTRY ids.
 *
 * LOCAL ONLY, on purpose and for v1 only. A plant's main photo is uploaded to
 * Storage the moment its owner is signed in; a journal shot is not, so it lives
 * in the document directory for every user and follows the phone rather than
 * the account. That is the same deal `growthStore` makes for the index itself,
 * and the two have to agree: an entry mirrored to the cloud whose file stayed
 * here would render as a permanent broken image on every other device.
 */
export const growthPhotos = createPhotoStore(deviceFs, GROWTH_PHOTO_DIR_NAME);
