#!/usr/bin/env npx tsx
/**
 * Captures the golden set for the RETRIEVAL suite.
 *
 * For every known nursery host it asks the shop the same question the pipeline
 * asks - "do you sell this plant" - by whichever route we would really use, and
 * saves the shop's raw answer:
 *
 *   WooCommerce   the Store API response, per plant, for BOTH term variants
 *   Shopify       the whole /products.json catalogue, once, page by page
 *   neither       the HTML search page, per plant, for both term variants
 *
 * BOTH VARIANTS IS THE POINT. `full` is the whole plant name, which is what the
 * pipeline sends today; `broad` is the genus alone. WordPress `?s=` and the Woo
 * Store API both AND every word, so the two answers differ enormously, and
 * capturing only one would bake today's strategy into the fixtures and make the
 * comparison unprovable.
 *
 * UNLIKE capture-price-fixtures.ts, THIS IS FREE. Every route above is a plain
 * unmetered request to the shop - no Firecrawl, no Tavily, no OpenAI - so this
 * can be re-run whenever the truth needs refreshing.
 *
 *   npx tsx scripts/capture-retrieval-fixtures.ts
 *   npx tsx scripts/capture-retrieval-fixtures.ts al-haderech.co.il   # one host
 */

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import * as crypto from 'crypto';
import { loadHostPlatforms, searchUrlsFor } from '../scraper/core.ts';
import {
  probeApiRoute,
  wooSearchUrl,
  shopifyPageUrl,
  SHOPIFY_PAGE_SIZE,
  SHOPIFY_MAX_PAGES,
  API_TIMEOUT_MS,
  type ApiRoute,
} from '../scraper/platformApi.ts';
import {
  PLANTS,
  RETRIEVAL_FIXTURE_DIR,
  type RetrievalFixture,
  type TermVariant,
} from '../scraper/retrievalFixtures.ts';

const ROOT = path.join(__dirname, '..');
const HOSTS_FILE = path.join(ROOT, 'scraper', 'known-hosts.json');
const OUT_DIR = RETRIEVAL_FIXTURE_DIR;

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

interface Fetched {
  body: string;
  status: number;
}

/* Never throws: a shop that is down is a fixture with status 0, which is itself
 * a thing the suite should be able to reason about. */
async function get(url: string, accept: string): Promise<Fetched> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': BROWSER_UA, Accept: accept },
      signal: AbortSignal.timeout(API_TIMEOUT_MS * 3),
    });
    return { body: await res.text(), status: res.status };
  } catch {
    return { body: '', status: 0 };
  }
}

/*
 * Bodies are content-addressed.
 *
 * Twelve plants against a shop that stocks none of them produce twelve byte-
 * identical "no results" pages, and on a 2.5MB page that is 30MB of repo for one
 * page of information. Hashing collapses them to one file that many manifest
 * rows point at.
 */
const written = new Map<string, string>();

function saveBody(body: string, ext: string): string | null {
  if (!body) return null;
  const hash = crypto.createHash('sha256').update(body).digest('hex').slice(0, 16);
  const name = `${hash}.${ext}`;
  if (!written.has(hash)) {
    fs.writeFileSync(path.join(OUT_DIR, `${name}.gz`), zlib.gzipSync(body, { level: 9 }));
    written.set(hash, name);
  }
  return name;
}

const fixtures: RetrievalFixture[] = [];

function record(f: RetrievalFixture): void {
  fixtures.push(f);
}

async function captureWoo(host: string, origin: string, platform: string): Promise<void> {
  for (const plant of PLANTS) {
    for (const [variant, term] of [
      ['full', plant.hebrew],
      ['broad', plant.broad],
    ] as Array<[TermVariant, string]>) {
      /* A one-word plant makes both variants the same request. Capture it once
       * and let the manifest carry both rows pointing at the same body. */
      const url = wooSearchUrl(origin, term);
      const { body, status } = await get(url, 'application/json');
      const rows = countJsonRows(body);
      record({
        host, platform, route: 'woo-store', plantId: plant.id, variant, term,
        requestUrl: url, status, bodyFile: saveBody(body, 'json'), bytes: body.length,
      });
      process.stdout.write(`  ${plant.id}/${variant}: ${status} ${rows} rows\n`);
    }
  }
}

function countJsonRows(body: string): number | string {
  try {
    const v = JSON.parse(body);
    return Array.isArray(v) ? v.length : Array.isArray(v?.products) ? v.products.length : '-';
  } catch {
    return '-';
  }
}

async function captureShopify(host: string, origin: string, platform: string): Promise<void> {
  for (let page = 1; page <= SHOPIFY_MAX_PAGES; page++) {
    const url = shopifyPageUrl(origin, page, SHOPIFY_PAGE_SIZE);
    const { body, status } = await get(url, 'application/json');
    const rows = countJsonRows(body);
    record({
      host, platform, route: 'shopify-json', plantId: null, variant: null, page, term: '',
      requestUrl: url, status, bodyFile: saveBody(body, 'json'), bytes: body.length,
    });
    process.stdout.write(`  catalogue p${page}: ${status} ${rows} products\n`);
    if (typeof rows !== 'number' || rows < SHOPIFY_PAGE_SIZE) break;
  }
}

async function captureHtml(host: string, origin: string, platform: string): Promise<void> {
  for (const plant of PLANTS) {
    for (const [variant, term] of [
      ['full', plant.hebrew],
      ['broad', plant.broad],
    ] as Array<[TermVariant, string]>) {
      /* The URL the real pipeline would build for this platform - including a
       * wrong one when the remembered platform is wrong, which is exactly the
       * case we want on record. */
      const url = searchUrlsFor(origin, term, platform)[0];
      const { body, status } = await get(url, 'text/html,application/xhtml+xml');
      record({
        host, platform, route: 'html', plantId: plant.id, variant, term,
        requestUrl: url, status, bodyFile: saveBody(body, 'html'), bytes: body.length,
      });
      process.stdout.write(`  ${plant.id}/${variant}: ${status} ${body.length}B\n`);
    }
  }
}

async function main(): Promise<void> {
  const only = process.argv[2];
  const hosts = loadHostPlatforms(HOSTS_FILE);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const host of Object.keys(hosts)) {
    if (only && host !== only) continue;
    const origin = `https://${host}`;
    const platform = hosts[host].platform;

    /*
     * Probe rather than trust. known-hosts.json is what we are testing: it
     * records getzler and peer-nursery as Shopify when both are WordPress, and
     * a fixture set captured through that belief would reproduce the bug
     * instead of exposing it.
     */
    const route: ApiRoute = await probeApiRoute(origin);
    console.log(`\n${host} [remembered: ${platform}] [probed route: ${route}]`);

    if (route === 'woo-store') await captureWoo(host, origin, platform);
    else if (route === 'shopify-json') await captureShopify(host, origin, platform);
    else await captureHtml(host, origin, platform);
  }

  const manifest = { capturedAt: new Date().toISOString(), fixtures };
  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const bytes = [...written.values()].reduce(
    (n, name) => n + fs.statSync(path.join(OUT_DIR, `${name}.gz`)).size,
    0
  );
  console.log(
    `\n${fixtures.length} fixtures over ${written.size} unique bodies ` +
      `(${(bytes / 1e6).toFixed(1)}MB gzipped) → ${OUT_DIR}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
