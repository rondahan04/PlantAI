import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Theme, useTheme } from '../theme';
import { copy } from '../services/language';
import { directionalIconStyle } from '../lib/rtl';
import type { CarePlan } from '../types';
import type { CareKind } from '../services/plantStore';
import type { SoilCarePlan } from '../lib/genusCarePlan';
import { careState, intervalPlanFor } from '../lib/care';
import { intervalLabel } from '../lib/watering';
import { withAlpha } from './SoilMediumIcon';

/*
 * ONE schedule card for all three kinds of care.
 *
 * Water, feed and repot are not three features, they are one question -
 * "when was this last done, and when is it due again" - asked with three
 * different intervals, and `lib/care.ts` has already collapsed them into a
 * single state machine. This component is the rendering half of that same
 * collapse, and it exists because the alternative has already been tried:
 * PlantDetailScreen carried a hand-built watering card AND a loop over two
 * care-log rows, and the two drifted immediately. The watering card grew a
 * history link, an interval line, a reminder note and a long-press to log an
 * early watering; the feed and repot rows got none of it, for no reason anyone
 * could name. Three near-identical cards is how that happens, so there is one.
 *
 * What differs per kind is a colour, an icon and a verb, and that is the whole
 * table below. What does not differ - the state line, the interval, the
 * history link, the log button and its "already done" receipt - is written
 * once and every kind gets it.
 */

export interface ScheduleCardProps {
  kind: CareKind;
  /* The plant's watering plan, ALREADY resolved against its growing medium by
   * `plantCarePlan`. Only the water kind reads its interval; feed and repot
   * get theirs from `soilPlan` or from the constants in lib/care.ts. */
  carePlan: CarePlan | undefined;
  /* The genus plan's entry for the medium this plant is in, when one has been
   * cached. Absent is normal, not an error: it means the app has no
   * medium-specific advice yet and falls back to the standard intervals. */
  soilPlan: SoilCarePlan | undefined;
  /* ISO-8601 of the last time this kind of care was logged. */
  lastAt: string | undefined;
  busy?: boolean;
  onLog: () => void;
  onHistory: () => void;
}

interface KindStyle {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  /* The filled-button glyph, which is louder than the header's outline icon. */
  actionIcon: keyof typeof Ionicons.glyphMap;
  /* Palette keys rather than colours: the theme owns light and dark, and a
   * literal here would be right in exactly one of them. */
  tint: 'water' | 'feed' | 'repot';
  onTint: 'onWater' | 'onFeed' | 'onRepot';
  /* The button while there is something to do, and the receipt once there is
   * not. `start` is the first-ever tap, which reads differently: there is no
   * schedule running yet, and the tap is what starts one. */
  action: string;
  start: string;
  done: string;
}

const KINDS: Record<CareKind, KindStyle> = {
  water: {
    title: copy.scheduleCard.water.title,
    icon: 'water-outline',
    actionIcon: 'water',
    tint: 'water',
    onTint: 'onWater',
    action: copy.scheduleCard.water.action,
    start: copy.scheduleCard.water.start,
    done: copy.scheduleCard.water.done,
  },
  fertilizer: {
    title: copy.scheduleCard.fertilizer.title,
    icon: 'nutrition-outline',
    actionIcon: 'nutrition',
    tint: 'feed',
    onTint: 'onFeed',
    action: copy.scheduleCard.fertilizer.action,
    start: copy.scheduleCard.fertilizer.start,
    done: copy.scheduleCard.fertilizer.done,
  },
  repot: {
    title: copy.scheduleCard.repot.title,
    icon: 'flower-outline',
    actionIcon: 'flower',
    tint: 'repot',
    onTint: 'onRepot',
    action: copy.scheduleCard.repot.action,
    start: copy.scheduleCard.repot.start,
    done: copy.scheduleCard.repot.done,
  },
};

