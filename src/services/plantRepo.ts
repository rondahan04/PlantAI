import type { PlantDiagnosis } from '../types';
import type { SoilMediumId } from '../lib/soilMedia';
import type { CareKind, PlantStore, StoredPlant, LoadResult } from './plantStore';
import type { CloudPlantLibrary, ImportBatchResult, ManualInput } from './plantCloud';

/*
 * `careHistory` and `sameDay` re-implemented here rather than imported from
 * plantStore.
 *
 * Not an oversight and not duplication for its own sake: a RUNTIME import
 * across modules needs an explicit `.ts` in the specifier to run under bare
 * `node --test`, and Metro - the bundler this app actually ships with - does
 * not resolve that specifier in production source. plantCloud.ts carries the
 * same note over `photoExtension`. Type-only imports are erased and are fine.
 *
 * The two must stay in step with plantStore's originals: a logged-in tap has to
 * produce the identical record a logged-out one does, since `replace()` writes
 * the mirror verbatim and derives nothing.
 */
const CARE_LAST: Record<CareKind, keyof StoredPlant> = {
  water: 'lastWateredAt',
  repot: 'lastRepottedAt',
  fertilizer: 'lastFertilizedAt',
};
const CARE_LOG: Record<CareKind, keyof StoredPlant> = {
  water: 'wateringLog',
  repot: 'repotLog',
  fertilizer: 'fertilizerLog',
};

function historyOf(plant: StoredPlant, kind: CareKind): string[] {
  const log = (plant[CARE_LOG[kind]] as string[] | undefined) ?? [];
  const last = plant[CARE_LAST[kind]] as string | undefined;
  const all = last && !log.includes(last) ? [last, ...log] : log;
  return all.filter((s) => !Number.isNaN(new Date(s).getTime())).sort((a, b) => (a < b ? 1 : -1));
}

function sameDay(a: string, b: string): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return (
    x.getFullYear() === y.getFullYear() &&
    x.getMonth() === y.getMonth() &&
    x.getDate() === y.getDate()
  );
}

export type RepoResult<T extends Record<string, unknown> = Record<string, unknown>> =
  | ({ ok: true } & T)
  | { ok: false; reason: 'storage_full' | 'network' | 'not_found' };

export interface RepoDeps {
  guest: PlantStore;
  mirror: PlantStore;
  cloud: CloudPlantLibrary;
  /*
   * The guest half of a photo swap: copies a picker's cache URI into storage
   * this app owns. Only `adopt` is needed here, so only `adopt` is asked for -
   * the tests hand over a two-line fake instead of a whole photo store.
   */
  photos: { adopt(id: string, sourceUri: string): Promise<string | null> };
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
  const { guest, mirror, cloud, photos, getSessionHint, getUserId } = deps;

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

  /*
   * The Portfolio tab's hand-added plant, on the same write-through rule as
   * `save`. Kept as its own method rather than folded into `save` with an
   * optional diagnosis, because the two carry different identity and the
   * cloud row records which door the plant came through.
   *
   * No photo re-read after the insert: a hand-added plant frequently has no
   * photo at all, and when it has one `savePlant`'s object path is resolved by
   * the very next `refreshFromCloud` the Portfolio screen runs on focus.
   */
  async function saveManual(input: ManualInput): Promise<RepoResult<{ plant: StoredPlant }>> {
    if (!isLoggedIn()) {
      const result = guest.saveManual(input);
      return result.ok ? { ok: true, plant: result.plant } : { ok: false, reason: result.reason };
    }

    const userId = getUserId();
    if (!userId) return { ok: false, reason: 'network' };

    const result = await cloud.saveManualPlant(userId, input);
    if (!result.ok) return { ok: false, reason: 'network' };

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
    const history = historyOf(current, 'water');
    const log = [
      stamp,
      ...(history[0] && sameDay(history[0], stamp) ? history.slice(1) : history),
    ];
    const cloudResult = await cloud.updatePlant(id, { lastWateredAt: stamp, reminderId: null, wateringLog: log });
    if (!cloudResult.ok) return { ok: false, reason: cloudResult.reason };

    const fresh = mirror.load().plants;
    const latest = fresh.find((p) => p.id === id) ?? current;
    const updated: StoredPlant = { ...latest, lastWateredAt: stamp, wateringLog: log };
    delete updated.reminderId;
    mirror.replace(fresh.map((p) => (p.id === id ? updated : p)));
    return { ok: true, plant: updated };
  }

