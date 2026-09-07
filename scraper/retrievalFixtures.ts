/*
 * Reader and shared vocabulary for the RETRIEVAL fixtures.
 *
 * WHY A SECOND FIXTURE SET. `scraper/fixtures.ts` grades price PARSING: given a
 * page we already fetched, do we read its prices correctly? It answers 100% and
 * the product is still broken, because the thing that fails is one step earlier
 * - RETRIEVAL. Asking al-haderech for "אלוקסיה ריגל שילד" returns a page with no
 * results at all, so there are no prices to misread and the old metric sees
 * nothing wrong. This set exists to make that failure countable.
 *
 * WHAT IS CAPTURED. The shop's own answer to a query, by whichever route we
 * would really use: the WooCommerce Store API, the Shopify catalogue, or the
 * HTML search page. Every one of those is a plain unmetered fetch, so unlike the
 * price fixtures this set costs nothing to capture and nothing to refresh.
 *
 * THE STATUS IS DATA. A 404 from a templated search URL is the single fact that
 * would have caught getzler/peer-nursery being remembered as Shopify when they
 * are WordPress. `fetchRawHtml` throws the status away today; the fixture keeps
 * it, so the self-heal can be tested offline.
 *
 * Captured by scripts/capture-retrieval-fixtures.ts, graded by
 * scripts/retrieval-accuracy.ts. Nothing here touches the network.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { fileURLToPath } from 'url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures-retrieval');

/* Which interface answered. Mirrors ApiRoute in scraper/platformApi.ts plus the
 * HTML page, which is not an API at all. */
export type RetrievalRoute = 'woo-store' | 'shopify-json' | 'html';

/*
 * Which term was sent. The whole argument of this plan is that these two differ:
 * WordPress `?s=` and the Woo Store API both AND every word, so the full name
 * returns nothing on 8 of 9 shops while the genus returns a real shelf. Capture
 * both and the claim is measurable rather than asserted.
 */
export type TermVariant = 'full' | 'broad';

export interface PlantCase {
  id: string;
  /*
   * Latin/English, as the diagnosis or a typing user would give it.
   *
   * MUST be at the same level of precision as `hebrew`. A case that asks for
   * genus in one language and a species in the other is unanswerable: the judge
   * reads the Latin and rejects a sibling species, while the ranker reads the
   * Hebrew and accepts it, and the disagreement is scored as our bug. Caught by
   * "Monstera deliciosa" / "מונסטרה" reporting three false offers that were all
   * perfectly good Monsteras.
   */
  latin: string;
  /* The Hebrew transliteration the shop is expected to list it under. */
  hebrew: string;
  /* The genus alone - the widest term still specific to this plant. */
  broad: string;
  /*
   * Other names Israeli shops actually sell it under, standing in for what
   * planQuery's `alt` returns live. Without these the offline metric measures a
   * weaker system than the one that runs in production.
   */
  alt?: string[];
  /* Why this plant earns a slot, so nobody trims the set without knowing. */
  why: string;
}

/*
 * The matrix, shared by capture and eval so the ids cannot drift apart.
 *
 * Chosen to span the ways a Hebrew nursery listing can differ from the name we
 * are handed: multi-word cultivars, size suffixes, letters with two accepted
 * spellings, names kept in Latin, and one plant whose Hebrew name is a real
 * Hebrew word rather than a transliteration.
 */
export const PLANTS: PlantCase[] = [
  { id: 'monstera', latin: 'Monstera', hebrew: 'מונסטרה', broad: 'מונסטרה',
    why: 'stocked almost everywhere - a miss here is unambiguously our bug' },
  { id: 'pothos', latin: 'Epipremnum', hebrew: 'פותוס', broad: 'פותוס', alt: ['אפיפרמנום'],
    why: 'as above, and a one-word name so it isolates the ladder from everything else' },
  { id: 'alocasia-regal-shield', latin: 'Alocasia Regal Shield', hebrew: 'אלוקסיה ריגל שילד', broad: 'אלוקסיה',
    why: 'the reported failure: three tokens, and shops append a pot size ("10 ליטר")' },
  { id: 'alocasia-zebrina', latin: 'Alocasia Zebrina', hebrew: 'אלוקסיה זברינה', broad: 'אלוקסיה',
    why: 'same genus as the above - catches a broad ladder answering with the wrong cultivar' },
  { id: 'zz', latin: 'Zamioculcas', hebrew: 'זמיוקולקס', broad: 'זמיוקולקס', alt: ['זמיה'],
    why: 'one long transliteration, so spelling variance has nowhere to hide' },
  { id: 'sansevieria', latin: 'Sansevieria', hebrew: 'סנסוויריה', broad: 'סנסוויריה',
    alt: ['לשון החמות', 'סנסיווריה'],
    why: 'listed as both סנסוויריה and סנסיווריה, and often under its Hebrew name' },
  { id: 'philodendron-brasil', latin: 'Philodendron Brasil', hebrew: 'פילודנדרון ברזיל', broad: 'פילודנדרון',
    why: 'cultivar word that is itself a common Hebrew word' },
  { id: 'calathea-orbifolia', latin: 'Calathea orbifolia', hebrew: 'קלתיאה אורביפוליה', broad: 'קלתיאה',
    why: 'ק/כ and ת/ט both vary between shops' },
  { id: 'ficus-lyrata', latin: 'Ficus lyrata', hebrew: 'פיקוס ליראטה', broad: 'פיקוס',
    alt: ['פיקוס כינורי', 'פיקוס כינור'],
    why: 'every shop that stocks it files it under the Hebrew name פיקוס כינורי, not the transliteration' },
  { id: 'aglaonema', latin: 'Aglaonema', hebrew: 'אגלאונמה', broad: 'אגלאונמה', alt: ['אגלונמה'],
    why: 'vowel-heavy transliteration with no settled spelling' },
  { id: 'lavender', latin: 'Lavandula', hebrew: 'לבנדר', broad: 'לבנדר', alt: ['אזוביון'],
    why: 'outdoor/herb rather than houseplant - reaches the general nurseries' },
  { id: 'olive', latin: 'Olea europaea', hebrew: 'זית', broad: 'זית',
    why: 'control: a real Hebrew word, no transliteration, so a ladder bug shows up alone' },
];

