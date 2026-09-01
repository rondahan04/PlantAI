/*
 * The shape of the species catalog.
 *
 * Split from the data itself because the catalog is authored in family-sized
 * files that all need these types, and `plantCatalog.ts` assembles those files
 * into one tree. Types here rather than there breaks the cycle that would
 * otherwise form: the family files would import the type from the assembler,
 * and the assembler imports the families.
 */

export interface CatalogEntry {
  /* Stable, kebab-case, never reused. Persisted on a plant as `catalogId`. */
  id: string;
  /* What the user calls it: 'Dragon Scale Mint Variegated'. */
  name: string;
  /* Botanical: 'Alocasia baginda'. Shown as the secondary line. */
  scientificName: string;
  genus: string;
  group: string;
  family: string;
  /* Extra strings the search should match. Nicknames, trade names, and the
   * spellings people actually type. */
  synonyms?: string[];
  /*
   * The name Israeli growers actually use.
   *
   * ABSENT is the normal case and not an omission. Most entries here are
   * cultivar trade names - "Thai Constellation", "Black Velvet" - and Israeli
   * growers say those in English. Inventing a Hebrew form produces a label
   * nobody recognises and a search term nobody types, which is worse than
   * showing the name they already know. Hebrew is carried where a real Hebrew
   * name is in circulation, which is mostly at the genus level (see
   * `HEBREW_TAXA` in lib/catalogSearch.ts).
   */
  nameHe?: string;
  /* Hebrew spellings the search should match, same role as `synonyms`. */
  synonymsHe?: string[];
}

export interface CatalogGroup {
  name: string;
  entries: CatalogEntry[];
}

export interface CatalogGenus {
  name: string;
  groups: CatalogGroup[];
}

export interface CatalogFamily {
  name: string;
  genera: CatalogGenus[];
}
