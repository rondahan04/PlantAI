/*
 * Reader for the captured price fixtures (SCRAPE-ACCURACY-PLAN Phase 0).
 *
 * The pages are stored gzipped: 26 real nursery pages are 16MB raw and 2MB
 * compressed, and a repo does not need the other 14MB to answer the same
 * question. Decompression is synchronous and costs a few ms per page, which is
 * nothing against a suite that would otherwise have to hit the network.
 *
 * Fixtures are captured by scripts/capture-price-fixtures.ts and labelled by
 * scripts/label-price-fixtures.ts. Nothing here touches the network, so the
 * suite runs under `node --test` offline and for free - which matters because
 * the production host runs with the scrape cache disabled, so every live read
 * is a billed request.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { fileURLToPath } from 'url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

export interface PriceFixture {
  host: string;
  platform: string;
  query: string;
  slug: string;
  url: string | null;
  markdownFile: string | null;
  htmlFile: string | null;
  /* Hand-verified: priced product listings a human sees on the page. */
  pricedProducts?: number;
  /* Hand-verified name/price pair read straight off the page. */
  sample?: { name: string; price: number };
  note?: string;
}

/* Fixture body, from the gzipped copy or a plain one if it was left uncompressed. */
export function readFixture(name: string | null): string {
  if (!name) return '';
  const gz = path.join(DIR, `${name}.gz`);
  if (fs.existsSync(gz)) return zlib.gunzipSync(fs.readFileSync(gz)).toString('utf8');
  const plain = path.join(DIR, name);
  return fs.existsSync(plain) ? fs.readFileSync(plain, 'utf8') : '';
}

/* Every captured fixture, labelled ones included. */
function loadFixtures(): PriceFixture[] {
  const manifest = path.join(DIR, 'manifest.json');
  if (!fs.existsSync(manifest)) return [];
  return JSON.parse(fs.readFileSync(manifest, 'utf8'));
}

/* Only the fixtures carrying hand-verified ground truth. */
export function labelledFixtures(): PriceFixture[] {
  return loadFixtures().filter((f) => f.pricedProducts !== undefined);
}
