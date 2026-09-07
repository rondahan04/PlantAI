#!/usr/bin/env npx tsx
/**
 * Writes the hand-verified ground truth into scraper/fixtures/manifest.json.
 *
 * Every label below was established by reading the captured page, not by
 * running the extractor - otherwise the metric would grade the extractor
 * against itself. `pricedProducts` is the number of priced product listings a
 * human can see on that page; 0 means the shop showed no products for that
 * search, which is a correct answer and not a miss. `sample` is one name/price
 * pair read straight off the page, so a regression that silently changes a
 * number gets caught.
 *
 *   npx tsx scripts/label-price-fixtures.ts
 */

import * as fs from 'fs';
import * as path from 'path';

const MANIFEST = path.join(__dirname, '..', 'scraper', 'fixtures', 'manifest.json');

interface Label {
  /* Priced product listings visible on the page. 0 = shop showed none. */
  pricedProducts: number;
  /* An exact name/price pair read off the page, where there is one. */
  sample?: { name: string; price: number };
  note?: string;
}

/*
 * Keyed `host__slug`. Counts are "at least this many": a grid may paginate, and
 * the point of the metric is whether we read the shop at all, not whether we
 * matched its pagination exactly.
 */
const LABELS: Record<string, Label> = {
  // Nav-only pages: the shop returned no products for this search. Any price on
  // them is chrome - an empty cart total, a free-shipping threshold.
  'ecolution.co.il__monstera': { pricedProducts: 0, note: 'nav only, no results' },
  'ecolution.co.il__pothos': { pricedProducts: 0, note: 'nav only, no results' },
  'peer-nursery.co.il__monstera': { pricedProducts: 0, note: 'placeholder page, lorem ipsum' },
  'peer-nursery.co.il__pothos': { pricedProducts: 0, note: 'placeholder page, lorem ipsum' },
  'perahvagan.co.il__monstera': { pricedProducts: 0, note: 'landing page, no grid' },
  'perahvagan.co.il__pothos': { pricedProducts: 0, note: 'landing page, no grid' },
  'yifrach.co.il__monstera': { pricedProducts: 0, note: 'nav only, no results' },
  'yifrach.co.il__pothos': { pricedProducts: 0, note: 'nav only, no results' },
  'lpflowers.co.il__pothos': { pricedProducts: 0, note: 'no results for pothos' },
  'dizi-garden.co.il__pothos': { pricedProducts: 0, note: 'no results for pothos' },
  'al-haderech.co.il__pothos': { pricedProducts: 0, note: 'no results for pothos' },
  'mashtelatramatgan.co.il__pothos': { pricedProducts: 0, note: 'no results for pothos' },
  'h-shtilshop.co.il__pothos': { pricedProducts: 0, note: 'no results for pothos' },

  // Real grids.
  'al-haderech.co.il__monstera': {
    pricedProducts: 28,
    // On sale: struck-through ₪699.00, actual ₪499.90. The sale price is the
    // one the shop charges and the one we must report.
    sample: { name: 'מבצע מונסטרה סילטפיקנה אוראה', price: 499.9 },
  },
  'h-shtilshop.co.il__monstera': {
    pricedProducts: 5,
    sample: { name: 'סופר מונסטרה מאנקי', price: 180 },
  },
  'lpflowers.co.il__monstera': {
    pricedProducts: 2,
    sample: { name: 'מונסטרה מאנקי', price: 69 },
  },
  'dizi-garden.co.il__monstera': {
    pricedProducts: 2,
    sample: { name: 'מונסטרה מאנקי – קוטר 12', price: 60 },
  },
  'mashtelatramatgan.co.il__monstera': { pricedProducts: 3 },
  'mashtela-urbanit.co.il__monstera': {
    pricedProducts: 3,
    note: 'shop shows unrelated products when a search misses; still priced listings',
  },
  'mashtela-urbanit.co.il__pothos': { pricedProducts: 3, note: 'same fallback grid' },
  'decogarden.co.il__monstera': { pricedProducts: 22 },
  'decogarden.co.il__pothos': { pricedProducts: 2 },
  'wlovep.com__monstera': { pricedProducts: 5 },
  'wlovep.com__pothos': { pricedProducts: 3 },
  'rootine.co.il__monstera': { pricedProducts: 26 },
  'rootine.co.il__pothos': { pricedProducts: 10 },
  // The search URL does not filter: this page is the whole catalogue whatever
  // the query. A scraper bug of its own (the query never reaches the shop),
  // tracked separately - for price extraction it is simply a big grid.
  'azurflowers.co.il__monstera': { pricedProducts: 500, note: 'unfiltered catalogue' },
  'azurflowers.co.il__pothos': { pricedProducts: 500, note: 'unfiltered catalogue' },
};

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
let labelled = 0;
for (const entry of manifest) {
  const label = LABELS[`${entry.host}__${entry.slug}`];
  if (!label) continue;
  Object.assign(entry, label);
  delete entry.truePrice; // superseded by pricedProducts/sample
  labelled++;
}
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
console.log(`labelled ${labelled}/${manifest.length} fixtures`);
