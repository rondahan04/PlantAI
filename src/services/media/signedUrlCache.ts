/*
 * Which photo URLs still need signing.
 *
 * WHY. Plant photos live in a private bucket, so a row's `photo_path` is not
 * something <Image> can render - it has to be exchanged for a signed URL first.
 * That exchange was happening once per plant, on every read, with nothing
 * remembering the answer: opening the Portfolio with thirty plants meant thirty
 * HTTPS round trips before a single photo appeared, and opening it again a
 * minute later meant thirty more. The URLs are valid for an hour.
 *
 * This module decides what actually needs asking for. The batching itself
 * belongs to the Supabase adapter (one `createSignedUrls` call instead of N
 * `createSignedUrl` calls); the decision lives here because it is the part with
 * rules worth testing - and the adapter cannot be tested at all.
 *
 * Deliberately in-memory and process-scoped. A signed URL is a short-lived
 * capability to read a private object: persisting it would leave a
 * bucket-reading credential on disk long after the app forgot why, which is
 * the same class of mistake as an API key in a bundle. Losing the cache on
 * relaunch costs one batched request.
 */

export interface SignedUrlCache {
  /* The still-valid URL for a path, or null if it must be (re)signed. */
  get(path: string): string | null;
  /* Of these paths, the ones with no usable URL. Deduplicated, order kept. */
  missing(paths: readonly string[]): string[];
  put(path: string, url: string): void;
  /* Sign-out and account deletion. A cached URL outliving the session it was
   * minted for is a reader for an account nobody is signed into any more. */
  clear(): void;
  size(): number;
}

export interface SignedUrlCacheConfig {
  /* Must match the TTL the URLs are actually minted with. */
  ttlMs?: number;
  /*
   * Treat a URL as expired this long before it really is. A URL that dies
   * mid-scroll renders as a broken image with no way to recover until the next
   * refresh, and re-signing early costs one request inside a batch we were
   * making anyway.
   */
  skewMs?: number;
  now?: () => number;
}

export const DEFAULT_TTL_MS = 60 * 60_000;
const DEFAULT_SKEW_MS = 5 * 60_000;

export function createSignedUrlCache(config: SignedUrlCacheConfig = {}): SignedUrlCache {
  const { ttlMs = DEFAULT_TTL_MS, skewMs = DEFAULT_SKEW_MS, now = Date.now } = config;
  const entries = new Map<string, { url: string; expiresAt: number }>();

  function valid(path: string): string | null {
    const hit = entries.get(path);
    if (!hit) return null;
    if (hit.expiresAt - skewMs <= now()) {
      // Drop it rather than leave a known-dead entry to be re-checked forever.
      entries.delete(path);
      return null;
    }
    return hit.url;
  }

  return {
    get: valid,

    missing(paths) {
      const out: string[] = [];
      const seen = new Set<string>();
      for (const path of paths) {
        // A library where several plants share a photo path must not ask for
        // the same signature twice in one batch.
        if (!path || seen.has(path)) continue;
        seen.add(path);
        if (valid(path) === null) out.push(path);
      }
      return out;
    },

    put(path, url) {
      entries.set(path, { url, expiresAt: now() + ttlMs });
    },

    clear() {
      entries.clear();
    },

    size() {
      return entries.size;
    },
  };
}
