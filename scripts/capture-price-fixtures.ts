#!/usr/bin/env npx tsx
/**
 * Captures the golden set for the price-accuracy suite (SCRAPE-ACCURACY-PLAN
 * Phase 0). For every known nursery host it builds the search URL the real
 * pipeline would build, then saves BOTH readings of that page:
 *
 *   <host>__<slug>.md    the markdown the current pipeline sees (Tavily/Firecrawl)
 *   <host>__<slug>.html  the page as served, fetched directly (free, no provider)
 *
 * The markdown is what today's extractor works from, so it is the baseline. The
 * HTML is what Phase 1 needs: JSON-LD, microdata and og:price live there and are
 * deleted by every markdown conversion before we ever see them.
 *
 * Run once, commit the output, and the suite runs offline forever after:
 *   npx tsx scripts/capture-price-fixtures.ts
 *   npx tsx scripts/capture-price-fixtures.ts getzler.co.il   # one host
 *
 * This costs real scrape credits. It is deliberately a separate script and not
 * part of the test run.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { loadEnv, env, createSearcher, loadHostPlatforms } from '../scraper/core.ts';

const ROOT = path.join(__dirname, '..');
loadEnv(path.join(ROOT, '.env'));

const FIRECRAWL_KEY = env('FIRECRAWL_API_KEY');
const TAVILY_KEY = env('TAVILY_API_KEY');
const HOSTS_FILE = path.join(ROOT, 'scraper', 'known-hosts.json');
const OUT_DIR = path.join(ROOT, 'scraper', 'fixtures');

if (!FIRECRAWL_KEY) {
  console.error('Missing FIRECRAWL_API_KEY in .env');
  process.exit(1);
}

/*
 * Queries chosen to be stocked almost everywhere, so a miss is our bug and not
 * an empty shelf. Hebrew, because that is what the pipeline types into the
 * shop's own search box.
 */
const QUERIES = [
  { slug: 'monstera', term: 'מונסטרה' },
  { slug: 'pothos', term: 'פותוס' },
];

/* A browser-ish UA: some shops serve a stub to unknown agents. */
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/* The page as served. Free, no provider, and the only place structured data
 * survives. A failure here is fine - Phase 1 falls back to Firecrawl rawHtml. */
async function fetchDirectHtml(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return '';
    return await res.text();
  } catch {
    return '';
  }
}

async function main(): Promise<void> {
  const only = process.argv[2];
  const hosts = loadHostPlatforms(HOSTS_FILE);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  /*
   * Capture through the real searcher, not a hand-built URL. It identifies the
   * platform, probes candidates and reports which URL it actually read, so the
   * fixture is the page production would have seen - including for hosts whose
   * cached platform is wrong (getzler.co.il is remembered as shopify and serves
   * WordPress, so the shopify /search?q= URL 404s).
   */
  const searcher = createSearcher(FIRECRAWL_KEY!, {
    tavilyKey: TAVILY_KEY,
    openaiKey: env('OPENAI_API_KEY'),
    hostsFile: HOSTS_FILE,
  });

  const manifest: Array<Record<string, unknown>> = [];

  for (const host of Object.keys(hosts)) {
    if (only && host !== only) continue;
    const origin = `https://${host}`;
    for (const { slug, term } of QUERIES) {
      process.stdout.write(`${host} ${slug} ... `);
      let md = '';
      let platform = 'unknown';
      let picked: string | null = null;
      try {
        const res = await searcher.fetchSearchMarkdown(origin, term, host);
        md = res.md;
        platform = res.platform;
        picked = res.picked;
      } catch (err) {
        process.stdout.write(`search failed (${(err as Error).message}) `);
      }
      const html = picked ? await fetchDirectHtml(picked) : '';

      // Gzipped: the golden set is 16MB raw and 2MB compressed, and the repo
      // does not need the other 14MB to answer the same question. scraper/
      // fixtures.ts decompresses on read.
      const base = `${host}__${slug}`;
      const save = (name: string, body: string) =>
        fs.writeFileSync(path.join(OUT_DIR, `${name}.gz`), zlib.gzipSync(body, { level: 9 }));
      if (md) save(`${base}.md`, md);
      if (html) save(`${base}.html`, html);
      console.log(`[${platform}] md ${md.length}B, html ${html.length}B`);

      manifest.push({
        host,
        platform,
        query: term,
        slug,
        url: picked,
        markdownFile: md ? `${base}.md` : null,
        htmlFile: html ? `${base}.html` : null,
        mdChars: md.length,
        htmlChars: html.length,
        /*
         * Filled in by hand after capture: the price a human reads on the page
         * for the first matching product, or null when the shop genuinely does
         * not sell it. The accuracy metric is only meaningful against this.
         */
        truePrice: null,
      });
    }
  }

  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`\n${manifest.length} fixtures → ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
