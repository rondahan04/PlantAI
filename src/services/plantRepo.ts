import type { PlantDiagnosis } from '../types';
import type { PlantStore, StoredPlant, LoadResult } from './plantStore';
import type { CloudPlantLibrary, ImportBatchResult } from './plantCloud';

export type RepoResult<T extends Record<string, unknown> = Record<string, unknown>> =
  | ({ ok: true } & T)
  | { ok: false; reason: 'storage_full' | 'network' | 'not_found' };

export interface RepoDeps {
  guest: PlantStore;
  mirror: PlantStore;
  cloud: CloudPlantLibrary;
  getSessionHint(): boolean;
  getUserId(): string | null;
}

/*
 * The facade every screen uses from Epic 3a on. Logged out: an exact
 * passthrough to `guest` (today's `plantLibrary`), unchanged from before this
 * epic. Logged in: every mutation writes through to `cloud` first and only
 * touches `mirror` if that succeeds - a failed cloud write must not leave the
 * mirror ahead of the account it is supposed to be a cache of.
 */
export function createPlantRepo(deps: RepoDeps) {
  const { guest, mirror, cloud, getSessionHint, getUserId } = deps;

  /*
   * `getSessionHint()` and `getUserId()` are two independently-updated sync
   * caches, each filled in by its own `onAuthStateChange` listener - nothing
   * guarantees they resolve on the same tick after a login. A save that
   * lands in the narrow window where the hint still reads false but the user
   * id has already arrived would otherwise go through `guest.save()`
   * un-flagged: not a failed write, a plant permanently stranded in the
   * guest key, invisible to `cloud`/`mirror` and therefore untouched by
   * `wipeMirror()` or account deletion. Trusting either cache being true is
   * what closes that window - a "yes" from `getUserId()` is just as good
   * evidence of being logged in as a "yes" from `getSessionHint()`.
   */
  function isLoggedIn(): boolean {
    return getSessionHint() || getUserId() !== null;
  }

  function loadLocal(): LoadResult {
    return isLoggedIn() ? mirror.load() : guest.load();
  }

  async function refreshFromCloud(): Promise<LoadResult> {
    const plants = await cloud.fetchAll();
    mirror.replace(plants);
    return mirror.load();
  }

  async function save(input: { photoUri: string; diagnosis: PlantDiagnosis }): Promise<RepoResult<{ plant: StoredPlant }>> {
    if (!isLoggedIn()) {
      const result = guest.save(input);
      return result.ok ? { ok: true, plant: result.plant } : { ok: false, reason: result.reason };
    }

    const userId = getUserId();
    if (!userId) return { ok: false, reason: 'network' };

    const result = await cloud.savePlant(userId, input);
    if (!result.ok) return { ok: false, reason: 'network' };

    /*
     * `savePlant` hands back the row as written, whose `photoUri` is the
     * Storage OBJECT PATH - not something an <Image> can render. Only
     * `fetchAll` resolves paths to signed URLs, so re-read rather than
     * mirroring the raw row: otherwise the plant the user just saved shows a
     * placeholder until the next cold start. A failed refresh falls back to
     * the raw row, which is still a findable plant - the one thing a save
     * must never lose.
     */
    try {
      const refreshed = await refreshFromCloud();
      const resolved = refreshed.plants.find((p) => p.id === result.plant.id);
      if (resolved) return { ok: true, plant: resolved };
    } catch {
      /* fall through to the un-resolved row below */
    }

    mirror.replace([result.plant, ...mirror.load().plants]);
    return { ok: true, plant: result.plant };
  }

  async function markWatered(id: string, at: number): Promise<RepoResult<{ plant: StoredPlant }>> {
    if (!isLoggedIn()) {
      const result = guest.markWatered(id, at);
      return result.ok ? { ok: true, plant: result.plant } : { ok: false, reason: result.reason };
    }

    const current = mirror.load().plants.find((p) => p.id === id);
    if (!current) return { ok: false, reason: 'not_found' };

    const stamp = new Date(at).toISOString();
    const log = [stamp, ...(current.wateringLog ?? [])];
    const cloudResult = await cloud.updatePlant(id, { lastWateredAt: stamp, reminderId: null, wateringLog: log });
    if (!cloudResult.ok) return { ok: false, reason: cloudResult.reason };

    const fresh = mirror.load().plants;
    const latest = fresh.find((p) => p.id === id) ?? current;
    const updated: StoredPlant = { ...latest, lastWateredAt: stamp, wateringLog: log };
    delete updated.reminderId;
    mirror.replace(fresh.map((p) => (p.id === id ? updated : p)));
    return { ok: true, plant: updated };
  }

  async function update(
    id: string,
    patch: Partial<Pick<StoredPlant, 'reminderId'>>
  ): Promise<RepoResult<{ plant: StoredPlant }>> {
    if (!isLoggedIn()) {
      const result = guest.update(id, patch);
      return result.ok ? { ok: true, plant: result.plant } : { ok: false, reason: result.reason };
    }

    const current = mirror.load().plants.find((p) => p.id === id);
    if (!current) return { ok: false, reason: 'not_found' };

    const reminderPatch = 'reminderId' in patch ? { reminderId: patch.reminderId ?? null } : {};
    const cloudResult = await cloud.updatePlant(id, reminderPatch);
    if (!cloudResult.ok) return { ok: false, reason: cloudResult.reason };

    const fresh = mirror.load().plants;
    const latest = fresh.find((p) => p.id === id) ?? current;
    const updated: StoredPlant = { ...latest, ...patch };
    if ('reminderId' in patch && patch.reminderId === undefined) delete updated.reminderId;
    mirror.replace(fresh.map((p) => (p.id === id ? updated : p)));
    return { ok: true, plant: updated };
  }

  async function remove(id: string): Promise<RepoResult> {
    if (!isLoggedIn()) {
      const result = guest.remove(id);
      return result.ok ? { ok: true } : { ok: false, reason: result.reason };
    }

    const cloudResult = await cloud.removePlant(id);
    if (!cloudResult.ok) return { ok: false, reason: cloudResult.reason };

    mirror.replace(mirror.load().plants.filter((p) => p.id !== id));
    return { ok: true };
  }

  function hasUnimportedGuestPlants(): boolean {
    const result = guest.load();
    return result.ok && result.plants.length > 0;
  }

  function guestPlantCount(): number {
    const result = guest.load();
    return result.ok ? result.plants.length : 0;
  }

  /*
   * One-shot import (spec: "declining leaves local storage untouched"). The
   * guest key is cleared ONLY when every plant imported - a partial batch
   * must leave the source data in place so the banner can offer to retry the
   * remainder, never a silent partial clear.
   */
  async function importGuestPlants(): Promise<ImportBatchResult> {
    const userId = getUserId();
    if (!userId) return { imported: [], failed: [] };

    const guestPlants = guest.load().plants;
    const result = await cloud.importBatch(userId, guestPlants);

    if (result.failed.length === 0) {
      guest.replace([]);
      await refreshFromCloud();
    }
    return result;
  }

  /* Logout: the mirror is a cache of an account that is about to be signed
   * out of, and must not leak into a next login on a shared device. The guest
   * key is deliberately untouched - plants saved before logging in were never
   * uploaded anywhere, so clearing them on sign-out would be outright data
   * loss for someone who only meant to switch accounts. */
  function wipeMirror(): void {
    mirror.replace([]);
  }

  /*
   * Account deletion: clear BOTH keys. Unlike sign-out this is the explicit,
   * confirmed "erase me" path, and Home renders guest and cloud plants as one
   * "My Plants" list - so leaving guest records behind after the user deleted
   * their account reads as "the app kept my plants after I told it not to",
   * not as a thoughtful distinction between two storage keys.
   */
  function wipeAllLocal(): void {
    mirror.replace([]);
    guest.replace([]);
  }

  return {
    loadLocal,
    refreshFromCloud,
    save,
    markWatered,
    update,
    remove,
    hasUnimportedGuestPlants,
    guestPlantCount,
    importGuestPlants,
    wipeMirror,
    wipeAllLocal,
  };
}

export type PlantRepo = ReturnType<typeof createPlantRepo>;
