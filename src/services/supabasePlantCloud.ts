import { File } from 'expo-file-system';
import { supabase } from './supabase';
import { createCloudPlantLibrary, type CloudDeps, type CloudRow } from './plantCloud';
import { createSignedUrlCache } from './signedUrlCache';

/*
 * The one place `plantCloud.ts` is bound to the real Supabase client and
 * Storage - mirrors `plantLibrary.ts` binding `plantStore.ts` to
 * `expo-sqlite`. Kept out of `plantCloud.ts` so upload failure, insert
 * failure, and partial-batch behaviour stay testable under `node --test`
 * without a live project.
 *
 * Signed URLs, not public ones: the bucket is private (see the Epic 3a
 * migration), so every read resolves `photo_path` to a fresh signed URL
 * rather than storing one - a permanent public URL would not even resolve
 * against a private bucket, and a signed URL baked into the row would go
 * stale.
 */
const SIGNED_URL_TTL_SECONDS = 60 * 60;

/*
 * Signed URLs for a whole page of rows, in ONE request.
 *
 * This used to be `createSignedUrl` per row inside a Promise.all - thirty
 * plants meant thirty HTTPS round trips before the first photo could paint,
 * repeated on every Portfolio mount because nothing remembered the answers.
 * `createSignedUrls` (plural) signs the batch in a single call, and the cache
 * means a second read inside the hour asks for nothing at all.
 *
 * Failure stays per-path, not per-batch: the API reports an error against each
 * path, and one unreadable photo must not blank out the other twenty-nine.
 */
const urlCache = createSignedUrlCache({ ttlMs: SIGNED_URL_TTL_SECONDS * 1000 });

export function clearSignedUrlCache(): void {
  urlCache.clear();
}

async function resolvePhotoUrls(paths: (string | null)[]): Promise<Map<string, string>> {
  const wanted = paths.filter((p): p is string => Boolean(p));
  const needed = urlCache.missing(wanted);

  if (needed.length > 0) {
    try {
      const { data, error } = await supabase.storage
        .from('plant-photos')
        .createSignedUrls(needed, SIGNED_URL_TTL_SECONDS);
      if (!error && data) {
        for (const row of data) {
          // `path` comes back on each entry; skip the ones the API failed.
          if (row.signedUrl && row.path) urlCache.put(row.path, row.signedUrl);
        }
      }
    } catch {
      /* Same rule as before: an unsigned photo renders as no photo, and must
       * never fail the library read that carries everything else. */
    }
  }

  const out = new Map<string, string>();
  for (const path of wanted) {
    const url = urlCache.get(path);
    if (url) out.set(path, url);
  }
  return out;
}

const deps: CloudDeps = {
  async fetchPlants() {
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user.id;
    if (!userId) return [];

    const { data, error } = await supabase
      .from('plants')
      /* Every column CloudRow declares, as ONE string literal - supabase-js
       * parses it at the type level, and a concatenated expression degrades the
       * result to an unusable type. A field added to CloudRow must be added
       * here too, or it reads null forever. */
      .select(
        'id, user_id, saved_at, photo_path, diagnosis, added_via, catalog_id, species, soil_medium, nickname, last_watered_at, watering_log, last_repotted_at, repot_log, last_fertilized_at, fertilizer_log, reminder_id'
      )
      .eq('user_id', userId)
      .order('saved_at', { ascending: false });
    if (error || !data) return [];

    const rows = data as CloudRow[];
    const urls = await resolvePhotoUrls(rows.map((row) => row.photo_path));
    return rows.map((row) => ({
      ...row,
      photo_path: row.photo_path ? (urls.get(row.photo_path) ?? null) : null,
    }));
  },

  /*
   * Read the file's bytes directly rather than `fetch(uri).blob()`. React
   * Native's Blob is a handle to native-side data with no ArrayBuffer behind
   * it, so supabase-js serialises it to nothing and the "successful" upload
   * stores a null/empty object - which is exactly how every cloud plant ended
   * up with `photo_path: null` and a placeholder thumbnail. `File.bytes()`
   * (expo-file-system 56) hands back a real Uint8Array the client can send.
   */
  async uploadPhoto(path, sourceUri) {
    try {
      const file = new File(sourceUri);
      if (!file.exists) return null;

      const bytes = await file.bytes();
      // A zero-byte read is a failed read, not a photo. Storing it would put a
      // permanently blank image behind a row that claims to have one.
      if (!bytes || bytes.length === 0) return null;

      const { error } = await supabase.storage
        .from('plant-photos')
        .upload(path, bytes, { contentType: file.type || 'image/jpeg', upsert: true });
      if (error) {
        console.warn(`[cloud] photo upload failed: ${error.message}`);
        return null;
      }
      return path;
    } catch (e) {
      console.warn(`[cloud] photo upload threw: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  },

  async insertPlant(row) {
    const { error } = await supabase.from('plants').insert(row);
    return !error;
  },

  async updatePlant(id, patch) {
    const { error } = await supabase.from('plants').update(patch).eq('id', id);
    return !error;
  },

  async deletePlant(id) {
    const { error } = await supabase.from('plants').delete().eq('id', id);
    return !error;
  },
};

export const supabasePlantCloud = createCloudPlantLibrary(deps);
