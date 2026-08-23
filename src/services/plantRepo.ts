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

  function loadLocal(): LoadResult {
    return getSessionHint() ? mirror.load() : guest.load();
  }

  async function refreshFromCloud(): Promise<LoadResult> {
    const plants = await cloud.fetchAll();
    mirror.replace(plants);
    return mirror.load();
  }

  async function save(input: { photoUri: string; diagnosis: PlantDiagnosis }): Promise<RepoResult<{ plant: StoredPlant }>> {
    if (!getSessionHint()) {
      const result = guest.save(input);
      return result.ok ? { ok: true, plant: result.plant } : { ok: false, reason: result.reason };
    }

    const userId = getUserId();
    if (!userId) return { ok: false, reason: 'network' };

    const result = await cloud.savePlant(userId, input);
    if (!result.ok) return { ok: false, reason: 'network' };

    mirror.replace([result.plant, ...mirror.load().plants]);
    return { ok: true, plant: result.plant };
  }

  async function markWatered(id: string, at: number): Promise<RepoResult<{ plant: StoredPlant }>> {
    if (!getSessionHint()) {
      const result = guest.markWatered(id, at);
      return result.ok ? { ok: true, plant: result.plant } : { ok: false, reason: result.reason };
    }

    const current = mirror.load().plants.find((p) => p.id === id);
    if (!current) return { ok: false, reason: 'not_found' };

    const stamp = new Date(at).toISOString();
    const log = [stamp, ...(current.wateringLog ?? [])];
    const cloudResult = await cloud.updatePlant(id, { lastWateredAt: stamp, reminderId: null, wateringLog: log });
    if (!cloudResult.ok) return { ok: false, reason: cloudResult.reason };

    const updated: StoredPlant = { ...current, lastWateredAt: stamp, wateringLog: log };
    delete updated.reminderId;
    mirror.replace(mirror.load().plants.map((p) => (p.id === id ? updated : p)));
    return { ok: true, plant: updated };
  }

  async function update(
    id: string,
    patch: Partial<Pick<StoredPlant, 'reminderId'>>
  ): Promise<RepoResult<{ plant: StoredPlant }>> {
    if (!getSessionHint()) {
      const result = guest.update(id, patch);
      return result.ok ? { ok: true, plant: result.plant } : { ok: false, reason: result.reason };
    }

    const current = mirror.load().plants.find((p) => p.id === id);
    if (!current) return { ok: false, reason: 'not_found' };

    const cloudResult = await cloud.updatePlant(id, { reminderId: patch.reminderId ?? null });
    if (!cloudResult.ok) return { ok: false, reason: cloudResult.reason };

    const updated: StoredPlant = { ...current, ...patch };
    if ('reminderId' in patch && patch.reminderId === undefined) delete updated.reminderId;
    mirror.replace(mirror.load().plants.map((p) => (p.id === id ? updated : p)));
    return { ok: true, plant: updated };
  }

  async function remove(id: string): Promise<RepoResult> {
    if (!getSessionHint()) {
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
   * out of, and must not leak into a next login on a shared device. */
  function wipeMirror(): void {
    mirror.replace([]);
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
  };
}

export type PlantRepo = ReturnType<typeof createPlantRepo>;
