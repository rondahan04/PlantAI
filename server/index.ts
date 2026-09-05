#!/usr/bin/env node
/*
 * PlantAI API server. Framework-free (Node http) so it containerizes cleanly.
 *
 * Routes
 *   GET  /health                    → liveness + gate/job counters (O1, O3)
 *   POST /api/diagnose              → PlantDiagnosis            (A3, billable)
 *   POST /api/care-plan             → { bySoil } per genus      (billable)
 *   POST /api/nurseries             → { jobId }                 (E12, billable)
 *   GET  /api/nurseries/job/:id     → job state / result        (E12, free)
 *
 * Every billable route goes through the gate (A1): shared secret, per-IP burst
 * limit, hard daily cap. Read server/gate.ts before changing anything about it
 * - in particular, the shared secret is NOT authentication.
 *
 * Keys are read from server env (plain names preferred, EXPO_PUBLIC_* fallback
 * for local dev only - nothing here should ship to a phone).
 *
 * Run:  node server/index.ts   (or npm run server)
 */
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  loadEnv,
  env,
  createSearcher,
  hostOf,
  extractAndVerifyPlants,
  translateQuery,
  sanityCheckPrices,
  inferAvailabilityLLM,
  scrapeUrl,
} from '../scraper/core.ts';
import { discoverNurseries, resolvePhotoUrl } from '../scraper/places.ts';
import { runNurserySearch, type PipelineDeps, type NurseryResult } from '../scraper/pipeline.ts';
import { clientIp, createGate, readGateConfig } from './gate.ts';
import { createJobStore } from './jobs.ts';
import { createNurseryCache, searchKey } from './nurseryCache.ts';
import { createScrapeHealth } from './scrapeHealth.ts';
import {
  DiagnosisServiceError,
  NotAPlantError,
  UnsupportedImageError,
  diagnose,
  openAiAssessHealth,
  openAiIdentify,
  plantNetIdentify,
  stubAssessHealth,
  type DiagnosisDeps,
  type IdentifyHint,
} from './diagnose.ts';
import { CarePlanError, buildCarePlan, openAiCarePlan, type Lang } from './carePlan.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 4000;

loadEnv(path.join(ROOT, '.env'));
const FIRECRAWL_KEY = env('FIRECRAWL_API_KEY');
const OPENAI_KEY = env('OPENAI_API_KEY');
const TAVILY_KEY = env('TAVILY_API_KEY');
const GOOGLE_KEY = env('GOOGLE_MAPS_API_KEY');
const PLANTNET_KEY = env('PLANTNET_API_KEY');

if (!FIRECRAWL_KEY || !OPENAI_KEY || !GOOGLE_KEY || !PLANTNET_KEY) {
  console.error(
    'Missing FIRECRAWL_API_KEY / OPENAI_API_KEY / GOOGLE_MAPS_API_KEY / PLANTNET_API_KEY'
  );
  process.exit(1);
}

const gate = createGate(readGateConfig(env));
const jobs = createJobStore<NurseryResult[]>();

/*
 * Durable scrape cache. Optional by design: without a service-role key the
 * server behaves exactly as it did before, so local scraper work needs no
 * Supabase. The anon key is deliberately NOT accepted as a fallback - RLS
 * denies that role every row in the table, so it would silently cache nothing.
 */
/*
 * Per-nursery scrape freshness (E11). A shop whose markup changed returns zero
 * rows forever while the search as a whole still succeeds, so the global
 * `nursery_scrape` flag stays green through it. This is what makes that
 * visible.
 */
const scrapeHealth = createScrapeHealth();

const nurseryCache = createNurseryCache<NurseryResult[]>({
  url: env('SUPABASE_URL') ?? env('EXPO_PUBLIC_SUPABASE_URL'),
  serviceKey: env('SUPABASE_SERVICE_ROLE_KEY'),
});

/*
 * CORS is emitted only when CORS_ORIGIN is set, and only for that origin. The
 * native app sends no Origin header and never needed it; the old
 * `Access-Control-Allow-Origin: *` existed for the local dashboard and made a
 * billable endpoint callable from any web page on the internet.
 */
const CORS_ORIGIN = env('CORS_ORIGIN');

