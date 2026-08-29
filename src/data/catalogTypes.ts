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
