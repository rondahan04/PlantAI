#!/usr/bin/env node
/*
 * PlantAI API server. Framework-free (Node http) so it containerizes cleanly.
 *
 * Routes
 *   GET  /health                    → liveness + gate/job counters (O1, O3)
 *   POST /api/diagnose              → PlantDiagnosis            (A3, billable)
 *   POST /api/nurseries             → { jobId }                 (E12, billable)
 *   GET  /api/nurseries/job/:id     → job state / result        (E12, free)
 *
 * Every billable route goes through the gate (A1): shared secret, per-IP burst
 * limit, hard daily cap. Read server/gate.ts before changing anything about it
 * — in particular, the shared secret is NOT authentication.
 *
 * Keys are read from server env (plain names preferred, EXPO_PUBLIC_* fallback
 * for local dev only — nothing here should ship to a phone).
 *
 * Run:  node server/index.ts   (or npm run server)
 */
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  loadEnv,
  createSearcher,
  extractAndVerifyPlants,
  inferAvailabilityLLM,
  scrapeUrl,
} from '../scraper/core.ts';
import { discoverNurseries, resolvePhotoUrl } from '../scraper/places.ts';
import { runNurserySearch, type PipelineDeps, type NurseryResult } from '../scraper/pipeline.ts';
import { clientIp, createGate, readGateConfig } from './gate.ts';
import { createJobStore } from './jobs.ts';
import {
  DiagnosisServiceError,
  NotAPlantError,
  UnsupportedImageError,
  diagnose,
  openAiAssessHealth,
  plantNetIdentify,
  type DiagnosisDeps,
} from './diagnose.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 4000;

loadEnv(path.join(ROOT, '.env'));
const env = (k: string) => process.env[k] || process.env[`EXPO_PUBLIC_${k}`];
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
 * CORS is emitted only when CORS_ORIGIN is set, and only for that origin. The
 * native app sends no Origin header and never needed it; the old
 * `Access-Control-Allow-Origin: *` existed for the local dashboard and made a
 * billable endpoint callable from any web page on the internet.
 */
const CORS_ORIGIN = env('CORS_ORIGIN');

const NATIONAL_NURSERIES = [
  'https://al-haderech.co.il/',
  'https://rootine.co.il/',
  'https://www.peer-nursery.co.il/',
  'https://www.plantit.co.il/',
  'https://netaplants.co.il/',
  'https://decogarden.co.il/',
];

const searcher = createSearcher(FIRECRAWL_KEY, {
  openaiKey: OPENAI_KEY,
  learnedFile: path.join(ROOT, 'scraper', 'learned-platforms.json'),
  tavilyKey: TAVILY_KEY,
});

const deps: PipelineDeps = {
  discover: (lat, lng, radiusM) =>
    discoverNurseries(lat, lng, GOOGLE_KEY!, { radiusM, richFields: true }),
  search: (website, query, host) => searcher.fetchSearchMarkdown(website, query, host),
  extract: (o) => extractAndVerifyPlants({ ...o, openaiKey: OPENAI_KEY }),
  scrapeHome: (origin) => scrapeUrl(origin, FIRECRAWL_KEY!, { tavilyKey: TAVILY_KEY }),
  infer: (homeMd, query, site) => inferAvailabilityLLM(homeMd, query, site, OPENAI_KEY!),
  resolvePhoto: (photoName) => resolvePhotoUrl(photoName, GOOGLE_KEY!),
  readFallbackUrls: () =>
    fs
      .readFileSync(path.join(ROOT, 'nurseries_scraping_testing'), 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('http')),
  nationalUrls: NATIONAL_NURSERIES,
};

const diagnosisDeps: DiagnosisDeps = {
  identify: plantNetIdentify(PLANTNET_KEY!),
  assessHealth: openAiAssessHealth(OPENAI_KEY!),
};

// ─── HTTP plumbing ────────────────────────────────────────────────────────────

/*
 * A diagnosis photo arrives as base64 JSON, so the body is roughly 4/3 the size
 * of the JPEG. `quality: 0.7` on a modern phone lands around 1-3 MB; 12 MB is
 * generous headroom and still small enough that an attacker cannot exhaust
 * memory by opening a few connections.
 */