/*
 * The nurseries that actually ship nationally. These are scraped on EVERY
 * search, not only when nothing local matches, because they are the whole
 * content of the Deliver tab - a user who opens it wants delivery whether or
 * not a local shop happened to have the plant.
 *
 * Kept to the two confirmed shippers. The others on this list were general
 * nurseries with no delivery, so including them padded the tab with rows that
 * could not be delivered and cost a scrape each.
 */
const NATIONAL_NURSERIES = ['https://al-haderech.co.il/', 'https://rootine.co.il/'];

const searcher = createSearcher(FIRECRAWL_KEY, {
  openaiKey: OPENAI_KEY,
  learnedFile: path.join(ROOT, 'scraper', 'learned-platforms.json'),
  /* Host → platform, remembered across restarts so a search never re-pays
   * identification for a shop we have already met. See SearcherOpts. */
  hostsFile: path.join(ROOT, 'scraper', 'known-hosts.json'),
  tavilyKey: TAVILY_KEY,
});

const deps: PipelineDeps = {
  discover: (lat, lng, radiusM) =>
    discoverNurseries(lat, lng, GOOGLE_KEY!, { radiusM, richFields: true }),
  search: (website, query, host) => searcher.fetchSearchMarkdown(website, query, host),
  extract: (o) => extractAndVerifyPlants({ ...o, openaiKey: OPENAI_KEY }),
  /* English in, Hebrew out - see translateQuery. One call per search. */
  translate: (plantName) => translateQuery(plantName, OPENAI_KEY!),
  /* One call for the whole search - the cross-nursery comparison is the point. */
  checkPrices: (query, candidates) => sanityCheckPrices(query, candidates, OPENAI_KEY!),
  /*
   * Reached only when structured extraction found 0 items - the slow, common
   * path. Platform identification already read this homepage moments ago, so
   * prefer that copy over paying a second Firecrawl round trip for the same
   * bytes. A warm host (cached platform, no identification this run) has no
   * cached homepage and falls through to a real scrape.
   */
  scrapeHome: async (origin) =>
    searcher.cachedHomeMarkdown(hostOf(origin)) ||
    scrapeUrl(origin, FIRECRAWL_KEY!, { tavilyKey: TAVILY_KEY }),
  infer: (homeMd, query, site) => inferAvailabilityLLM(homeMd, query, site, OPENAI_KEY!),
  resolvePhoto: (photoName) => resolvePhotoUrl(photoName, GOOGLE_KEY!),
  readFallbackUrls: () =>
    fs
      .readFileSync(path.join(ROOT, 'nurseries-fallback.txt'), 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('http')),
  nationalUrls: NATIONAL_NURSERIES,
  onSiteRead: (host, stage) => scrapeHealth.record(host, stage),
};

// Temporary: the lecturer's shared OpenAI key has no credits (2026-08-22).
// DIAGNOSIS_SKIP_OPENAI swaps the real health assessment for a labelled stub
// so identify + gating + the client UI stay testable in the meantime. See
// TODOS.md "Restore OpenAI health assessment" - unset this once credits return.
const SKIP_OPENAI_DIAGNOSIS = env('DIAGNOSIS_SKIP_OPENAI') === 'true';
if (SKIP_OPENAI_DIAGNOSIS) {
  console.warn('[diagnose] DIAGNOSIS_SKIP_OPENAI=true - serving a stub health assessment, not a real diagnosis.');
}

const identifyImpl = plantNetIdentify(PLANTNET_KEY!);
const assessHealthImpl = SKIP_OPENAI_DIAGNOSIS ? stubAssessHealth : openAiAssessHealth(OPENAI_KEY!);
/*
 * The species backup. Off under DIAGNOSIS_SKIP_OPENAI for the same reason the
 * health assessment is: that flag means "do not spend OpenAI credits", and a
 * fallback that quietly spends them would make the flag a lie. Without it
 * `resolveIdentification` degrades to plain PlantNet, which is the old
 * behaviour.
 */
const identifyFallbackImpl = SKIP_OPENAI_DIAGNOSIS ? undefined : openAiIdentify(OPENAI_KEY!);
const carePlanDeps = openAiCarePlan(OPENAI_KEY!);

/*
 * Built per request so the cascade's decisions can be logged against the rid -
 * whether the backup ran, and whether its answer was taken, is the only way to
 * tell a quiet fallback from a PlantNet that has silently stopped working.
 */
