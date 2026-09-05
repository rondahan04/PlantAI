/*
 * Per-nursery scrape freshness (TODOS E11).
 *
 * WHY. `recordSuccess('nursery_scrape')` is one global flag: it fires when a
 * search finishes, so it stays green while individual shops quietly stop
 * parsing. A nursery whose markup changed returns zero rows forever, the search
 * still "succeeds", and the only symptom is that the user sees fewer shops than
 * they should - which nobody can notice, because nobody knows how many there
 * should have been.
 *
 * `scraper/core.ts` already computes the fact needed to see it: `ExtractFunnel.
 * stage` says whether a zero came from a catalogue we read (`no_match` - the
 * shop genuinely lacks the plant, which is fine and normal) or from a page we
 * never managed to read (`no_markdown` / `no_excerpt` - our problem). Nothing
 * retained it. This module is that retention.
 *
 * THE DISTINCTION THIS EXISTS TO DRAW. A shop returning zero is not a fault. A
 * shop we cannot READ is. Counting the first as breakage would mark half the
 * nurseries in the country broken for any uncommon plant, and an alarm that
 * cries wolf on normal behaviour is one nobody reads.
 *
 * Bounded like the error ring next to it: this is a diagnostic, not a dataset,
 * and it must not grow without limit on a long-lived process.
 */

/* Mirrors ExtractStage in scraper/core.ts, plus the two outcomes the pipeline
 * produces around it: a site can also time out or throw before extraction is
 * ever reached, and those are readability failures too. */
export type SiteStage =
  | 'no_markdown'
  | 'no_excerpt'
  | 'no_match'
  | 'rejected'
  | 'ok'
  | 'timeout'
  | 'error';

/*
 * Did we manage to READ this shop's catalogue?
 *
 * `no_match` and `rejected` both mean the model saw a real catalogue: the first
 * found nothing matching, the second found rows the auditor threw out. Neither
 * says anything is wrong with our scrape of that site.
 */
export function readable(stage: SiteStage): boolean {
  return stage === 'ok' || stage === 'no_match' || stage === 'rejected';
}

export interface SiteHealth {
  host: string;
  lastStage: SiteStage;
  lastSeenAt: string;
  /* When we last READ this shop - not when it last had the plant in stock. */
  lastReadableAt: string | null;
  /* Consecutive unreadable attempts. Reset by any readable one. */
  consecutiveUnreadable: number;
  attempts: number;
  stale: boolean;
}

export interface ScrapeHealthConfig {
  /* How many consecutive unreadable attempts before a host is called stale.
   * Not 1: a single timeout is ordinary internet weather, and an alarm that
   * fires on one is noise. Three in a row is a pattern. */
  staleAfter?: number;
  /* Distinct hosts retained, oldest-seen evicted first. */
  maxHosts?: number;
  now?: () => number;
}

export interface ScrapeHealth {
  record(host: string, stage: SiteStage): void;
  /* Worst first: stale hosts, then by how long since we last read them. The
   * caller reads the top of this list, so the top is where the problem goes. */
  report(): SiteHealth[];
  /* Counts only. Which shops we scrape - and especially which of them are
   * currently broken - is not something an unauthenticated endpoint should
   * enumerate; the named detail lives in report(), behind the secret. */
  summary(): { hosts: number; stale: number };
}

export function createScrapeHealth(config: ScrapeHealthConfig = {}): ScrapeHealth {
  const { staleAfter = 3, maxHosts = 60, now = Date.now } = config;
  const hosts = new Map<string, SiteHealth>();

  return {
    record(host, stage) {
      const at = new Date(now()).toISOString();
      const prev = hosts.get(host);
      const ok = readable(stage);

      const next: SiteHealth = {
        host,
        lastStage: stage,
        lastSeenAt: at,
        lastReadableAt: ok ? at : (prev?.lastReadableAt ?? null),
        consecutiveUnreadable: ok ? 0 : (prev?.consecutiveUnreadable ?? 0) + 1,
        attempts: (prev?.attempts ?? 0) + 1,
        stale: false,
      };
      next.stale = next.consecutiveUnreadable >= staleAfter;

      // Re-insert so Map iteration order is least-recently-seen first, which is
      // what makes the eviction below "oldest" rather than "arbitrary".
      hosts.delete(host);
      hosts.set(host, next);

      while (hosts.size > maxHosts) {
        const oldest = hosts.keys().next();
        if (oldest.done) break;
        hosts.delete(oldest.value);
      }
    },

    report() {
      return [...hosts.values()].sort((a, b) => {
        if (a.stale !== b.stale) return a.stale ? -1 : 1;
        // Never read at all sorts above read-a-while-ago: an empty
        // lastReadableAt is the strongest evidence of a site we cannot parse.
        const at = a.lastReadableAt ?? '';
        const bt = b.lastReadableAt ?? '';
        return at.localeCompare(bt);
      });
    },

    summary() {
      const all = [...hosts.values()];
      return { hosts: all.length, stale: all.filter((h) => h.stale).length };
    },
  };
}
