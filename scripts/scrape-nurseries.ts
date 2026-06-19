#!/usr/bin/env npx tsx
/**
 * Scrapes nursery websites via Firecrawl and updates assets/nurseries.json.
 *
 * Run:  npx tsx scripts/scrape-nurseries.ts
 * Env:  EXPO_PUBLIC_FIRECRAWL_API_KEY, EXPO_PUBLIC_OPENAI_API_KEY (from .env)
 *
 * Safe to run on a schedule (e.g. GitHub Actions weekly cron).
 * Only updates `plants` and `inStock` fields — other fields are preserved.
 */

import * as fs from 'fs';
import * as path from 'path';
import { loadEnv, scrapeUrl, extractAndVerifyPlants } from '../scraper/core.ts';

loadEnv(path.join(__dirname, '..', '.env'));

const FIRECRAWL_KEY = process.env.EXPO_PUBLIC_FIRECRAWL_API_KEY;
const OPENAI_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
const TAVILY_KEY = process.env.EXPO_PUBLIC_TAVILY_API_KEY; // optional Firecrawl fallback
const NURSERIES_PATH = path.join(__dirname, '..', 'assets', 'nurseries.json');

if (!FIRECRAWL_KEY || !OPENAI_KEY) {
  console.error('Missing EXPO_PUBLIC_FIRECRAWL_API_KEY or EXPO_PUBLIC_OPENAI_API_KEY in .env');
  process.exit(1);
}

interface PlantEntry {
  name: string;
  aliases: string[];
  price: string;
  inStock: boolean;
}

// Broad harvest: the new pipeline filters by query, so use an all-encompassing
// catch-all (houseplants, trees, shrubs, flowers) rather than a species search.
const HARVEST_QUERY =
  'any plant product for sale: houseplant, tree, shrub, flower, succulent / ' +
  'כל מוצר צמחי למכירה — צמחי בית, עצים, שיחים, פרחים, עציצים';

interface NurseryEntry {
  nurseryId: string;
  name: string;
  website?: string;
  plants: PlantEntry[];
  [key: string]: unknown;
}

async function extractPlants(markdown: string, nurseryName: string): Promise<PlantEntry[]> {
  try {
    const { plants } = await extractAndVerifyPlants({
      markdown,
      query: HARVEST_QUERY,
      site: nurseryName,
      openaiKey: OPENAI_KEY!,
    });
    // Map pipeline Plant ({ name, price, availability }) → nurseries.json shape.
    // The pipeline doesn't generate aliases, so leave them empty for new entries.
    return plants.map((p) => ({
      name: p.name,
      aliases: [],
      price: p.price,
      inStock: p.availability !== 'out_of_stock',
    }));
  } catch {
    return [];
  }
}

async function main() {
  const nurseries: NurseryEntry[] = JSON.parse(fs.readFileSync(NURSERIES_PATH, 'utf8'));
  let updated = 0;

  for (const nursery of nurseries) {
    if (!nursery.website) {
      console.log(`⚪ ${nursery.name} — no website, skipping`);
      continue;
    }
    try {
      console.log(`🔍 Scraping ${nursery.name} (${nursery.website})...`);
      const markdown = await scrapeUrl(nursery.website, FIRECRAWL_KEY!, { tavilyKey: TAVILY_KEY });
      const plants = await extractPlants(markdown, nursery.name);

      if (plants.length > 0) {
        nursery.plants = plants;
        updated++;
        console.log(`✅ ${nursery.name} — ${plants.length} plants extracted`);
      } else {
        console.log(`⚠️  ${nursery.name} — no plants found, keeping existing data`);
      }
    } catch (err: unknown) {
      console.error(`❌ ${nursery.name} — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  fs.writeFileSync(NURSERIES_PATH, JSON.stringify(nurseries, null, 2));
  console.log(`\nDone. Updated ${updated}/${nurseries.length} nurseries.`);
}

main();
