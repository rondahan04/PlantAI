/*
 * Request gate for the billable endpoints (TODOS A1 + O1).
 *
 * ⚠️ THE SHARED SECRET IS A SPEED BUMP, NOT AUTHENTICATION.
 * It has to reach the app through `EXPO_PUBLIC_API_SECRET`, which is the exact
 * mechanism that leaked the OpenAI key: anyone holding the app bundle can
 * extract it in about a minute. Do not build anything on top of this assuming
 * the endpoint is authenticated — it is not, and it cannot be until per-device
 * attestation lands (deferred: "Per-device quota / App Attest on the API").
 *
 * THE HARD DAILY CAP IS WHAT ACTUALLY BOUNDS THE BILL. Every allowed nursery
 * request spends 1 Places Enterprise search + N Firecrawl scrapes + N OpenAI
 * passes; every diagnose request spends 1 PlantNet + 1 OpenAI vision call. The
 * secret raises the cost of casual abuse; the cap is the thing that means a
 * leaked build cannot run up an unbounded invoice.
 *
 * DEPLOY ORDER MATTERS. Ship with GATE_MODE=log first, let the `eas update`
 * carrying the secret propagate to installed apps, THEN flip to
 * GATE_MODE=enforce. Enforcing first locks every existing build — including
 * yours — out of your own API.
 */

export type GateMode = 'log' | 'enforce';

export interface GateConfig {
  mode: GateMode;
  secret: string | undefined;
  perMinutePerIp: number;
  dailyCap: number;
}

export interface GateDecision {
  allow: boolean;
  status: number;
  /* Stable machine code. Safe to return to the client. */
  code: string;
  /* User-facing text. Deliberately says nothing about our account or limits. */
  message: string;
  /* Why the gate would have rejected, for the log only. */
  reason: string;
}

const OK: GateDecision = {
  allow: true,
  status: 200,
  code: 'ok',
  message: '',
  reason: '',
};

/* Billable-request bookkeeping, so O1 can answer "is the cap working?". */
export interface GateStats {
  day: string;
  allowed: number;
  rejected: number;
  wouldReject: number; // rejections suppressed by log-only mode
  cap: number;
  remaining: number;
}

export function readGateConfig(env: (k: string) => string | undefined): GateConfig {
  const mode = env('GATE_MODE') === 'enforce' ? 'enforce' : 'log';
  return {
    mode,
    secret: env('API_SHARED_SECRET'),
    perMinutePerIp: Number(env('RATE_LIMIT_PER_MIN')) || 6,
    dailyCap: Number(env('DAILY_REQUEST_CAP')) || 200,
  };
}

const MINUTE_MS = 60_000;