const MAX_BODY_BYTES = 12 * 1024 * 1024;

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
 * without shell access to its logs. Bounded — this is a debugging aid, not a
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

function fail(res: http.ServerResponse, rid: string, status: number, code: string, message: string, detail: string) {
  console.error(`[${rid}] ${code}: ${detail}`);
  recordError(rid, code, detail);
  json(res, status, { error: code, message });
}

let requestSeq = 0;
const nextRequestId = () => `r${(++requestSeq).toString(36)}`;

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
  // but only for a caller holding the shared secret — provider error bodies are
  // internal detail and this endpoint is otherwise unauthenticated.
  if (u.pathname === '/health') {
    const body: Record<string, unknown> = { ok: true, gate: gate.stats(), jobs: jobs.size() };
    if (u.searchParams.get('errors') === '1') {
      body.errors = gate.checkSecret(ip, secret).allow ? recentErrors : 'secret required';
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
    try {
      const raw = await readBody(req);
      const body = JSON.parse(raw.toString('utf8'));
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
    console.log(`[${rid}] 🌿 /api/diagnose ${image.length}B`);
    try {
      const result = await diagnose(image, diagnosisDeps);
      console.log(
        `[${rid}] ✔ ${result.plantName} (${result.confidence}%) ${result.condition} in ${Date.now() - t0}ms`
      );
      json(res, 200, result);
    } catch (err: unknown) {
      if (err instanceof NotAPlantError) {
        // Not a failure of ours: the photo has no plant in it. Distinct code so
        // the app can say something true and specific about the photo.
        console.log(`[${rid}] · no plant recognized (${Date.now() - t0}ms)`);
        json(res, 422, { error: 'not_a_plant', message: 'No plant was recognized in that photo.' });
        return;
      }
      if (err instanceof UnsupportedImageError) {
        // About the file, not about us. Saying "the service did not answer"
        // here would send the user to retry a photo that can never work.
        console.log(`[${rid}] · unsupported image: ${err.detectedType}`);
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

  // ── POST /api/nurseries ─ start a scrape job ────────────────────────────────
  if (u.pathname === '/api/nurseries' && req.method === 'POST') {
    const decision = gate.check(ip, secret);
    if (!decision.allow) {
      json(res, decision.status, { error: decision.code, message: decision.message });
      return;
    }

    let input: { plant: string; lat: number; lng: number; radiusM: number };
    try {
      const body = JSON.parse((await readBody(req)).toString('utf8'));
      const plant = typeof body?.plant === 'string' ? body.plant.trim() : '';
      const lat = Number(body?.lat);
      const lng = Number(body?.lng);
      const radiusM = Number(body?.radius) || 10000;
      // Number(null) is 0 and 0 is finite, so a missing lat/lng would otherwise
      // pass validation and trigger a real (paid) scrape at 0,0.
      if (!plant || body?.lat == null || body?.lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
        json(res, 400, { error: 'bad_request', message: 'plant, lat and lng are required.' });
        return;
      }
      input = { plant, lat, lng, radiusM };
    } catch (err: unknown) {
      fail(res, rid, 400, 'bad_request', 'That request could not be read.', errText(err));
      return;
    }

    // The dedupe key is what stops a retry tap from buying a second scrape of
    // the same thing. Coordinates are rounded to ~100m; finer than that is not
    // a different set of nearby nurseries.
    const key = `${input.plant.toLowerCase()}|${input.lat.toFixed(3)}|${input.lng.toFixed(3)}|${input.radiusM}`;
    const t0 = Date.now();
    const job = jobs.start(key, async () => {
      console.log(`[${rid}] 🔍 scrape "${input.plant}" @ ${input.lat},${input.lng} r=${input.radiusM}m`);
      const results = await runNurserySearch(
        { plantName: input.plant, lat: input.lat, lng: input.lng, radiusM: input.radiusM },
        deps
      );
      console.log(`[${rid}] ✔ ${results.length} nurseries in ${Date.now() - t0}ms`);
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
    json(res, 200, { state: 'done', results: job.result ?? [] });
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
    console.log('gate is LOG-ONLY — nothing is blocked yet. Set GATE_MODE=enforce once the app ships with the secret.');
  }
});
