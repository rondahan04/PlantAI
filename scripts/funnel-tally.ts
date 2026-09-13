#!/usr/bin/env npx tsx
/**
 * The scrape success-rate measurement (TODOS "Scrape success rate").
 *
 * WHY THIS EXISTS AND scripts/retrieval-accuracy.ts DOES NOT ANSWER IT.
 * That harness replays shop pages AS SERVED, grades the deterministic half
 * (platform mappers, query ladder, ranking) and scores 100%. It is offline by
 * design and never calls a provider. So it is structurally blind to the failure
 * this script is for: the shops whose page we never managed to READ. Those
 * never became a fixture, because capture could not read them either.
 *
 * WHAT IT MEASURES. One real search per plant, over the real fan-out - a live
 * Places discovery plus the shipper list - recording where each site's read
 * actually stopped. That is `SiteStage`, which the pipeline already computes and
 * server/scrapeHealth.ts already retains; this script is the part that was
 * missing, which is running it deliberately over a known corpus and tallying
 * the result instead of waiting for user traffic to happen upon a broken shop.
 *
 * THE DISTINCTION THE TALLY IS BUILT AROUND. `readable()` splits the stages in
 * two, and only one half is our problem:
 *
 *   readable    ok / no_match / rejected   we read the catalogue. A zero here
 *                                          means the shop does not stock it,
 *                                          which is the normal, correct answer.
 *   unreadable  no_markdown / no_excerpt   we never read the catalogue. Every
 *               / no_search / timeout /    one of these is a shop the user was
 *               error                      silently not told about.
 *
 * Success rate is the readable share. Chasing the readable-half buckets would
 * be optimising a number that is already right.
 *
 * THIS COSTS MONEY. Every run spends Tavily extracts, Firecrawl renders and
 * OpenAI extract/audit/plan calls, once per plant per site. Default is two
 * plants; raise it deliberately.
 *
 *   npx tsx scripts/funnel-tally.ts
 *   npx tsx scripts/funnel-tally.ts --plants "מונסטרה,פותוס,סנסוויריה"
 *   npx tsx scripts/funnel-tally.ts --lat 32.0853 --lng 34.7818 --radius 10000
 *   npx tsx scripts/funnel-tally.ts --json scraper/funnel-tally.json
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  loadEnv,
  env,
  createSearcher,
  extractAndVerifyPlants,
  inferAvailabilityLLM,
  sanityCheckPrices,
  planQuery,
  scrapeUrl,
  hostOf,
} from '../scraper/core.ts';
import { discoverNurseries, resolvePhotoUrl } from '../scraper/places.ts';
import { runNurserySearch, type PipelineDeps } from '../scraper/pipeline.ts';
import { readable, type SiteStage } from '../server/scrapeHealth.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

loadEnv(path.join(ROOT, '.env'));

const FIRECRAWL_KEY = env('FIRECRAWL_API_KEY');
const OPENAI_KEY = env('OPENAI_API_KEY');
const TAVILY_KEY = env('TAVILY_API_KEY');
const GOOGLE_KEY = env('GOOGLE_MAPS_API_KEY');

if (!FIRECRAWL_KEY || !OPENAI_KEY || !GOOGLE_KEY) {
  console.error(
    'Missing EXPO_PUBLIC_FIRECRAWL_API_KEY, EXPO_PUBLIC_OPENAI_API_KEY or ' +
      'EXPO_PUBLIC_GOOGLE_MAPS_API_KEY in .env'
  );
  process.exit(1);
}
if (!TAVILY_KEY) {
  /* Not fatal, but the numbers would not describe production: without a Tavily
   * key `tavilyLeads` is false and every read goes back to Firecrawl-first,
   * which is the pre-2026-09 pipeline and not the one we are measuring. */
  console.warn('No EXPO_PUBLIC_TAVILY_API_KEY - this measures the Firecrawl-led path, not production.');
}

// --- args -------------------------------------------------------------------

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/* Two plants by default, one common and one less so. The pair matters: a plant
 * every shop stocks cannot produce a `no_match`, so a corpus of only those
 * would report a readability problem where there is a stock one, and vice
 * versa. */
const PLANTS = arg('plants', 'monstera,alocasia regal shield')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/* Central Tel Aviv, the densest nursery area in the country - so a 10km radius
 * returns a full fan-out rather than the three shops a quieter origin would. */
const LAT = Number(arg('lat', '32.0853'));
const LNG = Number(arg('lng', '34.7818'));
const RADIUS_M = Number(arg('radius', '10000'));
const JSON_OUT = arg('json', '');