function makeDiagnosisDeps(rid: string): DiagnosisDeps {
  return {
    identify: async (image) => {
      const result = await identifyImpl(image);
      recordSuccess('plantnet_identify');
      return result;
    },
    assessHealth: async (image, id) => {
      const result = await assessHealthImpl(image, id);
      // Counts the labelled stub too - SKIP_OPENAI_DIAGNOSIS means "not calling
      // OpenAI", not "the diagnosis step is down", and /health should not read
      // as an outage during an intentional, logged cost-saving mode.
      recordSuccess('health_assessment');
      return result;
    },
    ...(identifyFallbackImpl
      ? {
          identifyFallback: async (image: Buffer, hint?: IdentifyHint) => {
            // The hint is logged because it changes the question asked: a
            // tiebreak that keeps answering with the genus it was handed reads
            // very differently from an open identification that agrees.
            logEvent(rid, 'identify_fallback_start', { genusHint: hint?.genus });
            const result = await identifyFallbackImpl(image, hint);
            logEvent(rid, 'identify_fallback_done', {
              scientificName: result.scientificName,
              // Against `genusHint` above this is the tiebreak's own guard
              // rail: a differing genus means the answer was thrown away.
              genus: result.genus,
              confidence: result.confidence,
              genusConfidence: result.genusConfidence,
            });
            /*
             * Deliberately NOT recorded against a /health provider. The backup
             * runs only when the primary was weak or down, so its own failure
             * is expected traffic, not an outage - counting it would make the
             * health endpoint alarm on PlantNet having a bad day.
             */
            return result;
          },
        }
      : {}),
  };
}

// ─── HTTP plumbing ────────────────────────────────────────────────────────────

/*
 * A diagnosis photo arrives as base64 JSON, so the body is roughly 4/3 the size
 * of the JPEG. `quality: 0.7` on a modern phone lands around 1-3 MB; 12 MB is
 * generous headroom and still small enough that an attacker cannot exhaust
 * memory by opening a few connections.
 */
const MAX_BODY_BYTES = 12 * 1024 * 1024;


/*
 * The caller's language, read defensively.
 *
 * Anything that is not exactly 'he' is treated as English rather than
 * rejected: an older installed build sends no `lang` at all, and a request
 * that would otherwise have worked must not 400 over a display preference.
 */
function readLang(value: unknown): Lang {
  return value === 'he' ? 'he' : 'en';
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new PayloadTooLarge());
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

class PayloadTooLarge extends Error {
  constructor() {
    super('PAYLOAD_TOO_LARGE');
    this.name = 'PayloadTooLarge';
  }
}

function json(res: http.ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

/*
 * H3: clients get a stable code and neutral prose, never `err.message`.
 * Provider bodies have echoed request payloads including auth headers, and a
 * 429 from OpenAI reads as a sentence about our unpaid invoice. Detail goes to
 * the log with the request id and nowhere else.
 */
/*
 * Recent failures, kept in memory so a deployed instance can be debugged
 * without shell access to its logs. Bounded - this is a debugging aid, not a
 * log store, and an unbounded array on a 512 MB box is a slow leak.
 *
 * Exposed ONLY to a caller holding the shared secret (see /health). The detail
 * strings are provider error bodies: not secrets, but not public either.
 */
const RECENT_ERRORS_MAX = 20;
const recentErrors: Array<{ at: string; rid: string; code: string; detail: string }> = [];

function recordError(rid: string, code: string, detail: string) {
  recentErrors.push({ at: new Date().toISOString(), rid, code, detail: detail.slice(0, 500) });
  if (recentErrors.length > RECENT_ERRORS_MAX) recentErrors.shift();
}

/*
 * O2: one JSON object per line, `rid` on every entry, rather than the
 * printf-style `[${rid}] text` strings this replaced. A host's log viewer
 * (Render's included) can filter/query a field but not parse an ad-hoc
 * sentence, and grepping a raw string for "the" request id across an
 * interleaved multi-request stream was the actual problem this fixes.
 */
function logEvent(rid: string, event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ at: new Date().toISOString(), rid, event, ...fields }));
}

function fail(res: http.ServerResponse, rid: string, status: number, code: string, message: string, detail: string) {
  console.error(JSON.stringify({ at: new Date().toISOString(), rid, event: 'error', code, detail }));
  recordError(rid, code, detail);
  json(res, status, { error: code, message });
}