export default function ScheduleCard({
  kind,
  carePlan,
  soilPlan,
  lastAt,
  busy = false,
  onLog,
  onHistory,
}: ScheduleCardProps) {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
  const k = KINDS[kind];
  const tint = t.color[k.tint];
  const onTint = t.color[k.onTint];

  const state = careState(kind, carePlan, lastAt, Date.now(), soilPlan);
  /*
   * The interval as the user reads it, taken from the SAME plan the state
   * machine was given. Deriving it separately from `carePlan` would print the
   * watering interval above a feeding schedule, which is exactly the bug the
   * old two-card layout shipped with.
   */
  const interval = intervalLabel(intervalPlanFor(kind, carePlan, soilPlan));

  /*
   * Done, and not due again yet - there is nothing to log. `ok` is the only
   * status that means it: `due` and `overdue` are precisely when the button
   * has to work, `never_watered` is the tap that starts the schedule, and
   * `unscheduled` is a plant with no interval at all, where logging is still
   * real data worth recording.
   */
  const settled = state.status === 'ok';

  /*
   * The medium-specific sentence, and only when the medium actually changes
   * the answer. Water and feed each have their own prose on the soil plan;
   * repotting has none, because when to repot is decided by the roots filling
   * the pot rather than by what the pot is filled with.
   */
  const advice = kind === 'water' ? soilPlan?.water : kind === 'fertilizer' ? soilPlan?.fertilizer : undefined;

  return (
    <View
      style={[
        s.card,
        { backgroundColor: withAlpha(tint, 0.1), borderColor: withAlpha(tint, 0.45) },
      ]}
    >
      <View style={s.headerRow}>
        <View style={s.heading}>
          <Ionicons name={k.icon} size={14} color={tint} />
          <Text style={[s.headingText, { color: tint }]}>{k.title}</Text>
        </View>
        {/* A quiet text button, not a second filled control: the card already
            has one action, and history is something you go and look at rather
            than something you do. */}
        <Pressable
          style={({ pressed }) => [s.historyBtn, pressed && { opacity: 0.6 }]}
          onPress={onHistory}
          accessibilityRole="button"
          accessibilityLabel={copy.scheduleCard.historyA11y(k.title)}
          hitSlop={8}
        >
          <Text style={[s.historyText, { color: tint }]}>{copy.scheduleCard.history}</Text>
          <Ionicons name="chevron-forward" size={14} color={tint} style={directionalIconStyle} />
        </Pressable>
      </View>

      {/*
        NO INTERVAL MEANS NO INTERVAL. An unscheduled kind says so in words
        rather than borrowing a plausible number from somewhere: a fabricated
        interval here does not stay a line of text, it becomes a due date, then
        an OS reminder, and the user ends up on a schedule the app invented.
      */}
      <Text style={s.interval}>
        {state.status === 'unscheduled' ? copy.scheduleCard.noSchedule : interval}
      </Text>

      {/*
        The countdown sits in ONE place, and which place depends on whether it
        is news. Due and overdue are the reason the card was opened, so they get
        the loud line; a plant with days left is reassurance, and reassurance
        belongs under the button rather than shouted above it.
      */}
      {!settled && !!state.label && (
        <Text
          style={[
            s.status,
            state.status === 'overdue' && { color: t.color.danger },
            state.status === 'due' && { color: t.color.warning },
          ]}
        >
          {state.label}
        </Text>
      )}

      {/* The medium's own advice, in the card the medium is driving. Absent
          when there is no genus plan cached for this pot yet. */}
      {!!advice && <Text style={s.advice}>{advice}</Text>}

      {/*
        Nothing to do until this comes round again, so the button stops being a
        button: filled while there is an action to take, an outlined receipt
        once the schedule is running. It comes back on its own the day the care
        is due - the state is derived from the schedule, never from a flag
        somebody has to remember to clear.
      */}
      <Pressable
        style={({ pressed }) => [
          s.actionBtn,
          settled
            ? [s.actionBtnDone, { borderColor: tint }]
            : { backgroundColor: tint, ...t.elevation.raised },
          // Still gives feedback while held, or a long press feels like
          // nothing is happening until it fires.
          pressed && (settled ? s.actionBtnDonePressed : s.actionBtnPressed),
          busy && s.actionBtnBusy,
        ]}
        /*
         * Settled swaps the gestures rather than switching the button off: a
         * tap does nothing, but a hold still logs the care. Someone who tops a
         * plant up on day 3 of a 7-day interval is not making a mistake, and a
         * schedule that refuses the real event goes stale - but it takes a
         * deliberate press, so the common case (already done, nothing to do)
         * stays inert.
         */
        onPress={settled ? undefined : onLog}
        onLongPress={settled ? onLog : undefined}
        disabled={busy}
        accessibilityRole="button"
        accessibilityState={{ disabled: busy }}
        accessibilityLabel={
          settled
            ? copy.scheduleCard.settledA11y(k.done, state.label)
            : copy.scheduleCard.actionA11y(k.title, k.action, state.label)
        }
        accessibilityHint={settled ? copy.scheduleCard.earlyHint(k.title) : undefined}
      >
        <Ionicons
          name={settled ? 'checkmark-circle' : k.actionIcon}
          size={18}
          color={settled ? tint : onTint}
        />
        <Text style={[s.actionText, { color: settled ? tint : onTint }]}>
          {settled ? k.done : state.status === 'never_watered' ? k.start : k.action}
        </Text>
      </Pressable>

      {/*
        The date it was last done was the wrong fact to end on: it is history,
        and the only question a person opens this card with is when the next one
        is. That answer is the status line above, so this row carries only what
        that line does not - the reassurance itself, and how to log an early one
        once the button has gone quiet.
      */}
      {settled && (
        <Text style={s.note}>
          {[state.label, `hold ${k.done} to log an early one`].filter(Boolean).join(' · ')}
        </Text>
      )}
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    /*
     * Drawn as an object rather than as a tint: its own washed ground, a
     * coloured edge and lift off the page. Flat on `surfaceMuted` with no
     * border, the original watering card read as a gap between sections
     * instead of as a thing to press.
     *
     * The ground and edge are computed from the kind's tint above rather than
     * being palette entries, because only water has a `*Wash` token - and
     * inventing `feedWash`/`repotWash` would have meant two more colours to
     * keep in step across light and dark for no gain over an alpha of the
     * colour that is already there.
     */
    card: {
      borderRadius: t.radius.lg,
      borderWidth: 1,
      padding: t.space.lg,
      marginBottom: t.space.sm,
      ...t.elevation.card,
    },
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    heading: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    headingText: { ...t.type.caption, textTransform: 'uppercase', letterSpacing: 0.6 },
    historyBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 28 },
    historyText: { ...t.type.caption, fontWeight: '700' },

    interval: { ...t.type.caption, color: t.color.textSecondary, marginTop: 2 },
    status: { ...t.type.bodyStrong, color: t.color.foreground, marginTop: 4 },
    advice: { ...t.type.body, color: t.color.textSecondary, marginTop: t.space.sm, writingDirection: 'auto' },

    actionBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: t.space.sm,
      borderRadius: t.radius.lg,
      marginTop: t.space.md,
      paddingVertical: t.space.md,
      minHeight: 48,
    },
    actionBtnPressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
    /*
     * Outlined, unfilled, unlifted - a receipt rather than an action. Greying
     * it out was the alternative and was rejected: a disabled grey control
     * reads as "broken" or "not available to you", when what actually happened
     * is that the user succeeded.
     */
    actionBtnDone: { backgroundColor: 'transparent', borderWidth: 1, shadowOpacity: 0, elevation: 0 },
    actionBtnDonePressed: { opacity: 0.55, transform: [{ scale: 0.98 }] },
    // The write is fast, but watering also talks to the OS and can hang behind
    // a permission dialog. Dimming beats a spinner that flashes for one frame.
    actionBtnBusy: { opacity: 0.6 },
    actionText: { ...t.type.label },

    note: { ...t.type.caption, color: t.color.textMuted, marginTop: t.space.sm, textAlign: 'center' },
  });
