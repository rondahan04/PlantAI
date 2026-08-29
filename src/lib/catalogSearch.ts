import { PLANT_CATALOG, type CatalogEntry } from '../data/plantCatalog.ts';

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
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
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
          ];
          out.push({ entry, haystack: fold(parts.join(' ')) });
        }
      }
    }
  }
  return out;
}

const INDEX: IndexedEntry[] = flatten();

export const CATALOG_ENTRIES: CatalogEntry[] = INDEX.map((i) => i.entry);

function sectionTitle(e: CatalogEntry): string {
  return `${e.family} - ${e.genus} - ${e.group}`;
}

/*
 * Group a flat list back into sections, preserving the order the entries came
 * in. Order is the catalog's own order, which is curated - common before rare,
 * aroids before everything else - and re-sorting alphabetically would bury the
 * plant most people are looking for.
 */
function toSections(entries: CatalogEntry[]): CatalogSection[] {
  const sections: CatalogSection[] = [];
  const byTitle = new Map<string, CatalogSection>();

  for (const entry of entries) {
    const title = sectionTitle(entry);
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
export function browseSections(): CatalogSection[] {
  return toSections(CATALOG_ENTRIES);
}

/*
 * EVERY term must match, anywhere in the entry. "alocasia mint" finds the one
 * mint-variegated Alocasia; OR-matching would have returned every Alocasia and
 * made the second word useless, which is the opposite of what typing more
 * words means to a person.
 */
export function searchCatalog(query: string): CatalogSection[] {
  const terms = fold(query).split(' ').filter(Boolean);
  if (terms.length === 0) return browseSections();

  const hits = INDEX.filter((i) => terms.every((term) => i.haystack.includes(term))).map(
    (i) => i.entry
  );
  return toSections(hits);
}

/*
 * A plant stores `catalogId`, and an app update can remove an entry. Returning
 * undefined rather than throwing is the whole contract: the caller falls back
 * to the `species` snapshot it stored alongside the id.
 */
export function catalogEntryById(id: string | undefined): CatalogEntry | undefined {
  if (!id) return undefined;
  return CATALOG_ENTRIES.find((e) => e.id === id);
}