export function createGate(config: GateConfig, now: () => number = Date.now) {
  /* Per-IP sliding window. Entries are pruned on every check, so the map stays
   * proportional to active clients rather than to lifetime clients. */
  const hits = new Map<string, number[]>();

  let day = utcDay(now());
  let allowed = 0;
  let rejected = 0;
  let wouldReject = 0;

  function rollDay() {
    const today = utcDay(now());
    if (today !== day) {
      day = today;
      allowed = 0;
      rejected = 0;
      wouldReject = 0;
    }
  }

  /*
   * Decide whether a billable request may proceed. In log mode the decision is
   * always `allow: true`, but `reason` is populated so the logs show exactly
   * what enforcing would have blocked before you flip the switch.
   */
  function check(ip: string, secretHeader: string | undefined): GateDecision {
    rollDay();

    const verdict = evaluate(ip, secretHeader);
    if (verdict.allow) {
      allowed++;
      return verdict;
    }

    if (config.mode === 'log') {
      wouldReject++;
      allowed++;
      console.warn(`[gate] log-only: would reject ${ip} — ${verdict.reason}`);
      return { ...OK, reason: verdict.reason };
    }

    rejected++;
    console.warn(`[gate] reject ${ip} — ${verdict.reason}`);
    return verdict;
  }

  function evaluate(ip: string, secretHeader: string | undefined): GateDecision {
    // 1. Daily cap first — it is the limit that actually protects the bill, and
    //    it should hold even for a caller presenting a valid secret.
    if (allowed >= config.dailyCap) {
      return {
        allow: false,
        status: 503,
        code: 'daily_cap',
        message: 'The plant service is resting for today. Try again tomorrow.',
        reason: `daily cap ${config.dailyCap} reached`,
      };
    }

    // 2. Shared secret. Absent config means an unconfigured deploy: fail closed
    //    rather than silently serving an open endpoint.
    if (!config.secret) {
      return {
        allow: false,
        status: 503,
        code: 'not_configured',
        message: 'The plant service is unavailable right now.',
        reason: 'API_SHARED_SECRET is not set on the server',
      };
    }
    if (secretHeader !== config.secret) {
      return {
        allow: false,
        status: 401,
        code: 'bad_secret',
        message: 'The plant service is unavailable right now.',
        reason: secretHeader ? 'wrong x-plantai-key' : 'missing x-plantai-key',
      };
    }

    // 3. Per-IP burst limit.
    const t = now();
    const window = (hits.get(ip) ?? []).filter((at) => t - at < MINUTE_MS);
    if (window.length >= config.perMinutePerIp) {
      hits.set(ip, window);
      return {
        allow: false,
        status: 429,
        code: 'rate_limited',
        message: 'That was a lot of requests at once. Give it a minute.',
        reason: `${window.length} requests in the last minute (limit ${config.perMinutePerIp})`,
      };
    }
    window.push(t);
    hits.set(ip, window);

    // Prune idle clients so a long-lived process does not grow the map forever.
    if (hits.size > 1000) {
      for (const [k, v] of hits) {
        if (v.every((at) => t - at >= MINUTE_MS)) hits.delete(k);
      }
    }

    return OK;
  }

  /*
   * Secret-only check for the free endpoints — job polling in particular. A
   * poll costs one map lookup, so it must not consume the daily cap and must
   * not count against the per-minute burst limit: an eight-minute scrape polled
   * every three seconds is ~160 requests, which the burst limit would kill
   * halfway through the job it is waiting on.
   */
  function checkSecret(ip: string, secretHeader: string | undefined): GateDecision {
    if (!config.secret) {
      const d: GateDecision = {
        allow: false,
        status: 503,
        code: 'not_configured',
        message: 'The plant service is unavailable right now.',
        reason: 'API_SHARED_SECRET is not set on the server',
      };
      return config.mode === 'log' ? { ...OK, reason: d.reason } : d;
    }
    if (secretHeader !== config.secret) {
      const d: GateDecision = {
        allow: false,
        status: 401,
        code: 'bad_secret',
        message: 'The plant service is unavailable right now.',
        reason: secretHeader ? 'wrong x-plantai-key' : 'missing x-plantai-key',
      };
      if (config.mode === 'log') {
        console.warn(`[gate] log-only: would reject ${ip} — ${d.reason}`);
        return { ...OK, reason: d.reason };
      }
      return d;
    }
    return OK;
  }

  function stats(): GateStats {
    rollDay();
    return {
      day,
      allowed,
      rejected,
      wouldReject,
      cap: config.dailyCap,
      remaining: Math.max(0, config.dailyCap - allowed),
    };
  }

  return { check, checkSecret, stats, mode: config.mode };
}

function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/*
 * Client IP. Fly (and every other proxy) puts the real address in the first
 * hop of x-forwarded-for; the socket address there is the proxy, which would
 * put every user in the world into one rate-limit bucket.
 */
export function clientIp(headers: Record<string, string | string[] | undefined>, fallback: string): string {
  const fwd = headers['x-forwarded-for'];
  const raw = Array.isArray(fwd) ? fwd[0] : fwd;
  const first = raw?.split(',')[0]?.trim();
  return first || fallback;
}
