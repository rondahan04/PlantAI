import type { StorageDeps } from './plantStore';

/* Same storage seam as the library — re-exported so callers bind one shape. */
export type { StorageDeps } from './plantStore';

/*
 * First-run onboarding state.
 *
 * One fact ("has this person been through onboarding, and what do we call
 * them"), stored the same way and for the same reason as the plant library:
 * SYNCHRONOUSLY. App.tsx picks the initial route from this during its first
 * render, so an async read would mount Home and then push Onboarding on top of
 * it — a visible flash of the wrong screen on every cold start.
 *
 * Deliberately NOT part of the plant library blob. The library is re-read on
 * every render of Home and every focus of a card; onboarding is read once at
 * launch. Folding a launch-only fact into the hot blob makes a corrupt library
 * also lose the user's name, and makes every watering write re-serialize it.
 *
 * The pure/bound split mirrors plantStore ↔ plantLibrary: this module has no
 * native imports so `node --test` can exercise it without an Expo runtime.
 */

export const ONBOARDING_KEY = 'plantai.onboarding';

/* Bump only alongside a migration. v1 is current. */
export const ONBOARDING_VERSION = 1;

/*
 * A name longer than this is not a name, it is a paste. It renders into a Home
 * header that has one line to give it, so the bound is applied on the way in
 * rather than by truncating at every read site.
 */
export const MAX_NAME_LENGTH = 40;

export interface OnboardingState {
  version: number;
  /* ISO-8601, when the user finished (or skipped) onboarding. */
  completedAt: string;
  /*
   * Optional because the name step is skippable. Absent means "never asked or
   * declined" — never defaulted to a placeholder, because a greeting the app
   * invented reads as a bug the first time the user sees it.
   */
  name?: string;
}

export interface OnboardingOptions {
  now?: () => number;
}

export type CompleteResult =
  | { ok: true; state: OnboardingState }
  | { ok: false; reason: 'storage_full' };

/*
 * Trim, collapse inner whitespace, bound the length. Returns undefined for
 * anything that is not a usable name so callers never have to special-case ''.
 */
export function normalizeName(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const clean = raw.trim().replace(/\s+/g, ' ');
  if (clean.length === 0) return undefined;
  return clean.slice(0, MAX_NAME_LENGTH);
}

export function createOnboardingStore(storage: StorageDeps, opts: OnboardingOptions = {}) {
  const now = opts.now ?? (() => Date.now());

  /*
   * `null` means "show onboarding". Every unreadable case resolves to null on
   * purpose: re-running a 30-second intro is a mild annoyance, while wrongly
   * skipping it leaves a first-time user on a Home screen with no plants and no
   * explanation of what the app is.
   */
  function load(): OnboardingState | null {
    let raw: string | null;
    try {
      raw = storage.getItem(ONBOARDING_KEY);
    } catch {
      return null;
    }
    if (raw === null) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      discard();
      return null;
    }

    if (typeof parsed !== 'object' || parsed === null) {
      discard();
      return null;
    }

    const state = parsed as Partial<OnboardingState>;
    if (typeof state.completedAt !== 'string' || Number.isNaN(Date.parse(state.completedAt))) {
      discard();
      return null;
    }

    const version = typeof state.version === 'number' ? state.version : ONBOARDING_VERSION;

    /*
     * A blob from a newer build. The user HAS onboarded, so returning null
     * would restart an intro they already finished — and the `complete()` that
     * followed would overwrite whatever the newer version wrote. Honour it and
     * leave the bytes alone.
     */
    return {
      version,
      completedAt: state.completedAt,
      name: normalizeName(state.name),
    };
  }

  /* Damaged bytes hold nothing worth recovering — no quarantine, unlike the library. */
  function discard(): void {
    try {
      storage.removeItem(ONBOARDING_KEY);
    } catch {
      /* best effort — load() already decided to show onboarding */
    }
  }

  /*
   * Persist and CONFIRM, for the same reason the library does: `setItem` on a
   * full disk throws on some platforms and returns quietly on others. An
   * unconfirmed write here means onboarding replays on every single launch.
   */
  function complete(name?: string): CompleteResult {
    const state: OnboardingState = {
      version: ONBOARDING_VERSION,
      completedAt: new Date(now()).toISOString(),
    };
    const clean = normalizeName(name);
    if (clean !== undefined) state.name = clean;

    const payload = JSON.stringify(state);
    try {
      storage.setItem(ONBOARDING_KEY, payload);
    } catch {
      return { ok: false, reason: 'storage_full' };
    }
    if (storage.getItem(ONBOARDING_KEY) !== payload) return { ok: false, reason: 'storage_full' };
    return { ok: true, state };
  }

  /*
   * Change the stored name without re-stamping `completedAt` — editing a name
   * later must not make the app think onboarding happened today.
   */
  function setName(name?: string): CompleteResult {
    const current = load();
    if (!current) return complete(name);

    const next: OnboardingState = { version: current.version, completedAt: current.completedAt };
    const clean = normalizeName(name);
    if (clean !== undefined) next.name = clean;

    const payload = JSON.stringify(next);
    try {
      storage.setItem(ONBOARDING_KEY, payload);
    } catch {
      return { ok: false, reason: 'storage_full' };
    }
    if (storage.getItem(ONBOARDING_KEY) !== payload) return { ok: false, reason: 'storage_full' };
    return { ok: true, state: next };
  }

  /* Replay onboarding — for a settings action or a manual test on device. */
  function reset(): void {
    discard();
  }

  return { load, complete, setName, reset };
}

export type OnboardingStore = ReturnType<typeof createOnboardingStore>;
