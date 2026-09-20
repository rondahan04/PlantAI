import { File } from 'expo-file-system';
import { supabase } from './supabase';
import { createSignedUrlCache } from '../media/signedUrlCache';

/*
 * The avatars bucket: putting a face in it, signing a URL to read it back, and
 * taking it away again.
 *
 * Its own module rather than more surface on `auth.ts`, which is about
 * sessions and rows. This is the Storage half, and it is the half with the two
 * traps in it.
 *
 * TRAP ONE, THE UPLOAD. Read the file's bytes directly rather than
 * `fetch(uri).blob()`. React Native's Blob is a handle to native-side data
 * with no ArrayBuffer behind it, so supabase-js serialises it to nothing and a
 * "successful" upload stores an empty object. That is exactly how every cloud
 * plant once ended up with a null photo and a placeholder thumbnail; the same
 * mistake here would give every account a blank circle it believed was a
 * picture. `File.bytes()` hands back a real Uint8Array.
 *
 * TRAP TWO, THE PATH. A new object path per upload, never a fixed
 * `<uid>/avatar.jpg`. Overwriting one path means the new picture has the same
 * cache key, the same mirror filename and the same signed URL shape as the old
 * one - so every cache in the app, and the CDN in front of the bucket, would go
 * on serving the picture the user just replaced. A fresh name makes a
 * replacement unambiguous everywhere at once, and the old object is deleted
 * after the row has been repointed.
 */

const AVATAR_BUCKET = 'avatars';

/* Matches the TTL used for plant photos; the two are signed the same way and
 * there is no reason for a face to be a different kind of secret. */
const SIGNED_URL_TTL_SECONDS = 60 * 60;

const urlCache = createSignedUrlCache({ ttlMs: SIGNED_URL_TTL_SECONDS * 1000 });

export function clearAvatarUrlCache(): void {
  urlCache.clear();
}

/*
 * A signed URL for an avatar path, or null if it cannot be signed.
 *
 * Never throws. A profile whose picture could not be signed is still a profile
 * worth rendering - the circle falls back to its placeholder, which is what a
 * user with no picture sees anyway.
 */
export async function signAvatar(path: string): Promise<string | null> {
  if (!path) return null;

  const cached = urlCache.get(path);
  if (cached) return cached;

  try {
    const { data, error } = await supabase.storage
      .from(AVATAR_BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) return null;
    urlCache.put(path, data.signedUrl);
    return data.signedUrl;
  } catch {
    return null;
  }
}

/*
 * A path nothing has used before, under the owner's folder.
 *
 * The leading folder is what the bucket's RLS checks against auth.uid(), so it
 * is not decoration - a path that does not start with the user's own id is
 * rejected by the policy rather than silently stored somewhere odd.
 */
function avatarObjectPath(userId: string, extension: string = 'jpg'): string {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return `${userId}/${stamp}.${extension}`;
}

/* The uploaded object's path, or null when nothing was stored. */
export async function uploadAvatar(userId: string, sourceUri: string): Promise<string | null> {
  if (!userId || !sourceUri) return null;

  try {
    const file = new File(sourceUri);
    if (!file.exists) return null;

    const bytes = await file.bytes();
    // A zero-byte read is a failed read, not a photograph. Storing it would
    // put a permanently blank image behind a row that claims to have one.
    if (!bytes || bytes.length === 0) return null;

    const path = avatarObjectPath(userId);
    const { error } = await supabase.storage
      .from(AVATAR_BUCKET)
      .upload(path, bytes, { contentType: file.type || 'image/jpeg', upsert: false });

    if (error) {
      console.warn(`[avatar] upload failed: ${error.message}`);
      return null;
    }
    return path;
  } catch (e) {
    console.warn(`[avatar] upload threw: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

/*
 * Delete an avatar object. Best effort, and deliberately so: this is always
 * called AFTER the profile row has stopped pointing at it, so a failure leaves
 * an orphaned object rather than a broken avatar. `delete_own_account` clears
 * the whole folder, so an orphan cannot outlive the account either.
 */
export async function deleteAvatarObject(path: string | null | undefined): Promise<void> {
  if (!path) return;
  try {
    const { error } = await supabase.storage.from(AVATAR_BUCKET).remove([path]);
    if (error) console.warn(`[avatar] could not remove ${path}: ${error.message}`);
  } catch {
    /* best effort */
  }
}