  /*
   * Repot and feed, the two care kinds that schedule nothing. Watering keeps
   * its own method: it cancels a notification handle and is the only kind the
   * reminder is built on, so collapsing the two would put an OS concern in the
   * path of a plain log entry.
   *
   * The same-day fold is duplicated from `plantStore.markCare` rather than
   * reached through it - the mirror is written with `replace`, which does no
   * derivation, and a logged-in tap must produce the identical record a
   * logged-out one does.
   */
  async function markCare(
    id: string,
    kind: Exclude<CareKind, 'water'>,
    at: number
  ): Promise<RepoResult<{ plant: StoredPlant }>> {
    if (!isLoggedIn()) {
      const result = guest.markCare(id, kind, at);
      return result.ok ? { ok: true, plant: result.plant } : { ok: false, reason: result.reason };
    }

    const current = mirror.load().plants.find((p) => p.id === id);
    if (!current) return { ok: false, reason: 'not_found' };

    const stamp = new Date(at).toISOString();
    const history = historyOf(current, kind);
    const log = [stamp, ...(history[0] && sameDay(history[0], stamp) ? history.slice(1) : history)];

    const cloudPatch =
      kind === 'repot'
        ? { lastRepottedAt: stamp, repotLog: log }
        : { lastFertilizedAt: stamp, fertilizerLog: log };
    const cloudResult = await cloud.updatePlant(id, cloudPatch);
    if (!cloudResult.ok) return { ok: false, reason: cloudResult.reason };

    const fresh = mirror.load().plants;
    const latest = fresh.find((p) => p.id === id) ?? current;
    const updated: StoredPlant =
      kind === 'repot'
        ? { ...latest, lastRepottedAt: stamp, repotLog: log }
        : { ...latest, lastFertilizedAt: stamp, fertilizerLog: log };
    mirror.replace(fresh.map((p) => (p.id === id ? updated : p)));
    return { ok: true, plant: updated };
  }

  /*
   * Replace a plant's photograph.
   *
   * Kept out of `update` because a photo is not a field: guest photos live as
   * files this device owns, cloud photos as objects in a private bucket whose
   * paths only `refreshFromCloud` can turn into renderable signed URLs. One
   * method, two genuinely different stories, rather than an `update` that
   * silently means something different depending on who is signed in.
   *
   * `adopt` is the guest half - it copies the picker's cache URI into the app's
   * own directory, because a cache URI is deleted by the OS whenever it likes
   * and a plant whose photo vanished next week is worse than one with none.
   */
  async function setPhoto(id: string, sourceUri: string): Promise<RepoResult<{ plant: StoredPlant }>> {
    if (!isLoggedIn()) {
      const adopted = await photos.adopt(id, sourceUri);
      // A failed copy is not fatal: the picker URI still renders this session,
      // and the repair pass on Home re-adopts it later.
      const result = guest.update(id, { photoUri: adopted ?? sourceUri });
      return result.ok ? { ok: true, plant: result.plant } : { ok: false, reason: result.reason };
    }

    const userId = getUserId();
    if (!userId) return { ok: false, reason: 'network' };
    const current = mirror.load().plants.find((p) => p.id === id);
    if (!current) return { ok: false, reason: 'not_found' };

    const uploaded = await cloud.replacePhoto(userId, id, sourceUri);
    if (!uploaded.ok) return { ok: false, reason: uploaded.reason };

    /*
     * Re-read rather than mirroring the object path: the bucket is private, so
     * the path is not something <Image> can render, and only fetchAll signs it.
     * Same reasoning as `save`. A failed refresh still reports success - the
     * new photo IS stored - and shows the old picture until the next load,
     * which beats telling the user their edit failed when it did not.
     */
    try {
      const refreshed = await refreshFromCloud();
      const resolved = refreshed.plants.find((p) => p.id === id);
      if (resolved) return { ok: true, plant: resolved };
    } catch {
      /* fall through */
    }
    return { ok: true, plant: current };
  }

