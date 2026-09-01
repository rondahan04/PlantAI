import Storage from 'expo-sqlite/kv-store';
import { apiFetch, apiHeaders, readApiError } from '../lib/api';
import { cacheKeyFor, createGenusCarePlanCache, type CacheStorage } from '../lib/genusCarePlan';
import { getLanguage } from './language';

/*
 * The one place `expo-sqlite` and the network are bound to the genus care
 * plan cache. It lives apart from lib/genusCarePlan.ts for the same reason
 * services/plantLibrary.ts lives apart from lib/plantStore.ts: that module
 * stays free of native imports and exercised by `node --test` with no device
 * and no network.
 *
 * The *Sync accessors are required, not preferred, and for the same reason as
 * plantLibrary.ts: `peek` runs during render, so a plant screen paints the
 * right care advice on its first frame rather than showing generic fallback
 * text that then swaps under the user a frame later.
 */
const deviceStorage: CacheStorage = {
  getItem: (key) => Storage.getItemSync(key),
  setItem: (key, value) => Storage.setItemSync(key, value),
  removeItem: (key) => Storage.removeItemSync(key),
};

/*
 * Eight plans of prose is a slow answer - the live call measured about 19
 * seconds - so this needs real headroom over that, not a copy of the shorter
 * timeouts used elsewhere. 45s is chosen with that margin. A timeout here is
 * cheap to be wrong about in the safe direction: on timeout the caller falls
 * back to the local per-medium multipliers in soilMedia.ts, and the plant has
 * already been saved by the time this call happens, so the cost of getting
 * this number wrong is a round of generic advice, never lost data.
 */
const TIMEOUT_MS = 45_000;

async function fetchPlan(genus: string, family: string): Promise<unknown> {
  let res: Response;
  try {
    res = await apiFetch('/api/care-plan', {
      method: 'POST',
      headers: apiHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ genus, family, lang: getLanguage() }),
      timeoutMs: TIMEOUT_MS,
    });
  } catch (err: unknown) {
    // AbortError (our timeout) and a genuine network failure both land here as
    // the same thing to the cache above: a fetch that failed. It turns either
    // into a null plan and the caller's local fallback, exactly like
    // diagnosePlant treats the two cases as equivalent.
    throw err instanceof Error ? err : new Error(String(err));
  }

  if (!res.ok) {
    const { error, message } = await readApiError(res);
    throw new Error(`${res.status} ${error}${message ? `: ${message}` : ''}`);
  }

  return res.json();
}

/*
 * In-flight de-duplication lives HERE, not in lib/genusCarePlan.ts, and that
 * split is deliberate. The pure cache is about cache POLICY - what counts as
 * a hit, what gets written, what gets dropped - and stays trivially testable
 * under `node --test` with a fake clock and a fake fetch. Sharing one promise
 * across concurrent callers is not policy, it is a fact about THIS process's
 * network: a screen rendering several Alocasias at once, or a user tapping
 * between two of them, must not fire two identical requests for a genus that
 * is already in flight. That is exactly the kind of process-level concern the
 * binding layer owns and the pure module should never know about.
 *
 * Keyed with `cacheKeyFor` so this map and the cache underneath it can never
 * disagree about what counts as the same genus - both lowercase and trim,
 * because genus names arrive from the catalog, PlantNet and the vision model
 * in three different capitalizations.
 *
 * An entry is deleted as soon as its promise settles, success or failure.
 * Left in place after a failure, it would cache a REJECTED promise forever:
 * every future caller for that genus would await the same rejection instead
 * of getting a fresh chance to fetch. Deleting on failure costs nothing on
 * success (the map entry is already gone by the time anyone could reuse it)
 * and turns a permanent failure into a retryable one.
 */
const inFlight = new Map<string, Promise<Awaited<ReturnType<typeof cache.get>>>>();

const cache = createGenusCarePlanCache({ storage: deviceStorage, fetchPlan });

function get(genus: string, family: string): ReturnType<typeof cache.get> {
  /*
   * The language is read HERE rather than threaded through every screen: it is
   * a device fact, like the storage binding above, and it cannot change while
   * the process is running. It is also part of the dedupe key, so a Hebrew and
   * an English fetch for the same genus are two different requests rather than
   * one of them silently receiving the other's answer.
   */
  const lang = getLanguage();
  const key = cacheKeyFor(genus, lang);
  const existing = inFlight.get(key);
  if (existing) return existing;

  const promise = cache.get(genus, family, lang).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}

/*
 * A single shared instance, like plantLibrary. `peek` is passed straight
 * through - it never touches the network, so it has nothing to deduplicate -
 * and `get` is the deduped wrapper above.
 */
export const genusCarePlans = {
  /* Same reason as `get`: callers ask about a genus, not about a language. */
  peek: (genus: string) => cache.peek(genus, getLanguage()),
  get,
};
