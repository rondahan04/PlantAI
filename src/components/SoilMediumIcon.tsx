import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import { soilMediumById, type SoilMediumId } from '../lib/soilMedia';

/*
 * One growing medium, drawn.
 *
 * The medium is the single fact that changes every watering and feeding number
 * downstream (see src/lib/soilMedia.ts), so the picker has to be worth reading
 * rather than skimmed past. A bare Ionicons glyph would not carry that weight:
 * eight outline glyphs at the same size in the same grey are toolbar furniture,
 * and half of them (grid, apps, reorder) are near-identical shapes that a user
 * would have to read the label to tell apart.
 *
 * So the glyph is one layer of three, and the other two are what actually make
 * the eight distinguishable at a glance:
 *
 *   1. GRAIN TEXTURE. A row of particles along the floor of the disc whose
 *      count, size and shape differ per medium. This is the honest signal: LECA
 *      really is four fat balls where perlite really is eleven specks, and bark
 *      really is three long chips. A user who has held both recognises the
 *      texture before they read the word.
 *
 *   2. WATER LEVEL. A translucent band rising from the floor, its height taken
 *      from the medium's own waterMultiplier rather than a second hand-kept
 *      table, so the drawing cannot drift out of sync with the schedule it
 *      illustrates. Texture alone was not enough: sphagnum and potting mix are
 *      both "many small particles", and the thing that separates them for a
 *      plant owner is that one stays wet for a fortnight. Water gets no grains
 *      at all and a band that nearly fills the disc, which is exactly right.
 *
 * One colour throughout, the medium's tint at varying alpha, because a second
 * hue per icon would give the picker sixteen colours competing with the
 * condition palette the rest of the app spends its colour budget on.
 */

export interface SoilMediumIconProps {
  id: SoilMediumId;
  /** Diameter of the disc. 56 suits the picker; detail headers may want more. */
  size?: number;
  selected?: boolean;
}

/*
 * Per-medium particle recipe, authored against a 56pt disc and scaled from
 * there. `r` is the corner radius: rounded means tumbled or crumbly (clay
 * balls, perlite beads, peat crumbs), near-square means angular and screened
 * (pon, aroid chunks), pill means fibrous (moss, bark chips).
 */
interface GrainRecipe {
  count: number;
  w: number;
  h: number;
  r: number;
}

const GRAINS: Record<SoilMediumId, GrainRecipe> = {
  potting_mix: { count: 9, w: 4, h: 4, r: 2 },
  aroid_mix: { count: 5, w: 6, h: 6, r: 1.5 },
  leca: { count: 4, w: 8, h: 8, r: 4 },
  pon: { count: 6, w: 6, h: 5, r: 1 },
  sphagnum: { count: 6, w: 7, h: 3, r: 1.5 },
  bark: { count: 3, w: 11, h: 4, r: 2 },
  perlite_mix: { count: 11, w: 3, h: 3, r: 1.5 },
  water: { count: 0, w: 0, h: 0, r: 0 },
};

/*
 * Deterministic opacity cycle. Real substrate has particles in front of and
 * behind each other; a row at one flat alpha reads as a progress bar. Cycling
 * rather than randomising so the same medium draws identically on every render
 * and a re-render never makes the icon shimmer.
 */
const GRAIN_ALPHA = [0.95, 0.6, 0.8, 0.45, 0.88, 0.55, 0.72, 0.42, 0.92, 0.62, 0.5];

/*
 * The theme stores colours as opaque hex, and React Native has no colour-mix,
 * so a tinted wash has to be built here. Returns the input untouched on
 * anything it does not recognise: a slightly-too-strong disc is a cosmetic
 * problem, a thrown error inside a list of eight icons is a blank screen.
 */
export function withAlpha(color: string, alpha: number): string {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return color;
  const hex = match[1];
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return color;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/*
 * waterMultiplier scales the watering interval, so a high one means the medium
 * is still holding water days later. Mapped onto a band that never reaches the
 * rim: a full disc would read as a solid fill rather than a level.
 */
function waterLevel(multiplier: number): number {
  const MIN = 0.6;
  const MAX = 2;
  const normalised = Math.max(0, Math.min(1, (multiplier - MIN) / (MAX - MIN)));
  return 0.14 + normalised * 0.44;
}

export default function SoilMediumIcon({ id, size = 56, selected = false }: SoilMediumIconProps) {
  const t = useTheme();
  const medium = soilMediumById(id);

  /* An id outside the table is a data bug upstream, and drawing the wrong
   * medium would quietly teach the user the wrong watering habit. Nothing is
   * the safer wrong answer. */
  if (!medium) return null;

  const tint = t.color[medium.tint];
  const scale = size / 56;
  const recipe = GRAINS[id];
  const bandHeight = Math.round(size * waterLevel(medium.waterMultiplier));

  return (
    <View
      style={[
        s.disc,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: withAlpha(tint, selected ? 0.22 : 0.12),
          borderColor: selected ? tint : withAlpha(tint, 0.32),
          borderWidth: selected ? 2 : 1,
        },
      ]}
    >
      <View style={[s.band, { height: bandHeight, backgroundColor: withAlpha(tint, 0.18) }]} />

      {recipe.count > 0 && (
        <View style={[s.grainRow, { bottom: Math.round(size * 0.12), gap: Math.max(2, Math.round(size * 0.04)) }]}>
          {Array.from({ length: recipe.count }, (_, i) => (
            <View
              key={i}
              style={{
                width: Math.max(2, recipe.w * scale),
                height: Math.max(2, recipe.h * scale),
                borderRadius: recipe.r * scale,
                backgroundColor: withAlpha(tint, GRAIN_ALPHA[i % GRAIN_ALPHA.length]),
              }}
            />
          ))}
        </View>
      )}

      {/* Lifted off centre so the glyph sits above its own substrate rather
        * than half-buried in the grain row. */}
      <Ionicons
        // soilMedia.ts keeps the glyph as a plain string so it stays free of
        // the vector-icons import and testable under node; the narrowing has
        // to happen at the one place that actually renders it.
        name={medium.icon as keyof typeof Ionicons.glyphMap}
        size={Math.round(size * 0.4)}
        color={tint}
        style={{ marginBottom: Math.round(size * 0.12) }}
      />

      {/* Inner ring, selected only. The outer border alone reads as a slightly
        * thicker edge at this diameter; a second concentric line is the
        * difference between "this one" and "this one is a bit darker". */}
      {selected && (
        <View
          pointerEvents="none"
          style={[
            s.ring,
            { borderRadius: size / 2, borderColor: withAlpha(tint, 0.4) },
          ]}
        />
      )}
    </View>
  );
}

/*
 * Module-level rather than the house `makeStyles(t)` memo: every colour here
 * is a per-medium tint applied inline, so nothing in this sheet depends on the
 * theme and rebuilding it per render would be ceremony.
 */
const s = StyleSheet.create({
  disc: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  band: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  grainRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  ring: { position: 'absolute', top: 3, left: 3, right: 3, bottom: 3, borderWidth: 1 },
});