  /*
   * Attach a finding to a plant that already exists.
   *
   * Its own method rather than a field on `update` for the same reason
   * `setPhoto` is: a diagnosis is the one piece of a plant record produced by
   * a paid network call, and a caller reaching for it should see that in the
   * name. Used by the portfolio's bulk diagnose, which walks plants that were
   * added by hand and so have never been through the camera.
   */
  async function setDiagnosis(
    id: string,
    diagnosis: PlantDiagnosis
  ): Promise<RepoResult<{ plant: StoredPlant }>> {
    if (!isLoggedIn()) {
      const result = guest.update(id, { diagnosis });
      return result.ok ? { ok: true, plant: result.plant } : { ok: false, reason: result.reason };
    }

    const current = mirror.load().plants.find((p) => p.id === id);
    if (!current) return { ok: false, reason: 'not_found' };

    const cloudResult = await cloud.updatePlant(id, { diagnosis });
    if (!cloudResult.ok) return { ok: false, reason: cloudResult.reason };

    const fresh = mirror.load().plants;
    const latest = fresh.find((p) => p.id === id) ?? current;
    const updated: StoredPlant = { ...latest, diagnosis };
    mirror.replace(fresh.map((p) => (p.id === id ? updated : p)));
    return { ok: true, plant: updated };
  }

  async function update(
    id: string,
    patch: Partial<Pick<StoredPlant, 'reminderId' | 'soilMedium' | 'nickname'>>
  ): Promise<RepoResult<{ plant: StoredPlant }>> {
    if (!isLoggedIn()) {
      const result = guest.update(id, patch);
      return result.ok ? { ok: true, plant: result.plant } : { ok: false, reason: result.reason };
    }

    const current = mirror.load().plants.find((p) => p.id === id);
    if (!current) return { ok: false, reason: 'not_found' };

    const cloudPatch: Parameters<typeof cloud.updatePlant>[1] = {};
    if ('reminderId' in patch) cloudPatch.reminderId = patch.reminderId ?? null;
    if ('soilMedium' in patch) cloudPatch.soilMedium = patch.soilMedium ?? null;
    if ('nickname' in patch) cloudPatch.nickname = patch.nickname ?? null;
    const cloudResult = await cloud.updatePlant(id, cloudPatch);
    if (!cloudResult.ok) return { ok: false, reason: cloudResult.reason };

    const fresh = mirror.load().plants;
    const latest = fresh.find((p) => p.id === id) ?? current;
    const updated: StoredPlant = { ...latest, ...patch };
    for (const key of ['reminderId', 'soilMedium', 'nickname'] as const) {
      if (key in patch && patch[key] === undefined) delete updated[key];
    }
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
    const guestPlants = guest.load().plants;

    /*
     * No user id means the import cannot even be attempted. Report every plant
     * as FAILED rather than returning an empty result: `{imported: [], failed:
     * []}` is exactly what importing zero plants returns, so a caller cannot
     * tell "there was nobody to import for" from "all of them landed fine".
     * ImportBanner read that as success and dismissed itself, which is how a
     * library that was never touched came to look like a deleted one.
     */
    const userId = getUserId();
    if (!userId) return { imported: [], failed: guestPlants.map((p) => p.id) };

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
    setPhoto,
    setDiagnosis,
    saveManual,
    markWatered,
    markCare,
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
