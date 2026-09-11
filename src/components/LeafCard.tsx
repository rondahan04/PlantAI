import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Theme, useTheme } from '../theme';
import { copy } from '../services/language';
import { directionalIconStyle, iconRow } from '../lib/i18n/rtl';
import { averageGrowthDays, leafAgeDays, leafCounts, pendingLeaves, type LeafEvent } from '../lib/care/leaves';
import { withAlpha } from './SoilMediumIcon';

/*
 * New growth, on the plant's own screen.
 *
 * Deliberately NOT a fourth `ScheduleCard`. That component answers "when is
 * this due again", and new growth has no due date - the plant decides. What it
 * has instead is a set of OPEN THINGS: leaves the user has spotted and is
 * waiting on, each of which needs its own second tap. A schedule card has
 * exactly one action; this has one plus one per pending leaf, which is why it
 * is its own shape rather than a flag inside that one.
 *
 * The card is also the reason the plant row in the library was left alone: a
 * leaf is something you notice standing in front of the plant, with the screen
 * already open, not something you fire off while scrolling a list.
 */

export interface LeafCardProps {
  /* Already normalized by `leafHistory`, newest first. */
  leaves: LeafEvent[];
  /* Named in the accessibility label for the primary button, so a screen
   * reader user tracking several plants hears which one they are on. */
  plantName: string;
  onLogNew: () => void;
  onMarkGrown: (leafId: string) => void;
  /* Absent when there is nothing to undo, which is what hides the link - a
   * disabled undo is an invitation to a tap that does nothing. */
  onUndo?: () => void;
  onHistory: () => void;
  /* The write is local and instant when logged out, a round trip when logged
   * in. Dims rather than spins, matching ScheduleCard. */
  busy?: boolean;
}

/* How long a pending leaf has been open, in the words the user reads. Whole
 * days, floored - a leaf logged this morning says "today", not "1 day". */
function appearedLabel(leaf: LeafEvent, now: number): string {
  const days = leafAgeDays(leaf, now);
  if (days <= 0) return copy.leafCard.appearedToday;
  if (days === 1) return copy.leafCard.appearedYesterday;
  return copy.leafCard.appearedDaysAgo(days);
}

