import React from 'react';
import { View, Text, StyleSheet, Pressable, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Theme, useTheme } from '../theme';
import { copy } from '../services/language';
import { directionalIconStyle } from '../lib/rtl';
import { LOGO_GLYPH } from '../brand';
import { plantDisplayName, plantSecondaryName, type CareSlot } from '../lib/portfolio';
import type { StoredPlant } from '../services/plantStore';

/*
 * One row in the plant library.
 *
 * The photo is deliberately small and the condition is what carries colour: a
 * library exists so a user can spot the plant that needs help, not to browse
 * photographs. A grid was the alternative (D7) and was rejected for making
 * condition secondary to aesthetics.
 */

const CONDITION_COLOR: Record<string, keyof Theme['color']> = {
  healthy: 'conditionHealthy',
  mild: 'conditionMild',
  moderate: 'conditionModerate',
  severe: 'conditionSevere',
  critical: 'conditionCritical',
};

/*
 * Each condition also needs a surface to sit on. There are only three tonal
 * washes in the palette, so the five-step condition scale folds onto them -
 * calm greens, then amber, then terracotta - which is the same three-step
 * escalation the user actually reads off the card.
 */
/* The same glyph and tint per care kind as the dashboard, the schedule card and
 * the portfolio strip - a kind is the same colour wherever the user meets it. */
const KIND_ICON: Record<CareSlot['kind'], { icon: keyof typeof Ionicons.glyphMap; tint: keyof Theme['color'] }> = {
  water: { icon: 'water-outline', tint: 'water' },
  fertilizer: { icon: 'nutrition-outline', tint: 'feed' },
  repot: { icon: 'flower-outline', tint: 'repot' },
};

const CONDITION_WASH: Record<string, keyof Theme['color']> = {
  healthy: 'primaryWash',
  mild: 'primaryWash',
  moderate: 'warningWash',
  severe: 'waterWash',
  critical: 'waterWash',
};

function relativeDay(iso: string, now: number): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const days = Math.floor((now - then) / 86_400_000);
  if (days <= 0) return copy.relativeDay.today;
  if (days === 1) return copy.relativeDay.yesterday;
  if (days < 7) return copy.relativeDay.daysAgo(days);
  if (days < 365) return copy.relativeDay.weeksAgo(Math.floor(days / 7));
  return copy.relativeDay.yearsAgo(Math.floor(days / 365));
}