let requestSeq = 0;
const nextRequestId = () => `r${(++requestSeq).toString(36)}`;

/*
 * O4: when the last successful call to each provider happened, so `/health`
 * can answer "is PlantNet actually working" without waiting for a user to hit
 * a broken flow first. A 502 on /api/diagnose is ambiguous between PlantNet
 * and the health-assessment step (PlantNet vs OpenAI/stub) - this splits it.
 */
type Provider = 'plantnet_identify' | 'health_assessment' | 'nursery_scrape';
const lastSuccess: Record<Provider, string | null> = {
  plantnet_identify: null,
  health_assessment: null,
  nursery_scrape: null,
};
function recordSuccess(provider: Provider): void {
  lastSuccess[provider] = new Date().toISOString();
}

// ─── Server ───────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const rid = nextRequestId();
  const u = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const ip = clientIp(req.headers, req.socket.remoteAddress ?? 'unknown');
  const secret = firstHeader(req.headers['x-plantai-key']);

  if (CORS_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'content-type, x-plantai-key');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(CORS_ORIGIN ? 204 : 405);
    res.end();
    return;
  }

  // ── GET /health ─────────────────────────────────────────────────────────────
  // Public liveness. `?errors=1` additionally returns the recent-failure ring,
  // but only for a caller holding the shared secret - provider error bodies are
  // internal detail and this endpoint is otherwise unauthenticated.
  if (u.pathname === '/health') {
    const body: Record<string, unknown> = {
      ok: true,
      gate: gate.stats(),
      jobs: jobs.stats(),
      lastSuccess,
      // `cache.enabled: false` means every search is a live paid scrape. It is
      // the only failure here that costs money while looking perfectly healthy.
      cache: nurseryCache.stats(),
      /*
       * Summary only. The per-host detail is behind ?errors=1 with the rest of
       * the diagnostics: which shops we scrape is not something an
       * unauthenticated endpoint should enumerate.
       */
      scrape: scrapeHealth.summary(),
    };
    if (u.searchParams.get('errors') === '1') {
      const allowed = gate.checkSecret(ip, secret).allow;
      body.errors = allowed ? recentErrors : 'secret required';
      body.scrapeHosts = allowed ? scrapeHealth.report() : 'secret required';
    }
    json(res, 200, body);
    return;
  }

  // ── POST /api/diagnose ──────────────────────────────────────────────────────
  if (u.pathname === '/api/diagnose' && req.method === 'POST') {
    const decision = gate.check(ip, secret);
    if (!decision.allow) {
      json(res, decision.status, { error: decision.code, message: decision.message });
      return;
    }

    let image: Buffer;
    let lang: Lang = 'en';
    try {
      const raw = await readBody(req);
      const body = JSON.parse(raw.toString('utf8'));
      lang = readLang(body?.lang);
      if (typeof body?.imageBase64 !== 'string' || body.imageBase64.length === 0) {
        json(res, 400, { error: 'bad_request', message: 'imageBase64 is required.' });
        return;
      }
      image = Buffer.from(body.imageBase64, 'base64');
      if (image.length === 0) {
        json(res, 400, { error: 'bad_request', message: 'imageBase64 was not valid base64.' });
        return;
      }
    } catch (err: unknown) {
      const tooBig = err instanceof PayloadTooLarge;
      fail(
        res,
        rid,
        tooBig ? 413 : 400,
        tooBig ? 'payload_too_large' : 'bad_request',
        tooBig ? 'That photo is too large to send.' : 'That request could not be read.',
        errText(err)
      );
      return;
    }

    const t0 = Date.now();
    logEvent(rid, 'diagnose_start', { bytes: image.length, lang });
    try {
      const result = await diagnose(image, makeDiagnosisDeps(rid), lang);
      logEvent(rid, 'diagnose_done', {
        plantName: result.plantName,
        confidence: result.confidence,
        condition: result.condition,
        identificationSource: result.identificationSource,
        ms: Date.now() - t0,
      });
      json(res, 200, result);
    } catch (err: unknown) {
      if (err instanceof NotAPlantError) {
        // Not a failure of ours: the photo has no plant in it. Distinct code so
        // the app can say something true and specific about the photo.
        logEvent(rid, 'diagnose_not_a_plant', { ms: Date.now() - t0 });
        json(res, 422, { error: 'not_a_plant', message: 'No plant was recognized in that photo.' });
        return;
      }
      if (err instanceof UnsupportedImageError) {
        // About the file, not about us. Saying "the service did not answer"
        // here would send the user to retry a photo that can never work.
        logEvent(rid, 'diagnose_unsupported_image', { detectedType: err.detectedType });
        json(res, 415, {
          error: 'unsupported_image',
          message: 'That image format is not supported. JPEG or PNG works.',
        });
        return;
      }
      const detail =
        err instanceof DiagnosisServiceError ? `${err.provider}: ${err.detail}` : errText(err);
      fail(res, rid, 502, 'diagnosis_failed', 'The plant service did not answer.', detail);
    }
    return;
  }

  // ── POST /api/care-plan ─────────────────────────────────────────────────────
  // Care guidance for a whole GENUS, covering every growing medium in one
  // answer. Billable and gated like any other model call. The client caches the
  // result forever (src/lib/genusCarePlan.ts), so in practice this is one call
  // per genus per install, not one per plant.
  if (u.pathname === '/api/care-plan' && req.method === 'POST') {
    const decision = gate.check(ip, secret);
    if (!decision.allow) {
      json(res, decision.status, { error: decision.code, message: decision.message });
      return;
    }

    let genus: string;
    let family: string;
    let lang: Lang = 'en';
    try {
      const body = JSON.parse((await readBody(req)).toString('utf8'));
      genus = typeof body?.genus === 'string' ? body.genus.trim() : '';
      family = typeof body?.family === 'string' ? body.family.trim() : '';
      lang = readLang(body?.lang);
      if (!genus) {
        json(res, 400, { error: 'bad_request', message: 'genus is required.' });
        return;
      }
      /*
       * A genus is one word and a family two at most. Anything longer is not a
       * plant name, it is someone using a billable model call as a free prompt
       * - the text goes straight into the prompt, so the length cap is the
       * cheap half of not being an open text-completion endpoint.
       */
      if (genus.length > 60 || family.length > 60) {
        json(res, 400, { error: 'bad_request', message: 'genus and family must be plant names.' });
        return;
      }
    } catch (err: unknown) {
      const tooBig = err instanceof PayloadTooLarge;
      fail(
        res,
        rid,
        tooBig ? 413 : 400,
        tooBig ? 'payload_too_large' : 'bad_request',
        tooBig ? 'That request is too large to send.' : 'That request could not be read.',
        errText(err)
      );
      return;
    }

    const t0 = Date.now();
    logEvent(rid, 'care_plan_start', { genus, family, lang });
    try {
      const plan = await buildCarePlan(genus, family, carePlanDeps, lang);
      logEvent(rid, 'care_plan_done', {
        genus,
        media: Object.keys(plan.bySoil).length,
        ms: Date.now() - t0,
      });
      json(res, 200, plan);
    } catch (err: unknown) {
      // The detail names the medium that failed to validate, or carries the
      // provider's own body - useful in the log, never in the response.
      const detail = err instanceof CarePlanError ? err.detail : errText(err);
      fail(res, rid, 502, 'care_plan_failed', 'The care advice service did not answer.', detail);
    }
    return;
  }

  // ── POST /api/nurseries ─ start a scrape job ────────────────────────────────
  if (u.pathname === '/api/nurseries' && req.method === 'POST') {
    /*
     * Secret-only check first. The billable gate is applied further down, AFTER
     * the cache lookup: an answer we already hold costs nothing to serve, and
     * charging it against the daily cap would let yesterday's cached searches
     * lock a user out of today's real one.
     */
    const auth = gate.checkSecret(ip, secret);
    if (!auth.allow) {
      json(res, auth.status, { error: auth.code, message: auth.message });
      return;
    }

    let input: { plant: string; lat: number; lng: number; radiusM: number; force: boolean };
    try {
      const body = JSON.parse((await readBody(req)).toString('utf8'));
      const plant = typeof body?.plant === 'string' ? body.plant.trim() : '';
      const lat = Number(body?.lat);
      const lng = Number(body?.lng);
      const radiusM = Number(body?.radius) || 10000;
      /* The user asked for fresh stock rather than what we last saw. */
      const force = body?.force === true;
      // Number(null) is 0 and 0 is finite, so a missing lat/lng would otherwise
      // pass validation and trigger a real (paid) scrape at 0,0.
      if (!plant || body?.lat == null || body?.lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
        json(res, 400, { error: 'bad_request', message: 'plant, lat and lng are required.' });
        return;
      }
      input = { plant, lat, lng, radiusM, force };
    } catch (err: unknown) {
      fail(res, rid, 400, 'bad_request', 'That request could not be read.', errText(err));
      return;
    }

    // One definition of "the same search", shared by the in-process job dedupe
    // (which stops a retry tap buying a second scrape) and the durable cache
    // below - the two must never disagree about what counts as identical.
    const parts = { query: input.plant, lat: input.lat, lng: input.lng, radiusM: input.radiusM };
    const key = searchKey(parts);

    /*
     * The whole point of the cache: a plant diagnosed yesterday warmed this
     * search, so the treatment the user came back for opens instantly instead
     * of starting an eight-minute job. `scrapedAt` travels with it so the app
     * can say how old the stock check is rather than implying it is live.
     */
    if (!input.force) {
      const hit = await nurseryCache.get(parts);
      if (hit) {
        logEvent(rid, 'nursery_cache_hit', {
          plant: input.plant,
          count: hit.results.length,
          ageMs: Date.now() - hit.scrapedAt,
        });
        json(res, 200, { state: 'done', results: hit.results, scrapedAt: hit.scrapedAt });
        return;
      }
    }

    // Only now is this billable: a real scrape is about to be paid for.
    const decision = gate.check(ip, secret);
    if (!decision.allow) {
      json(res, decision.status, { error: decision.code, message: decision.message });
      return;
    }

    const t0 = Date.now();
    const job = jobs.start(key, async () => {
      logEvent(rid, 'nursery_scrape_start', { plant: input.plant, lat: input.lat, lng: input.lng, radiusM: input.radiusM });
      const results = await runNurserySearch(
        { plantName: input.plant, lat: input.lat, lng: input.lng, radiusM: input.radiusM },
        deps
      );
      recordSuccess('nursery_scrape');
      logEvent(rid, 'nursery_scrape_done', { count: results.length, ms: Date.now() - t0 });
      /*
       * Awaited, not fired and forgotten: the job's result is only handed to
       * the client once this resolves, and a write that lands after the process
       * exits is a scrape paid for and thrown away. The cache swallows its own
       * failures, so this cannot fail the job.
       */
      await nurseryCache.put(parts, results);
      return results;
    });

    json(res, 202, { jobId: job.id, state: job.state });
    return;
  }

  // ── GET /api/nurseries/job/:id ─ poll ───────────────────────────────────────
  if (u.pathname.startsWith('/api/nurseries/job/') && req.method === 'GET') {
    // Polling is free: it does not touch the daily cap or the burst limit, so
    // waiting on a long job cannot rate-limit the client out of its own result.
    const decision = gate.checkSecret(ip, secret);
    if (!decision.allow) {
      json(res, decision.status, { error: decision.code, message: decision.message });
      return;
    }

    const id = u.pathname.slice('/api/nurseries/job/'.length);
    const job = jobs.get(id);
    if (!job) {
      // Either a bad id or a job we swept. Distinct code so the app knows to
      // start a new one rather than showing an error.
      json(res, 404, { error: 'unknown_job', message: 'That search has expired.' });
      return;
    }

    if (job.state === 'running') {
      json(res, 200, { state: 'running', elapsedMs: Date.now() - job.startedAt });
      return;
    }
    if (job.state === 'error') {
      json(res, 200, { state: 'error', error: job.errorCode ?? 'scrape_failed' });
      return;
    }
    // `finishedAt` doubles as the stock-check stamp for a freshly scraped
    // result, so the app renders the same "checked X ago" line either way.
    json(res, 200, { state: 'done', results: job.result ?? [], scrapedAt: job.finishedAt });
    return;
  }

  json(res, 404, { error: 'not_found', message: 'Not found.' });
});

function firstHeader(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function errText(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

server.listen(PORT, () => {
  const s = gate.stats();
  console.log(`PlantAI API → http://localhost:${PORT}`);
  console.log(`gate: ${gate.mode} mode · ${s.cap} requests/day · ${readGateConfig(env).perMinutePerIp}/min per IP`);
  if (gate.mode === 'log') {
    console.log('gate is LOG-ONLY - nothing is blocked yet. Set GATE_MODE=enforce once the app ships with the secret.');
  }
});
