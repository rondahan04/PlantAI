import type { CatalogFamily } from './catalogTypes';
import { AROID_FAMILIES } from './catalogAroids';
import { HOUSEPLANT_FAMILIES } from './catalogHouseplants';

/*
 * The species a user can pick from when adding a plant by hand.
 *
 * Four levels, because that is how growers actually talk about these plants:
 * family (Aroids) -> genus (Alocasia) -> group (Rare Alocasias) -> cultivar
 * (Dragon Scale Mint Variegated). The group level is not botanical, it is a
 * shelf label, and that is the point: "Rare Alocasias" is how someone looks for
 * one, "section Pseudodracontium" is not.
 *
 * Assembled from family-sized files rather than written as one literal. The
 * aroids are the half this app's users care about and the half that will keep
 * growing, and a single file holding both was already long enough that neither
 * could be edited without scrolling past the other.
 *
 * AROIDS FIRST, deliberately. Nothing here is sorted alphabetically at any
 * level: the order is curated, common before rare and aroids before the rest,
 * and the search returns matches in this order. Sorting it would bury the plant
 * most people are looking for under the one that happens to start with an A.
 *
 * Data only. Search and indexing live in src/lib/catalogSearch.ts so this file
 * can grow without anything having to read past the top.
 *
 * TEMPORARY BY DESIGN. Trello #74 moves this server-side so entries can be
 * added without an app release; the client already goes through catalogSearch's
 * functions, so that swap does not touch the UI.
 */
export const PLANT_CATALOG: CatalogFamily[] = [...AROID_FAMILIES, ...HOUSEPLANT_FAMILIES];

export type {
  CatalogEntry,
  CatalogGroup,
  CatalogGenus,
  CatalogFamily,
} from './catalogTypes';