export default function PlantCard({
  plant,
  slots = [],
  onPress,
}: {
  plant: StoredPlant;
  /* All three care kinds, built by `plantSchedule`. Passed in rather than
   * computed here because the schedule needs a clock and the genus plan the
   * list has already looked up once for every card it is about to draw.
   *
   * Optional, defaulting to none, so a card can never take the whole list down
   * over a caller that has not passed them - which is exactly what a Fast
   * Refresh does for a frame when this component reloads ahead of its parent. */
  slots?: CareSlot[];
  onPress: () => void;
}) {
  const t = useTheme();
  const s = React.useMemo(() => makeStyles(t), [t]);
  /*
   * A hand-added plant has no diagnosis and so NO condition - not a healthy
   * one, and not a grey one either. An absent condition is not a condition:
   * the row drops the dot and the label entirely rather than asserting a
   * health state for a plant nobody has examined. The "Diagnosed" badge on the
   * trailing edge is the other half of the same idea - it is what tells the
   * user, at a glance down the list, which plants have been through the camera
   * and which are still just theirs.
   */
  const diagnosis = plant.diagnosis;
  const color = diagnosis
    ? t.color[CONDITION_COLOR[diagnosis.condition] ?? 'conditionModerate']
    : t.color.textMuted;
  /*
   * Naming is portfolio.ts's job, not this row's: the same two lines have to
   * read identically wherever a plant is listed, and the fallback order
   * (nickname, then asserted species, then the model's guess) is a product
   * decision that belongs next to the filter that uses it.
   */
  const name = plantDisplayName(plant);
  const secondary = plantSecondaryName(plant);
  const conditionLabel = diagnosis?.conditionLabel;
  const when = relativeDay(plant.savedAt, Date.now());

  /*
   * Thirst is the one thing on this card the user can act on TODAY, so it takes
   * the pill when it applies - condition is why the plant is in the library,
   * watering is why they opened the app now. It reads the same water slot the
   * meta row below prints, so the pill and the column can never disagree.
   */
  const water = slots.find((slot) => slot.kind === 'water');
  const thirsty = water?.status === 'due' || water?.status === 'overdue';

  const pill: { label: string; icon: 'water' | 'leaf'; tint: string; wash: string } | undefined =
    thirsty && water !== undefined
      ? {
          label: copy.plantCard.needsWatering,
          icon: 'water',
          tint: water.status === 'overdue' ? t.color.danger : t.color.water,
          wash: t.color.waterWash,
        }
      : conditionLabel !== undefined && diagnosis !== undefined
        ? {
            label: conditionLabel,
            icon: 'leaf',
            tint: color,
            wash: t.color[CONDITION_WASH[diagnosis.condition] ?? 'warningWash'],
          }
        : undefined;

  return (
    <Pressable
      style={({ pressed }) => [s.card, pressed && s.cardPressed]}
      onPress={onPress}
      accessibilityRole="button"
      // One label rather than four separate nodes: a screen reader user wants
      // the plant and its state in a single utterance, not a tour of the row.
      accessibilityLabel={copy.plantCard.a11y({
        name,
        secondary: secondary ?? '',
        conditionLabel: conditionLabel ?? '',
        when,
        watering: water?.label ?? '',
      })}
    >
      {/*
        The photo may be gone. Item 9 copies it into the document directory on
        save, but a plant saved before that shipped - or one whose copy was
        interrupted - still points at the camera cache, which iOS purges on its
        own schedule. Image renders nothing on a dead URI, so the app mark sits
        underneath rather than leaving a blank square that reads as a broken card. Tinted muted on purpose - it is a
        placeholder, and a full-colour logo in every row would compete with the
        condition dot that the card exists to surface.
      */}
      <View style={s.thumbWrap}>
        <Image source={LOGO_GLYPH} style={[s.thumbGlyph, { tintColor: t.color.textMuted }]} />
        <Image source={{ uri: plant.photoUri }} style={s.thumb} />
      </View>

      <View style={s.body}>
        {/*
          One pill, not two. The card has room for a single status line and the
          thing the user can act on TODAY outranks the standing condition, so
          thirst takes the slot when the plant is thirsty and the diagnosis
          takes it otherwise. Both are drawn as a tonal wash pill rather than a
          dot + text: at a glance down the list the pill's colour is the signal.
        */}
        {pill !== undefined && (
          <View style={[s.pill, { backgroundColor: pill.wash }]} importantForAccessibility="no">
            <Ionicons name={pill.icon} size={11} color={pill.tint} />
            <Text style={[s.pillText, { color: pill.tint }]} numberOfLines={1}>
              {pill.label}
            </Text>
          </View>
        )}

        <Text style={s.name} numberOfLines={1}>
          {name}
        </Text>
        {/* Empty when it would only repeat the name - see plantSecondaryName. */}
        {secondary !== '' && (
          <Text style={s.secondary} numberOfLines={1}>
            {secondary}
          </Text>
        )}

        {/*
          The three schedules, always all three, in a fixed order. This is the
          row the card exists for: a user scanning the library is asking "what
          needs doing", and a due date per kind answers that without opening
          anything. A kind with nothing scheduled prints "Not set" in the muted
          colour rather than vanishing - three columns on one card and one on
          the next reads as two different card designs.
        */}
        <View style={s.metaRow} importantForAccessibility="no">
          {slots.map((slot) => {
            const { icon, tint } = KIND_ICON[slot.kind];
            const active = slot.status === 'due' || slot.status === 'overdue';
            const glyph = slot.status === 'unscheduled' ? t.color.textMuted : t.color[tint];
            return (
              <View key={slot.kind} style={s.metaItem}>
                <Ionicons name={icon} size={13} color={active ? t.color[tint] : glyph} />
                <Text
                  style={[s.meta, active && { color: t.color[tint] }]}
                  numberOfLines={2}
                >
                  {slot.label}
                </Text>
              </View>
            );
          })}
        </View>
      </View>

      <Ionicons name="chevron-forward" size={18} color={t.color.textMuted} style={directionalIconStyle} />
    </Pressable>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: t.color.surface,
      borderRadius: t.radius.xl,
      padding: t.space.md,
      marginBottom: t.space.md,
      minHeight: 96, // comfortably past the 44pt minimum target (H6)
      ...t.elevation.card,
    },
    cardPressed: { opacity: 0.7 },
    thumbWrap: {
      width: 76,
      height: 76,
      borderRadius: t.radius.lg,
      backgroundColor: t.color.surfaceMuted,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      marginEnd: t.space.md,
    },
    // Larger than the 22pt icon it replaced: the mark is drawn inside the
    // adaptive-icon safe zone, so the visible leaf is ~60% of the box.
    thumbGlyph: { width: 52, height: 52, resizeMode: 'contain' as const },
    thumb: { position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0 },
    body: { flex: 1, marginEnd: t.space.sm },
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: 4,
      borderRadius: t.radius.pill,
      paddingHorizontal: t.space.sm,
      paddingVertical: 3,
      marginBottom: t.space.xs,
      maxWidth: '100%',
    },
    pillText: { ...t.type.caption, flexShrink: 1, writingDirection: 'auto' },
    name: { ...t.type.heading, color: t.color.foreground, writingDirection: 'auto' },
    secondary: {
      ...t.type.caption,
      color: t.color.textSecondary,
      fontStyle: 'italic',
      writingDirection: 'auto',
      marginTop: 1,
    },
    metaRow: { flexDirection: 'row', alignItems: 'flex-start', gap: t.space.sm, marginTop: t.space.sm },
    // Each column takes an equal third and wraps its own label, so a long
    // "Every 18 months" cannot push the column beside it off the card.
    metaItem: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 4 },
    meta: { ...t.type.caption, color: t.color.textMuted, flexShrink: 1, writingDirection: 'auto' },
  });