export default function LeafCard({
  leaves,
  plantName,
  onLogNew,
  onMarkGrown,
  onUndo,
  onHistory,
  busy = false,
}: LeafCardProps) {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);

  const tint = t.color.growth;
  const onTint = t.color.onGrowth;

  const pending = pendingLeaves(leaves);
  const counts = leafCounts(leaves);
  const average = averageGrowthDays(leaves);
  const now = Date.now();

  /*
   * The summary line is assembled from the parts that are TRUE, not from a
   * template with blanks. A plant with two leaves open and none finished has
   * nothing to say about averages, and "0 leaves fully grown · about NaN days"
   * is how that gets said by accident.
   */
  const summary = [
    counts.grown > 0 ? copy.leafCard.grown(counts.grown) : '',
    average !== undefined ? copy.leafCard.average(average) : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <View
      style={[s.card, { backgroundColor: withAlpha(tint, 0.1), borderColor: withAlpha(tint, 0.45) }]}
    >
      <View style={s.headerRow}>
        <View style={s.heading}>
          <Ionicons name="leaf-outline" size={14} color={tint} />
          <Text style={[s.headingText, { color: tint }]}>{copy.leafCard.title}</Text>
        </View>
        <Pressable
          style={({ pressed }) => [s.historyBtn, pressed && { opacity: 0.6 }]}
          onPress={onHistory}
          accessibilityRole="button"
          accessibilityLabel={copy.leafCard.historyA11y}
          hitSlop={8}
        >
          <Text style={[s.historyText, { color: tint }]}>{copy.leafCard.history}</Text>
          <Ionicons name="chevron-forward" size={14} color={tint} style={directionalIconStyle} />
        </Pressable>
      </View>

      <Text style={s.note}>{copy.leafCard.note}</Text>

      {/*
        One row per leaf still opening, each with its own second tap. This is
        the whole reason the feature is not a toggle: a plant pushing three
        leaves at once has three separate answers to "is that one done yet",
        and a single button could only ever track the most recent.
      */}
      {pending.length > 0 && (
        <View style={s.pendingBlock}>
          <Text style={[s.pendingTitle, { color: tint }]}>{copy.leafCard.opening(pending.length)}</Text>
          {pending.map((leaf) => {
            const when = appearedLabel(leaf, now);
            return (
              <View key={leaf.id} style={s.pendingRow}>
                <View style={s.pendingText}>
                  <Ionicons name="leaf" size={14} color={tint} />
                  <Text style={s.pendingWhen} numberOfLines={1}>
                    {when}
                  </Text>
                </View>
                <Pressable
                  style={({ pressed }) => [
                    s.grownBtn,
                    { borderColor: tint },
                    pressed && { opacity: 0.6 },
                    busy && s.busy,
                  ]}
                  onPress={() => onMarkGrown(leaf.id)}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: busy }}
                  accessibilityLabel={copy.leafCard.markGrownA11y(when)}
                  hitSlop={6}
                >
                  <Ionicons name="checkmark-circle-outline" size={16} color={tint} />
                  <Text style={[s.grownText, { color: tint }]}>{copy.leafCard.markGrown}</Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      )}

      {/*
        What the history adds up to, or an invitation when there is no history.
        Never both, and never an empty line where one of them would have gone.
      */}
      <Text style={s.summary}>{counts.total === 0 ? copy.leafCard.empty : summary || ' '}</Text>

      <Pressable
        style={({ pressed }) => [
          s.actionBtn,
          { backgroundColor: tint, ...t.elevation.raised },
          pressed && s.actionBtnPressed,
          busy && s.busy,
        ]}
        onPress={onLogNew}
        disabled={busy}
        accessibilityRole="button"
        accessibilityState={{ disabled: busy }}
        accessibilityLabel={copy.leafCard.logNewA11y(plantName)}
      >
        <Ionicons name="add-circle" size={18} color={onTint} />
        <Text style={[s.actionText, { color: onTint }]}>{copy.leafCard.logNew}</Text>
      </Pressable>

      {/*
        Undo, and only while there is something to undo.
        A quiet text link rather than a control with weight: mis-taps are the
        only reason it exists, and the two taps above are the reason someone
        opened the card.
      */}
      {onUndo !== undefined && counts.total > 0 && (
        <Pressable
          style={({ pressed }) => [s.undoBtn, pressed && { opacity: 0.6 }]}
          onPress={onUndo}
          disabled={busy}
          accessibilityRole="button"
          accessibilityState={{ disabled: busy }}
          accessibilityLabel={copy.leafCard.undoA11y}
          hitSlop={8}
        >
          <Ionicons name="arrow-undo-outline" size={13} color={t.color.textMuted} />
          <Text style={s.undoText}>{copy.leafCard.undo}</Text>
        </Pressable>
      )}
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    /* The same shell as a ScheduleCard, on purpose: it sits directly under the
     * three of them and a different object there would read as a different
     * kind of information rather than as the same plant's story. */
    card: {
      borderRadius: t.radius.lg,
      borderWidth: 1,
      padding: t.space.lg,
      marginBottom: t.space.sm,
      ...t.elevation.card,
    },
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    heading: { ...iconRow, alignItems: 'center', gap: 5 },
    headingText: { ...t.type.caption, textTransform: 'uppercase', letterSpacing: 0.6 },
    historyBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 28 },
    historyText: { ...t.type.caption, fontWeight: '700' },

    note: { ...t.type.caption, color: t.color.textSecondary, marginTop: 2, writingDirection: 'auto' },

    pendingBlock: { marginTop: t.space.md, gap: t.space.xs },
    pendingTitle: { ...t.type.caption, fontWeight: '700' },
    pendingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: t.space.sm,
      /* 44pt is the accessibility floor for the button inside it, and the row
       * has to clear it even though it draws one line of caption. */
      minHeight: 44,
    },
    pendingText: { ...iconRow, alignItems: 'center', gap: 6, flexShrink: 1 },
    pendingWhen: { ...t.type.body, color: t.color.foreground, writingDirection: 'auto', flexShrink: 1 },

    grownBtn: {
      ...iconRow,
      alignItems: 'center',
      gap: 4,
      borderWidth: 1,
      borderRadius: t.radius.md,
      paddingHorizontal: t.space.sm,
      paddingVertical: 6,
    },
    grownText: { ...t.type.caption, fontWeight: '700' },

    summary: { ...t.type.caption, color: t.color.textSecondary, marginTop: t.space.sm, writingDirection: 'auto' },

    actionBtn: {
      ...iconRow,
      alignItems: 'center',
      justifyContent: 'center',
      gap: t.space.sm,
      borderRadius: t.radius.lg,
      marginTop: t.space.md,
      paddingVertical: t.space.md,
      minHeight: 48,
    },
    actionBtnPressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
    actionText: { ...t.type.label },

    busy: { opacity: 0.6 },

    undoBtn: {
      ...iconRow,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      marginTop: t.space.sm,
      minHeight: 32,
    },
    undoText: { ...t.type.caption, color: t.color.textMuted },
  });