// --- deps (mirrors server/index.ts) -----------------------------------------

function readUrlList(file: string): string[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

const readFallbackUrls = () => readUrlList(path.join(ROOT, 'data', 'nurseries-fallback.txt'));
const NATIONAL_NURSERIES = readUrlList(path.join(ROOT, 'data', 'nurseries-shippers.txt'));

/*
 * ONE searcher for the whole run, exactly as the server holds one for its
 * lifetime. Sharing it is not an optimisation detail - it is what makes the
 * numbers honest. A fresh searcher per plant would re-identify every platform
 * and re-pull every Shopify catalogue, so plant #2 would be measured on a cold
 * cache that production never has.
 */
const searcher = createSearcher(FIRECRAWL_KEY, {
  openaiKey: OPENAI_KEY,
  learnedFile: path.join(ROOT, 'scraper', 'learned-platforms.json'),
  hostsFile: path.join(ROOT, 'scraper', 'known-hosts.json'),
  tavilyKey: TAVILY_KEY,
  apiEnabled: env('RETRIEVAL_API') !== '0',
});

interface Observation {
  plant: string;
  host: string;
  stage: SiteStage;
}

const observations: Observation[] = [];

/*
 * Shops the fan-out returned but never READ, per plant.
 *
 * These never reach the funnel at all: scrapeOne answers `no_website` and
 * returns before noteSite fires, so a tally built only from onSiteRead cannot
 * see them. It has to, because on the first real run they were the majority -
 * 10 of 23 - and a 96% success rate over the other 13 describes a smaller
 * system than the one the user is looking at.
 */
const unscrapable = new Map<string, number>();

/* Which plant the current fan-out is for. The observer is called deep inside
 * the pipeline, which knows nothing about our corpus, so the label is carried
 * here rather than threaded through PipelineDeps. Safe because searches run
 * strictly one at a time - see main(). */
let currentPlant = '';

const deps: PipelineDeps = {
  discover: (lat, lng, radiusM) =>
    discoverNurseries(lat, lng, GOOGLE_KEY!, { radiusM, richFields: true }),
  search: (website, query, host) => searcher.fetchSearchMarkdown(website, query, host),
  extract: (o) => extractAndVerifyPlants({ ...o, openaiKey: OPENAI_KEY }),
  plan: (plantName) => planQuery(plantName, OPENAI_KEY!),
  checkPrices: (query, candidates) => sanityCheckPrices(query, candidates, OPENAI_KEY!),
  scrapeHome: async (origin) =>
    searcher.cachedHomeMarkdown(hostOf(origin)) ||
    scrapeUrl(origin, FIRECRAWL_KEY!, { tavilyKey: TAVILY_KEY }),
  infer: (homeMd, query, site) => inferAvailabilityLLM(homeMd, query, site, OPENAI_KEY!),
  resolvePhoto: (photoName) => resolvePhotoUrl(photoName, GOOGLE_KEY!),
  readFallbackUrls,
  nationalUrls: NATIONAL_NURSERIES,
  onSiteRead: (host, stage) => {
    observations.push({ plant: currentPlant, host, stage });
  },
};

// --- report -----------------------------------------------------------------

const STAGES: SiteStage[] = [
  'ok',
  'no_match',
  'rejected',
  'no_markdown',
  'no_excerpt',
  'no_search',
  'timeout',
  'error',
];

const pad = (s: string, n: number) => s.padEnd(n).slice(0, n);
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '-');

