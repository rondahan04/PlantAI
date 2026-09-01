import type { Language } from '../language';
import { en, type Copy } from './en.ts';
import { he } from './he.ts';

/*
 * The copy trees, indexed by language. `src/services/language.ts` picks one at
 * startup and exports it as `copy`; nothing else should read this map.
 *
 * The explicit `.ts` on the two runtime imports is required, not stylistic:
 * without it `node --test` cannot resolve them. It follows the precedent
 * already shipping in `lib/catalogSearch.ts` -> `data/plantCatalog.ts`, which
 * is the same situation - a tested pure module importing sibling data at
 * runtime.
 */
export type { Copy };
export const TREES: Record<Language, Copy> = { en, he };
