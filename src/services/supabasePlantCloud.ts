import { supabase } from './supabase';
import { createCloudPlantLibrary, type CloudDeps, type CloudRow } from './plantCloud';

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

async function resolvePhotoUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  try {
    const { data, error } = await supabase.storage
      .from('plant-photos')
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (error || !data) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}

const deps: CloudDeps = {
  async fetchPlants() {
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user.id;
    if (!userId) return [];

    const { data, error } = await supabase
      .from('plants')
      .select('id, user_id, saved_at, photo_path, diagnosis, last_watered_at, watering_log, reminder_id')
      .eq('user_id', userId)
      .order('saved_at', { ascending: false });
    if (error || !data) return [];

    const rows = data as CloudRow[];
    return Promise.all(
      rows.map(async (row) => ({ ...row, photo_path: await resolvePhotoUrl(row.photo_path) }))
    );
  },

  async uploadPhoto(path, sourceUri) {
    try {
      const response = await fetch(sourceUri);
      const blob = await response.blob();
      const { error } = await supabase.storage
        .from('plant-photos')
        .upload(path, blob, { contentType: blob.type || 'image/jpeg', upsert: true });
      if (error) return null;
      return path;
    } catch {
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
