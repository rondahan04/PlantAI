import React from 'react';
import { View, Text, StyleSheet, Pressable, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Theme, useTheme } from '../theme';
import { copy } from '../services/language';
import { directionalIconStyle } from '../lib/rtl';
import { LOGO_GLYPH } from '../brand';
import { needsWater, wateringState } from '../lib/watering';
import { plantDisplayName, plantSecondaryName } from '../lib/portfolio';
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
  onPress,
}: {
  plant: StoredPlant;
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
   * Thirst is the one thing on this card the user can act on TODAY, so it gets
   * its own line rather than being folded into the meta row - condition is why
   * the plant is in the library, watering is why they opened the app now.
   */
  const water = wateringState(plant.diagnosis?.carePlan, plant.lastWateredAt, Date.now(), copy.watering);
  const thirsty = needsWater(water);

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
        watering: thirsty ? water.label : '',
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
        <Text style={s.name} numberOfLines={1}>
          {name}
        </Text>
        {/* Empty when it would only repeat the name - see plantSecondaryName. */}
        {secondary !== '' && (
          <Text style={s.secondary} numberOfLines={1}>
            {secondary}
          </Text>
        )}
        <View style={s.metaRow}>
          {conditionLabel !== undefined && (
            <>
              <View style={[s.dot, { backgroundColor: color }]} />
              <Text style={[s.condition, { color }]} numberOfLines={1}>
                {conditionLabel}
              </Text>
              <Text style={s.when}> · </Text>
            </>
          )}
          <Text style={s.when}>{when}</Text>
        </View>

        {thirsty && (
          <View style={s.waterRow}>
            <Ionicons
              name="water"
              size={12}
              color={water.status === 'overdue' ? t.color.danger : t.color.warning}
            />
            <Text
              style={[
                s.waterText,
                { color: water.status === 'overdue' ? t.color.danger : t.color.warning },
              ]}
            >
              {water.label}
            </Text>
          </View>
        )}
      </View>

      {/*
        The badge is quiet on purpose: it is a fact about the record, not a
        health warning, so it borrows the muted surface rather than any of the
        condition colours the row already spends its colour budget on.
        `importantForAccessibility="no"` because the row's own label already
        says whether the plant is diagnosed - a screen reader must not hear it
        twice.
      */}
      {plant.diagnosis !== undefined && (
        <View style={s.badge} importantForAccessibility="no">
          <Ionicons name="medkit-outline" size={11} color={t.color.textSecondary} />
          <Text style={s.badgeText}>{copy.plantCard.diagnosedBadge}</Text>
        </View>
      )}

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
      borderRadius: t.radius.lg,
      padding: t.space.md,
      marginBottom: t.space.sm,
      minHeight: 72, // comfortably past the 44pt minimum target (H6)
      ...t.elevation.card,
    },
    cardPressed: { opacity: 0.7 },
    thumbWrap: {
      width: 52,
      height: 52,
      borderRadius: t.radius.md,
      backgroundColor: t.color.surfaceMuted,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      marginEnd: t.space.md,
    },
    // Larger than the 22pt icon it replaced: the mark is drawn inside the
    // adaptive-icon safe zone, so the visible leaf is ~60% of the box.
    thumbGlyph: { width: 40, height: 40, resizeMode: 'contain' as const },
    thumb: { position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0 },
    body: { flex: 1, marginEnd: t.space.sm },
    name: { ...t.type.bodyStrong, color: t.color.foreground, writingDirection: 'auto' },
    secondary: { ...t.type.caption, color: t.color.textSecondary, writingDirection: 'auto', marginTop: 1 },
    metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
    dot: { width: 8, height: 8, borderRadius: 4, marginEnd: 6 },
    condition: { ...t.type.caption, flexShrink: 1, writingDirection: 'auto' },
    when: { ...t.type.caption, color: t.color.textMuted },
    waterRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
    waterText: { ...t.type.caption, flexShrink: 1 },
    badge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      backgroundColor: t.color.surfaceMuted,
      borderRadius: t.radius.pill,
      paddingHorizontal: t.space.sm,
      paddingVertical: 3,
      marginEnd: t.space.xs,
    },
    badgeText: { ...t.type.caption, fontSize: 10, color: t.color.textSecondary },
  });
