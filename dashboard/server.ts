#!/usr/bin/env node
/**
 * Scraper test dashboard.
 *
 * Run:  node dashboard/server.ts   (then open http://localhost:4000)
 * Env:  EXPO_PUBLIC_FIRECRAWL_API_KEY, EXPO_PUBLIC_OPENAI_API_KEY (from ../.env)
 *
 * Enter a query -> for each nursery URL in ../nurseries_scraping_testing,
 * detect the store platform, hit its product-search, extract matching items +
 * prices (ILS) via OpenAI, and render them in a table. All scraping logic
 * lives in ../scraper/core.ts (shared with scripts/scrape-nurseries.ts).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import { fileURLToPath } from 'url';
import {
  loadEnv,
  createSearcher,
  extractAndVerifyPlants,
} from '../scraper/core.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = 4000;

// Tee all console output to scraper/scrape.log (appended, with timestamps)
// so scrape runs are reviewable after the fact.
const LOG_PATH = path.join(ROOT, 'scraper', 'scrape.log');
const logStream = fs.createWriteStream(LOG_PATH, { flags: 'a' });
for (const level of ['log', 'error', 'warn'] as const) {
  const orig = console[level].bind(console);
  console[level] = (...args: any[]) => {
    orig(...args);
    const line = args
      .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
      .join(' ');
    logStream.write(`[${new Date().toISOString()}] ${line}\n`);
  };
}

loadEnv(path.join(ROOT, '.env'));

const FIRECRAWL_KEY = process.env.EXPO_PUBLIC_FIRECRAWL_API_KEY;
const OPENAI_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
const TAVILY_KEY = process.env.EXPO_PUBLIC_TAVILY_API_KEY; // optional Firecrawl fallback
const URLS_PATH = path.join(ROOT, 'nurseries_scraping_testing');

if (!FIRECRAWL_KEY || !OPENAI_KEY) {
  console.error('Missing EXPO_PUBLIC_FIRECRAWL_API_KEY or EXPO_PUBLIC_OPENAI_API_KEY in .env');
  process.exit(1);
}

const searcher = createSearcher(FIRECRAWL_KEY, {
  openaiKey: OPENAI_KEY,
  learnedFile: path.join(__dirname, '..', 'scraper', 'learned-platforms.json'),
  tavilyKey: TAVILY_KEY,
});

interface Row {
  site: string;
  name: string;
  price: string;
  availability: string;
  error?: boolean;
}

function readUrls(): string[] {
  return fs
    .readFileSync(URLS_PATH, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && l.startsWith('http'));
}

async function handleScrape(query: string): Promise<Row[]> {
  const urls = readUrls();
  const t0 = Date.now();
  console.log(`\n🔍 SEARCH "${query}" — ${urls.length} sites @ ${new Date().toISOString()}`);
  const results = await Promise.all(
    urls.map(async (url): Promise<Row[]> => {
      const site = new URL(url).hostname.replace(/^www\./, '');
      const ts = Date.now();
      try {
        const { md, platform, picked } = await searcher.fetchSearchMarkdown(url, query, site);
        console.log(`   [${site}] platform=${platform} picked=${picked}`);
        const { plants, report, engines } = await extractAndVerifyPlants({
          markdown: md,
          query,
          site,
          openaiKey: OPENAI_KEY,
        });
        console.log(
          `   [${site}] ✅ ${plants.length} item(s) [${engines.extractor}→${engines.verifier}] ` +
            `valid=${report.is_valid} conf=${report.confidence_score} in ${Date.now() - ts}ms`
        );
        return plants.map((p) => ({
          site,
          name: p.name,
          price: p.price,
          availability: p.availability,
        }));
      } catch (err: any) {
        console.log(`   [${site}] ❌ ${err.message} (${Date.now() - ts}ms)`);
        return [{ site, name: `ERROR: ${err.message}`, price: '—', availability: '—', error: true }];
      }
    })
  );
  // Dedup identical site+name+price rows (search grids repeat products).
  const seen = new Set<string>();
  const flat = results.flat().filter((r) => {
    const k = `${r.site}|${r.name}|${r.price}|${r.availability}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  console.log(`✔ DONE "${query}" — ${flat.length} rows in ${Date.now() - t0}ms\n`);
  return flat;
}

const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Nursery Scraper Test</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, sans-serif; max-width: 860px; margin: 40px auto; padding: 0 20px; background: #fff; color: #111; }
  input { background: #fff; color: #111; }
  td, th { color: #111; }
  h1 { font-size: 1.4rem; margin-bottom: 4px; }
  p.sub { color: #888; margin-top: 0; font-size: .9rem; }
  form { display: flex; gap: 8px; margin: 20px 0; }
  input { flex: 1; padding: 10px 12px; font-size: 1rem; border: 1px solid #ccc; border-radius: 8px; }
  button { padding: 10px 18px; font-size: 1rem; border: 0; border-radius: 8px; background: #2e7d32; color: #fff; cursor: pointer; }
  button:disabled { opacity: .5; cursor: wait; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; }
  th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #eee3; }
  th { font-size: .8rem; text-transform: uppercase; letter-spacing: .04em; color: #888; }
  td.price { font-variant-numeric: tabular-nums; white-space: nowrap; font-weight: 600; }
  .site { color: #2e7d32; font-size: .85rem; }
  .err { color: #c62828; }
  .status { margin-top: 14px; color: #888; }
</style>
</head>
<body>
  <h1>🌱 Nursery Scraper Test</h1>
  <p class="sub">Searches the nursery sites in <code>nurseries_scraping_testing</code> and lists matching items + prices (ILS).</p>
  <form id="f">
    <input id="q" placeholder="e.g. monstera, cactus, lavender…" autofocus />
    <button id="go" type="submit">Search</button>
  </form>
  <div class="status" id="status"></div>
  <table id="tbl" hidden>
    <thead><tr><th>Item</th><th>Price (ILS)</th><th>Stock</th><th>Source</th></tr></thead>
    <tbody></tbody>
  </table>

<script>
const f = document.getElementById('f');
const q = document.getElementById('q');
const go = document.getElementById('go');
const status = document.getElementById('status');
const tbl = document.getElementById('tbl');
const tbody = tbl.querySelector('tbody');

f.addEventListener('submit', async (e) => {
  e.preventDefault();
  const query = q.value.trim();
  if (!query) return;
  go.disabled = true;
  tbl.hidden = true;
  tbody.innerHTML = '';
  status.textContent = 'Scraping nurseries… (can take ~20-40s)';
  try {
    const res = await fetch('/api/scrape?q=' + encodeURIComponent(query));
    const rows = await res.json();
    if (!rows.length) {
      status.textContent = 'No matching items found.';
    } else {
      status.textContent = rows.length + ' item(s) found.';
      tbl.hidden = false;
      for (const r of rows) {
        const tr = document.createElement('tr');
        tr.innerHTML =
          '<td class="' + (r.error ? 'err' : '') + '">' + esc(r.name) + '</td>' +
          '<td class="price">' + esc(r.price) + '</td>' +
          '<td class="stock">' + esc(r.availability || '') + '</td>' +
          '<td class="site">' + esc(r.site) + '</td>';
        tbody.appendChild(tr);
      }
    }
  } catch (err) {
    status.textContent = 'Error: ' + err.message;
  } finally {
    go.disabled = false;
  }
});

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
}
</script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  if (u.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML);
    return;
  }

  if (u.pathname === '/api/scrape') {
    const query = u.searchParams.get('q') ?? '';
    try {
      const rows = await handleScrape(query);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(rows));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Scraper dashboard running -> http://localhost:${PORT}`);
});