export function plantById(id: string): PlantCase | undefined {
  return PLANTS.find((p) => p.id === id);
}

export interface RetrievalFixture {
  host: string;
  /* What known-hosts.json believed at capture time - which may be wrong, and
   * being wrong is one of the things this set exists to prove. */
  platform: string;
  route: RetrievalRoute;
  /* null for a Shopify catalogue, which is captured once per host and then
   * queried offline for every plant. */
  plantId: string | null;
  variant: TermVariant | null;
  /* Shopify catalogues are captured a page at a time, so the pager itself is
   * under test rather than replayed as one pre-joined blob. 1-based. */
  page?: number;
  /* The term actually sent, '' for a catalogue fetch. */
  term: string;
  requestUrl: string;
  /* HTTP status. 0 means the request never completed (DNS, timeout, TLS). */
  status: number;
  /* Bodies are deduped by content hash, so identical "no results" pages across
   * twelve plants cost one file, not twelve. */
  bodyFile: string | null;
  bytes: number;
  /*
   * Hand-written ground truth, and deliberately NOT derived from our own
   * extractor - a metric that grades the extractor against itself measures
   * nothing. For Shopify hosts `listed` is instead derivable exactly from the
   * captured catalogue, which is why those are labelled by script.
   */
  truth?: {
    /* Did this shop list this plant AT CAPTURE TIME. Shops restock; the claim
     * is about the captured bytes, not about today. */
    listed: boolean;
    /*
     * EVERY title that is this plant, not just one.
     *
     * A shop routinely lists the same plant three times in three pot sizes, and
     * any of them is a correct answer. Recording only the first made the metric
     * mark a perfectly good olive tree "wrong" because it was not the same
     * perfectly good olive tree the judge happened to name first.
     */
    productNames?: string[];
    /* Price of the first named product, for spot-checking the mappers. */
    price?: number;
  };
}

export interface RetrievalManifest {
  capturedAt: string;
  fixtures: RetrievalFixture[];
}

/* Fixture body, from the gzipped copy or a plain one if left uncompressed. */
export function readRetrievalFixture(name: string | null): string {
  if (!name) return '';
  const gz = path.join(DIR, `${name}.gz`);
  if (fs.existsSync(gz)) return zlib.gunzipSync(fs.readFileSync(gz)).toString('utf8');
  const plain = path.join(DIR, name);
  return fs.existsSync(plain) ? fs.readFileSync(plain, 'utf8') : '';
}

export function loadRetrievalManifest(): RetrievalManifest {
  const manifest = path.join(DIR, 'manifest.json');
  if (!fs.existsSync(manifest)) return { capturedAt: '', fixtures: [] };
  return JSON.parse(fs.readFileSync(manifest, 'utf8'));
}

export function loadRetrievalFixtures(): RetrievalFixture[] {
  return loadRetrievalManifest().fixtures;
}

/* Only the fixtures carrying ground truth - the only ones that can be scored. */
export function labelledRetrievalFixtures(): RetrievalFixture[] {
  return loadRetrievalFixtures().filter((f) => f.truth !== undefined);
}

export const RETRIEVAL_FIXTURE_DIR = DIR;

/*
 * Every product title a captured body mentions, read as plainly as possible.
 *
 * Used to build the list a human or a judge labels from, and deliberately NOT
 * routed through scraper/platformApi.ts: if the labeller only ever saw the
 * products our own mapper found, a mapper that silently dropped a row would
 * score itself correct for missing it. For the JSON routes this reads the raw
 * field, which is as independent as it gets.
 *
 * The HTML route has no such independent reading available - short of a second
 * parser written to disagree with the first - so those titles do come from our
 * extractor, and a label derived from them is weaker evidence. The manifest
 * records the route, so that weakness stays visible.
 */
export function rawTitles(body: string, route: RetrievalRoute): string[] {
  if (!body) return [];
  if (route === 'html') return [];
  try {
    const parsed = JSON.parse(body);
    const rows = Array.isArray(parsed) ? parsed : parsed?.products;
    if (!Array.isArray(rows)) return [];
    return rows
      .map((r: any) => (typeof r?.name === 'string' ? r.name : r?.title))
      .filter((t: unknown): t is string => typeof t === 'string' && t.trim().length > 0);
  } catch {
    return [];
  }
}
