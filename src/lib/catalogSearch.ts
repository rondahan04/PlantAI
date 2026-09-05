import { PLANT_CATALOG, type CatalogEntry } from '../data/plantCatalog.ts';
import { HEBREW_SYNONYMS, HEBREW_TAXA } from '../data/catalogHebrew.ts';

/*
 * Searching and browsing the species tree.
 *
 * Split from the data so the tree can grow without this logic being buried
 * under it, and so a future server-backed catalog (Trello #74) replaces one
 * small module rather than everything that reads a plant name.
 *
 * The index is built once at import. The catalog is a few hundred entries in
 * the bundle, so this is microseconds, and it buys a search that runs on every
 * keystroke without allocating.
 */

export type { CatalogEntry } from '../data/plantCatalog.ts';

/* SectionList's shape, so the picker can render this with no transformation. */
export interface CatalogSection {
  /* 'Aroids - Alocasia - Rare Alocasias' */
  title: string;
  family: string;
  genus: string;
  group: string;
  data: CatalogEntry[];
}

interface IndexedEntry {
  entry: CatalogEntry;
  /* Everything searchable, folded and joined once. */
  haystack: string;
}

/*
 * Fold to something a phone keyboard can reach: lowercase, accents stripped,
 * punctuation flattened to spaces. Someone typing "alocasia zebrina" must find
 * an entry stored as "Alocasia zebrína", and someone typing "devils ivy" must
 * find "Devil's Ivy".
 */
export function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    /*
     * Hebrew (U+0590-U+05FF) is kept alongside a-z0-9. Without it a Hebrew
     * query folded to an empty string, which does not match nothing - it
     * matches EVERYTHING, so the search box would have looked broken rather
     * than empty-handed. Latin diacritics are still stripped above, so
     * "zebrína" and "zebrina" remain the same word.
     */
    .replace(/[^a-z0-9\u0590-\u05ff]+/g, ' ')
    .trim();
}

/*
 * Hebrew for the parts of the tree that genuinely have it: families, genera and
 * shelf-label groups. Cultivars are deliberately not here - see `nameHe` on
 * CatalogEntry.
 *
 * Keyed by the English string the catalog already stores, so adding a Hebrew
 * name never means editing 359 entries, and a taxon with no Hebrew simply
 * falls through to its English name.
 */
/* What to show a reader of `lang`, falling back to English rather than to
 * nothing. */
export function catalogDisplayName(entry: CatalogEntry, lang: 'en' | 'he'): string {
  return lang === 'he' ? (entry.nameHe ?? entry.name) : entry.name;
}

/* Same rule for a taxon name (family / genus / group). */
export function taxonDisplayName(name: string, lang: 'en' | 'he'): string {
  return lang === 'he' ? (HEBREW_TAXA[name] ?? name) : name;
}

function flatten(): IndexedEntry[] {
  const out: IndexedEntry[] = [];
  for (const family of PLANT_CATALOG) {
    for (const genus of family.genera) {
      for (const group of genus.groups) {
        for (const entry of group.entries) {
          const parts = [
            entry.name,
            entry.scientificName,
            entry.genus,
            entry.group,
            entry.family,
            ...(entry.synonyms ?? []),
            /*
             * Hebrew goes into the SAME haystack rather than a second index:
             * one query has to match either script, because Israeli growers mix
             * them constantly - "מונסטרה Thai Constellation" is one plant name.
             */
            entry.nameHe ?? '',
            ...(entry.synonymsHe ?? []),
            HEBREW_TAXA[entry.genus] ?? '',
            HEBREW_TAXA[entry.group] ?? '',
            HEBREW_TAXA[entry.family] ?? '',
            ...(HEBREW_SYNONYMS[entry.genus] ?? []),
          ];
          out.push({ entry, haystack: fold(parts.join(' ')) });
        }
      }
    }
  }
  return out;
}

/*
 * Built on FIRST USE, not at import.
 *
 * `flatten()` walks the whole catalog and folds a search haystack for every
 * entry - measured at ~13ms on a development Mac, so meaningfully more than
 * that under Hermes on a mid-range phone. It used to run at module scope,
 * which meant it ran during every cold start: `App.tsx` imports the species
 * picker statically, so importing the screen was enough to pay for the index,
 * whether or not the user ever opened it. Most sessions never do.
 *
 * Memoised after the first call, so a user who does open the picker pays once
 * and typing stays instant (a search over the built index is ~0.08ms).
 */
let indexCache: IndexedEntry[] | null = null;
function index(): IndexedEntry[] {
  return (indexCache ??= flatten());
}

let entriesCache: CatalogEntry[] | null = null;
export function catalogEntries(): CatalogEntry[] {
  return (entriesCache ??= index().map((i) => i.entry));
}

function sectionTitle(e: CatalogEntry, lang: 'en' | 'he'): string {
  return [e.family, e.genus, e.group].map((n) => taxonDisplayName(n, lang)).join(' - ');
}

/*
 * Group a flat list back into sections, preserving the order the entries came
 * in. Order is the catalog's own order, which is curated - common before rare,
 * aroids before everything else - and re-sorting alphabetically would bury the
 * plant most people are looking for.
 */
function toSections(entries: CatalogEntry[], lang: 'en' | 'he'): CatalogSection[] {
  const sections: CatalogSection[] = [];
  const byTitle = new Map<string, CatalogSection>();

  for (const entry of entries) {
    const title = sectionTitle(entry, lang);
    let section = byTitle.get(title);
    if (!section) {
      section = {
        title,
        family: entry.family,
        genus: entry.genus,
        group: entry.group,
        data: [],
      };
      byTitle.set(title, section);
      sections.push(section);
    }
    section.data.push(entry);
  }

  return sections;
}

/* The whole tree, sectioned. What the picker shows before anything is typed -
 * an empty search field should be a menu, not a void. */
export function browseSections(lang: 'en' | 'he' = 'en'): CatalogSection[] {
  return toSections(catalogEntries(), lang);
}

/*
 * EVERY term must match, anywhere in the entry. "alocasia mint" finds the one
 * mint-variegated Alocasia; OR-matching would have returned every Alocasia and
 * made the second word useless, which is the opposite of what typing more
 * words means to a person.
 */
export function searchCatalog(query: string, lang: 'en' | 'he' = 'en'): CatalogSection[] {
  const terms = fold(query).split(' ').filter(Boolean);
  if (terms.length === 0) return browseSections(lang);

  const hits = index().filter((i) => terms.every((term) => i.haystack.includes(term))).map(
    (i) => i.entry
  );
  return toSections(hits, lang);
}

/*
 * A plant stores `catalogId`, and an app update can remove an entry. Returning
 * undefined rather than throwing is the whole contract: the caller falls back
 * to the `species` snapshot it stored alongside the id.
 */
export function catalogEntryById(id: string | undefined): CatalogEntry | undefined {
  if (!id) return undefined;
  return catalogEntries().find((e) => e.id === id);
}
