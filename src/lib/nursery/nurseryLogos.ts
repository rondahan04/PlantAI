/**
 * Logos for the nurseries we ship with.
 *
 * Local nurseries get a photo from Google Places, but the national shippers are
 * hard-coded URLs rather than Places results - they have no `photoName`, so
 * they rendered the grey leaf placeholder on every search. These are the only
 * rows guaranteed to appear in the Deliver tab, so the placeholder was the
 * most-seen image in the app.
 *
 * One entry per line in data/nurseries-shippers.txt; nurseryLogos.test.ts
 * fails if a shipper is added without one, because the symptom otherwise is a
 * placeholder nobody notices until it is in front of a user.
 *
 * Bundled rather than hot-linked: a nursery's own logo URL can move or block
 * hot-linking, and these two rows are load-bearing enough not to depend on
 * someone else's CDN.
 */

import type { ImageSourcePropType } from 'react-native';

const LOGOS: Record<string, ImageSourcePropType> = {
  'rootine.co.il': require('../../../assets/nurseries/rootine.png'),
  'al-haderech.co.il': require('../../../assets/nurseries/al-haderech.png'),
  'netaplants.co.il': require('../../../assets/nurseries/netaplants.png'),
  /* Keyed www-stripped, matching Nursery.id: this shop's website is
   * https://www.plantit.co.il/ and `plantit.co.il` is what the pipeline sets. */
  'plantit.co.il': require('../../../assets/nurseries/plantit.png'),
};

/*
 * The bundled logo for a nursery, or undefined to fall back to its Places photo
 * (and then to the leaf placeholder).
 *
 * Keyed on `Nursery.id`, which the pipeline already sets to the canonical host
 * (lowercased, www-stripped). Deliberately not re-deriving it from the website
 * URL here: `hostOf` lives in the Node-only scraper, which is excluded from the
 * app bundle, and a fourth private copy is exactly the drift that would turn
 * every lookup into a silent miss.
 */
export function nurseryLogo(nurseryId: string): ImageSourcePropType | undefined {
  return LOGOS[nurseryId];
}
