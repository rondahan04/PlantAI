import { Directory, File, Paths } from 'expo-file-system';
import { createPhotoMirror, type MirrorDeps } from './photoMirrorStore';

/*
 * The one place `expo-file-system` is bound to the cloud photo mirror, exactly
 * as `photos.ts` binds the guest photo store. Keeping it out of
 * `photoMirrorStore.ts` is what lets `node --test` exercise a download that
 * writes nothing, a move that fails and an unlistable directory.
 *
 * expo-file-system 56 (`File`/`Directory`): `downloadFileAsync` and `move` are
 * async, everything else here is synchronous.
 */
const deviceFs: MirrorDeps = {
  documentDir: Paths.document.uri,

  ensureDir: (uri) => {
    new Directory(uri).create({ idempotent: true, intermediates: true });
  },

  exists: (uri) => {
    try {
      return new File(uri).exists;
    } catch {
      return false;
    }
  },

  list: (uri) => {
    const directory = new Directory(uri);
    if (!directory.exists) return [];
    return directory.list().map((entry) => entry.name);
  },

  download: async (url, destination) => {
    /*
     * `idempotent` so a staging file left by a previous run does not reject the
     * download outright - the store removes it first, but a removal that
     * silently failed must not then block the retry it was clearing the way for.
     */
    await File.downloadFileAsync(url, new File(destination), { idempotent: true });
  },

  move: async (from, to) => {
    const target = new File(to);
    // `move` rejects onto an existing path. The only thing that can be sitting
    // there is an older copy of this same plant's photo, which is precisely
    // what is being replaced.
    if (target.exists) target.delete();
    await new File(from).move(target);
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

export const plantPhotoMirror = createPhotoMirror(deviceFs);

/*
 * The account's avatar, mirrored by the same machinery in its own directory.
 *
 * Separate rather than a reserved id inside the plant mirror: that one is swept
 * against the list of plant ids, and an avatar filed under a plant's name would
 * be deleted by the first sweep that ran. Same reasoning as the separate
 * storage bucket. Keyed on the user id, so there is exactly one file in it.
 */
export const avatarMirror = createPhotoMirror(deviceFs, 'profile-avatar');
