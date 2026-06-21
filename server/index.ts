#!/usr/bin/env node
/*
 * Nursery API server. GET /api/nurseries?plant=&lat=&lng=&radius= → NurseryResult[].
 * Keys are read from server env (plain names preferred, EXPO_PUBLIC_* fallback
 * for local dev). Framework-free (Node http) so it containerizes for AWS.
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
import { runNurserySearch, type PipelineDeps } from '../scraper/pipeline.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 4000;

loadEnv(path.join(ROOT, '.env'));
const env = (k: string) => process.env[k] || process.env[`EXPO_PUBLIC_${k}`];
const FIRECRAWL_KEY = env('FIRECRAWL_API_KEY');
const OPENAI_KEY = env('OPENAI_API_KEY');
const TAVILY_KEY = env('TAVILY_API_KEY');
const GOOGLE_KEY = env('GOOGLE_MAPS_API_KEY');

if (!FIRECRAWL_KEY || !OPENAI_KEY || !GOOGLE_KEY) {
  console.error('Missing FIRECRAWL_API_KEY / OPENAI_API_KEY / GOOGLE_MAPS_API_KEY');
  process.exit(1);
}

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

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (u.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }

  if (u.pathname === '/api/nurseries') {
    const plant = u.searchParams.get('plant') ?? '';
    const latRaw = u.searchParams.get('lat');
    const lngRaw = u.searchParams.get('lng');
    const lat = Number(latRaw);
    const lng = Number(lngRaw);
    const radiusM = Number(u.searchParams.get('radius')) || 10000;
    // Guard the RAW params: Number(null) is 0 (finite), so a missing lat/lng
    // would otherwise pass validation and trigger a real scrape at 0,0.
    if (!plant || !latRaw || !lngRaw || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'plant, lat, lng are required' }));
      return;
    }
    const t0 = Date.now();
    console.log(`🔍 /api/nurseries plant="${plant}" @ ${lat},${lng} r=${radiusM}m`);
    try {
      const results = await runNurserySearch({ plantName: plant, lat, lng, radiusM }, deps);
      console.log(`✔ ${results.length} nurseries in ${Date.now() - t0}ms`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(results));
    } catch (err: any) {
      console.error(`❌ ${err.message} (${Date.now() - t0}ms)`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => console.log(`Nursery API → http://localhost:${PORT}`));
