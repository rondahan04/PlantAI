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
import { loadEnv, scrapeUrl, callOpenAIJson, priceFocusedExcerpt } from '../scraper/core.ts';

loadEnv(path.join(__dirname, '..', '.env'));

const FIRECRAWL_KEY = process.env.EXPO_PUBLIC_FIRECRAWL_API_KEY;
const OPENAI_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
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

interface NurseryEntry {
  nurseryId: string;
  name: string;
  website?: string;
  plants: PlantEntry[];
  [key: string]: unknown;
}

async function extractPlants(markdown: string, nurseryName: string): Promise<PlantEntry[]> {
  const excerpt = priceFocusedExcerpt(markdown);
  if (!excerpt.trim()) return [];
  const prompt = `Extract plant products sold by ${nurseryName}. Return JSON only:
{ "plants": [{ "name": "scientific name", "aliases": ["common name"], "price": "₪XX", "inStock": true }] }
Prices in ILS (₪). If no plants found, return { "plants": [] }.
Content:\n${excerpt}`;
  try {
    const parsed = await callOpenAIJson(prompt, OPENAI_KEY!, 1000);
    return Array.isArray(parsed) ? parsed : (parsed.plants ?? []);
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
      const markdown = await scrapeUrl(nursery.website, FIRECRAWL_KEY!);
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
