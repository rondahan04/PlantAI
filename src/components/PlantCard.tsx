import React from 'react';
import { View, Text, StyleSheet, Pressable, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Theme, useTheme } from '../theme';
import { LOGO_GLYPH } from '../brand';
import { needsWater, wateringState } from '../lib/watering';
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
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 365)}y ago`;
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
  const color = t.color[CONDITION_COLOR[plant.diagnosis.condition] ?? 'conditionModerate'];
  const when = relativeDay(plant.savedAt, Date.now());

  /*
   * Thirst is the one thing on this card the user can act on TODAY, so it gets
   * its own line rather than being folded into the meta row — condition is why
   * the plant is in the library, watering is why they opened the app now.
   */
  const water = wateringState(plant.diagnosis.carePlan, plant.lastWateredAt, Date.now());
  const thirsty = needsWater(water);

  return (
    <Pressable
      style={({ pressed }) => [s.card, pressed && s.cardPressed]}
      onPress={onPress}
      accessibilityRole="button"
      // One label rather than four separate nodes: a screen reader user wants
      // the plant and its state in a single utterance, not a tour of the row.
      accessibilityLabel={
        `${plant.diagnosis.plantName}, ${plant.diagnosis.conditionLabel}, saved ${when}` +
        (thirsty ? `, watering ${water.label.toLowerCase()}` : '')
      }
    >
      {/*
        The photo may be gone: until TODOS item 9 this is the camera's cache
        URI and iOS purges it on its own schedule. Image renders nothing on a
        dead URI, so the app mark sits underneath rather than leaving a blank
        square that reads as a broken card. Tinted muted on purpose — it is a
        placeholder, and a full-colour logo in every row would compete with the
        condition dot that the card exists to surface.
      */}
      <View style={s.thumbWrap}>
        <Image source={LOGO_GLYPH} style={[s.thumbGlyph, { tintColor: t.color.textMuted }]} />
        <Image source={{ uri: plant.photoUri }} style={s.thumb} />
      </View>

      <View style={s.body}>
        <Text style={s.name} numberOfLines={1}>
          {plant.diagnosis.plantName}
        </Text>
        <View style={s.metaRow}>
          <View style={[s.dot, { backgroundColor: color }]} />
          <Text style={[s.condition, { color }]} numberOfLines={1}>
            {plant.diagnosis.conditionLabel}
          </Text>
          <Text style={s.when}> · {when}</Text>
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

      <Ionicons name="chevron-forward" size={18} color={t.color.textMuted} />
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
      marginRight: t.space.md,
    },
    // Larger than the 22pt icon it replaced: the mark is drawn inside the
    // adaptive-icon safe zone, so the visible leaf is ~60% of the box.
    thumbGlyph: { width: 40, height: 40, resizeMode: 'contain' as const },
    thumb: { position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0 },
    body: { flex: 1, marginRight: t.space.sm },
    name: { ...t.type.bodyStrong, color: t.color.foreground },
    metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
    dot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
    condition: { ...t.type.caption, flexShrink: 1 },
    when: { ...t.type.caption, color: t.color.textMuted },
    waterRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
    waterText: { ...t.type.caption, flexShrink: 1 },
  });
