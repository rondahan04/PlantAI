import { I18nManager } from 'react-native';

/*
 * RTL support (TODOS item 14), layout half.
 *
 * The users are Israeli and the scraped nursery inventory is already Hebrew, so
 * the app has to survive being run in a right-to-left locale even while its own
 * copy is still English.
 *
 * Yoga mirrors the layout for us — `flexDirection: 'row'` reverses, and any
 * `start`/`end` edge follows the writing direction. What it does NOT mirror is
 * `left`/`right`, which is why those were replaced across the screens, and it
 * cannot mirror an icon: a back chevron pointing left in a mirrored layout is
 * pointing *forward*, into the screen the user is trying to leave. Glyphs that
 * encode a direction have to be flipped by hand.
 */

export const isRTL = I18nManager.isRTL;

/*
 * Apply to chevrons and arrows that mean "back" / "forward" / "previous" /
 * "next" — never to icons whose shape is not directional (a leaf, a droplet), and
 * never to text, which the platform handles.
 *
 * An empty array rather than `undefined` so it composes inside a style array
 * without a conditional at every call site.
 */
export const mirrorInRTL = isRTL ? ([{ scaleX: -1 }] as const) : ([] as const);

export const directionalIconStyle = { transform: mirrorInRTL } as const;
