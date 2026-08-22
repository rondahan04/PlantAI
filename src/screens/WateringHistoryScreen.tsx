import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { RootStackParamList } from '../types';
import { Theme, useTheme } from '../theme';
import { directionalIconStyle } from '../lib/rtl';
import { plantLibrary } from '../services/plantLibrary';
import { wateringHistory } from '../services/plantStore';
import { WEEKDAY_LABELS, dayKey, dayKeySet, monthView, shiftMonth } from '../lib/calendar';
import { wateringState } from '../lib/watering';

/*
 * Which days this plant was watered.
 *
 * Read-only on purpose. Logging a watering happens on the detail screen against
 * the live schedule; letting someone backfill an arbitrary square here would
 * mean the reminder could be rescheduled from a date in the past, and the
 * "3 days overdue" line would start disagreeing with the calendar under it.
 * This screen answers "did I water it?", nothing more.
 */

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'WateringHistory'>;
  route: RouteProp<RootStackParamList, 'WateringHistory'>;
};

export default function WateringHistoryScreen({ navigation, route }: Props) {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
  const { plantId } = route.params;

  // Re-read by id rather than taking the plant through params, for the same
  // reason the detail screen does: params are a snapshot of a record that may
  // have been watered or deleted since.
  const [plant] = useState(() => plantLibrary.load().plants.find((p) => p.id === plantId) ?? null);
  const [view, setView] = useState(() => {
    const now = new Date();
    return monthView(now.getFullYear(), now.getMonth());
  });

  const history = useMemo(() => (plant ? wateringHistory(plant) : []), [plant]);
  const watered = useMemo(() => dayKeySet(history), [history]);

  const water = plant
    ? wateringState(plant.diagnosis.carePlan, plant.lastWateredAt, Date.now())
    : null;
  const dueKey = water?.nextDueAt ? dayKey(water.nextDueAt) : '';
  const todayKey = dayKey(new Date());

  if (!plant) {
    return (
      <SafeAreaView style={s.container} edges={['top', 'bottom']}>
        <View style={s.missing}>
          <Ionicons name="calendar-outline" size={40} color={t.color.textMuted} />
          <Text style={s.missingTitle}>This plant is no longer saved</Text>
          <Pressable style={s.backLink} onPress={() => navigation.goBack()} accessibilityRole="button">
            <Text style={s.backLinkText}>Go back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const monthCount = view.weeks
    .flat()
    .filter((c) => c.date && watered.has(dayKey(c.date))).length;

  return (
    <SafeAreaView style={s.container} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <View style={s.header}>
          <Pressable
            style={s.backBtn}
            onPress={() => navigation.goBack()}
            accessibilityRole="button"
            accessibilityLabel={`Back to ${plant.diagnosis.plantName}`}
          >
            <Ionicons name="chevron-back" size={22} color={t.color.primary} style={directionalIconStyle} />
            <Text style={s.backText}>{plant.diagnosis.plantName}</Text>
          </Pressable>
        </View>

        <Text style={s.title}>Watering history</Text>
        <Text style={s.subtitle}>
          {history.length === 0
            ? 'No waterings logged yet - tap Water now on the plant to start.'
            : `${history.length} watering${history.length === 1 ? '' : 's'} logged`}
        </Text>

        <View style={s.card}>
          {/*
            Month stepping has no bounds in either direction: forward shows the
            next due date, back shows a history the user may have built over
            months, and clamping either end just makes the arrows lie.
          */}
          <View style={s.monthRow}>
            <Pressable
              style={s.monthBtn}
              onPress={() => setView((v) => shiftMonth(v, -1))}
              accessibilityRole="button"
              accessibilityLabel="Previous month"
              hitSlop={8}
            >
              <Ionicons name="chevron-back" size={20} color={t.color.water} style={directionalIconStyle} />
            </Pressable>
            <Text style={s.monthTitle}>{view.title}</Text>
            <Pressable
              style={s.monthBtn}
              onPress={() => setView((v) => shiftMonth(v, 1))}
              accessibilityRole="button"
              accessibilityLabel="Next month"
              hitSlop={8}
            >
              <Ionicons name="chevron-forward" size={20} color={t.color.water} style={directionalIconStyle} />
            </Pressable>
          </View>

          <View style={s.weekRow}>
            {WEEKDAY_LABELS.map((d, i) => (
              // The labels repeat (S…S, T…T), so the index is the only stable key.
              <Text key={i} style={s.weekday}>
                {d}
              </Text>
            ))}
          </View>

          {view.weeks.map((week, wi) => (
            <View key={wi} style={s.weekRow}>
              {week.map((cell, ci) => {
                if (!cell.date) return <View key={ci} style={s.cell} />;

                const key = dayKey(cell.date);
                const isWatered = watered.has(key);
                const isDue = key === dueKey;
                const isToday = key === todayKey;

                return (
                  <View key={ci} style={s.cell}>
                    <View
                      style={[
                        s.cellInner,
                        isWatered && s.cellWatered,
                        // Due is an outline, watered is a fill: one is a fact
                        // and the other is a plan, and they must not read alike.
                        isDue && !isWatered && s.cellDue,
                        isToday && !isWatered && !isDue && s.cellToday,
                      ]}
                      accessible
                      accessibilityLabel={
                        `${cell.date.toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}` +
                        (isWatered ? ', watered' : '') +
                        (isDue ? ', watering due' : '') +
                        (isToday ? ', today' : '')
                      }
                    >
                      <Text
                        style={[
                          s.cellText,
                          isWatered && s.cellTextWatered,
                          isDue && !isWatered && s.cellTextDue,
                        ]}
                      >
                        {cell.day}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          ))}

          <Text style={s.monthCount}>
            {monthCount === 0
              ? 'No waterings this month'
              : `${monthCount} watering${monthCount === 1 ? '' : 's'} this month`}
          </Text>
        </View>

        <View style={s.legend}>
          <View style={s.legendItem}>
            <View style={[s.legendSwatch, { backgroundColor: t.color.water }]} />
            <Text style={s.legendText}>Watered</Text>
          </View>
          <View style={s.legendItem}>
            <View style={[s.legendSwatch, s.legendSwatchDue]} />
            <Text style={s.legendText}>Next due</Text>
          </View>
        </View>

        {history.length > 0 && (
          <View style={s.recent}>
            <Text style={s.recentTitle}>Recent</Text>
            {/*
              A short list under the grid, because a calendar shows THAT a day
              was watered and this shows WHEN - the time of day is the part a
              grid square physically cannot hold.
            */}
            {history.slice(0, 8).map((entry) => (
              <View key={entry} style={s.recentRow}>
                <Ionicons name="water" size={14} color={t.color.water} />
                <Text style={s.recentText}>
                  {new Date(entry).toLocaleDateString(undefined, {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                  })}
                </Text>
                <Text style={s.recentTime}>
                  {new Date(entry).toLocaleTimeString(undefined, {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: t.color.background },
    scroll: { paddingHorizontal: t.space.xl, paddingBottom: t.space['2xl'] },

    header: { flexDirection: 'row', alignItems: 'center', paddingVertical: t.space.md },
    backBtn: { flexDirection: 'row', alignItems: 'center', minHeight: 44, flex: 1 },
    backText: { ...t.type.label, color: t.color.primary, flexShrink: 1 },

    title: { ...t.type.display, color: t.color.foreground },
    subtitle: { ...t.type.body, color: t.color.textSecondary, marginTop: 2, marginBottom: t.space.lg, writingDirection: 'auto' },

    card: {
      backgroundColor: t.color.surface,
      borderRadius: t.radius.xl,
      borderWidth: 1,
      borderColor: t.color.border,
      padding: t.space.md,
      ...t.elevation.card,
    },

    monthRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: t.space.sm,
    },
    monthBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    monthTitle: { ...t.type.heading, color: t.color.foreground },

    weekRow: { flexDirection: 'row' },
    weekday: {
      ...t.type.caption,
      color: t.color.textMuted,
      flex: 1,
      textAlign: 'center',
      marginBottom: 4,
    },

    // Square cells: `aspectRatio` keeps the grid honest at every screen width
    // without measuring anything.
    cell: { flex: 1, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', padding: 2 },
    cellInner: {
      width: '100%',
      height: '100%',
      borderRadius: t.radius.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cellWatered: { backgroundColor: t.color.water },
    cellDue: { borderWidth: 1.5, borderColor: t.color.water, borderStyle: 'dashed' },
    cellToday: { backgroundColor: t.color.surfaceMuted },
    cellText: { ...t.type.caption, color: t.color.textSecondary },
    cellTextWatered: { color: t.color.onWater, fontWeight: '700' },
    cellTextDue: { color: t.color.water, fontWeight: '700' },

    monthCount: {
      ...t.type.caption,
      color: t.color.textMuted,
      textAlign: 'center',
      marginTop: t.space.sm,
    },

    legend: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: t.space.lg,
      marginTop: t.space.md,
    },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    legendSwatch: { width: 12, height: 12, borderRadius: 4 },
    legendSwatchDue: { borderWidth: 1.5, borderColor: t.color.water, borderStyle: 'dashed' },
    legendText: { ...t.type.caption, color: t.color.textSecondary },

    recent: { marginTop: t.space.xl },
    recentTitle: { ...t.type.heading, color: t.color.foreground, marginBottom: t.space.sm },
    recentRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space.sm,
      paddingVertical: t.space.sm,
      borderBottomWidth: 1,
      borderBottomColor: t.color.border,
    },
    recentText: { ...t.type.body, color: t.color.foreground, flex: 1 },
    recentTime: { ...t.type.caption, color: t.color.textMuted },

    missing: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: t.space.xl },
    missingTitle: { ...t.type.heading, color: t.color.foreground, marginTop: t.space.md, textAlign: 'center' },
    backLink: { marginTop: t.space.lg, minHeight: 44, justifyContent: 'center' },
    backLinkText: { ...t.type.label, color: t.color.primary },
  });