function report(): void {
  if (!observations.length) {
    console.error('No sites observed. Did discovery return anything?');
    process.exit(1);
  }

  const total = observations.length;
  const counts = new Map<SiteStage, number>();
  for (const o of observations) counts.set(o.stage, (counts.get(o.stage) ?? 0) + 1);

  const read = observations.filter((o) => readable(o.stage)).length;
  const skipped = [...unscrapable.values()].reduce((a, b) => a + b, 0);
  const shown = total + skipped;

  console.log('');
  console.log('='.repeat(72));
  console.log(`SCRAPE SUCCESS RATE   ${read}/${total} site reads reached the catalogue (${pct(read, total)})`);
  console.log('='.repeat(72));
  console.log(`${PLANTS.length} plant(s) x ${total / PLANTS.length} site(s) - ${LAT},${LNG} r=${RADIUS_M}m`);
  console.log('');

  /*
   * Two denominators, and confusing them is how a healthy funnel hides an
   * unhealthy product. The first is the scraper's number; the second is the
   * user's, and no amount of extraction work moves it.
   */
  if (skipped) {
    console.log(
      `Of ${shown} shops shown to the user, ${skipped} (${pct(skipped, shown)}) have no website ` +
        `in Places and were never scraped at all.`
    );
    console.log(
      `Answered end to end: ${read}/${shown} (${pct(read, shown)}).`
    );
    console.log('');
  }

  console.log(`${pad('stage', 14)} ${pad('n', 5)} ${pad('share', 7)} meaning`);
  console.log('-'.repeat(72));
  for (const stage of STAGES) {
    const n = counts.get(stage) ?? 0;
    if (!n) continue;
    const mark = readable(stage) ? '  ' : '!!';
    console.log(
      `${mark} ${pad(stage, 11)} ${pad(String(n), 5)} ${pad(pct(n, total), 7)} ` +
        (readable(stage) ? 'we read the catalogue' : 'WE NEVER READ THE CATALOGUE')
    );
  }

  /*
   * The hosts that failed, worst first. The tally says which bucket to fix; this
   * says which shop to open in a browser to find out why - and a bucket with one
   * host behind it is a site-specific bug, not a pipeline one.
   */
  const byHost = new Map<string, Observation[]>();
  for (const o of observations) {
    if (!byHost.has(o.host)) byHost.set(o.host, []);
    byHost.get(o.host)!.push(o);
  }

  const broken = [...byHost.entries()]
    .map(([host, obs]) => ({
      host,
      obs,
      unreadable: obs.filter((o) => !readable(o.stage)).length,
    }))
    .filter((h) => h.unreadable > 0)
    .sort((a, b) => b.unreadable - a.unreadable || a.host.localeCompare(b.host));

  if (broken.length) {
    console.log('');
    console.log('UNREADABLE HOSTS (the shops a user was silently not told about)');
    console.log('-'.repeat(72));
    console.log(`${pad('host', 30)} ${pad('failed', 8)} stages`);
    for (const h of broken) {
      const stages = h.obs.map((o) => `${o.plant.split(' ')[0]}=${o.stage}`).join(' ');
      console.log(`${pad(h.host, 30)} ${pad(`${h.unreadable}/${h.obs.length}`, 8)} ${stages}`);
    }
  }

  const dominant = STAGES.filter((s) => !readable(s))
    .map((s) => ({ s, n: counts.get(s) ?? 0 }))
    .sort((a, b) => b.n - a.n)[0];

  console.log('');
  if (!dominant || dominant.n === 0) {
    console.log('No unreadable sites in this run. Nothing to fix from this corpus.');
  } else {
    console.log(`Dominant failure bucket: ${dominant.s} (${dominant.n}/${total}, ${pct(dominant.n, total)})`);
  }
  console.log('');

  if (JSON_OUT) {
    const out = path.isAbsolute(JSON_OUT) ? JSON_OUT : path.join(ROOT, JSON_OUT);
    fs.writeFileSync(
      out,
      JSON.stringify(
        {
          at: new Date().toISOString(),
          origin: { lat: LAT, lng: LNG, radiusM: RADIUS_M },
          plants: PLANTS,
          readable: read,
          total,
          counts: Object.fromEntries(counts),
          observations,
        },
        null,
        2
      )
    );
    console.log(`Wrote ${out}`);
  }
}

// --- run --------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`Measuring ${PLANTS.length} plant(s) against a live ${RADIUS_M / 1000}km fan-out. This spends credits.`);

  /*
   * Plants run one after another, never in parallel. Both providers are rate
   * limited per minute (Firecrawl especially), and overlapping two full
   * fan-outs would manufacture timeouts that production - which runs one search
   * at a time per user - does not have. A measurement that creates the failure
   * it is measuring is worse than none.
   */
  for (const plant of PLANTS) {
    currentPlant = plant;
    const started = Date.now();
    process.stdout.write(`\n[${plant}] searching... `);
    try {
      const results = await runNurserySearch({ plantName: plant, lat: LAT, lng: LNG, radiusM: RADIUS_M }, deps);
      const found = results.filter((r) => r.hasPlant).length;
      const noSite = results.filter((r) => r.availability?.kind === 'no_website').length;
      unscrapable.set(plant, noSite);
      console.log(
        `${results.length} shops (${noSite} with no website), ${found} with the plant, ` +
          `${Math.round((Date.now() - started) / 1000)}s`
      );
    } catch (err: unknown) {
      console.log(`FAILED: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  report();
}

main();
