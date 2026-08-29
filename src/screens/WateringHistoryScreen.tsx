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
import { careHistory, type CareKind } from '../services/plantStore';
import { WEEKDAY_LABELS, dayKey, dayKeySet, monthView, shiftMonth } from '../lib/calendar';
import { CARE_KINDS, careState } from '../lib/care';

/*
 * One calendar for every kind of care this plant has had.
 *
 * It began as the watering calendar and grew a `kind` param, which meant three
 * separate month grids showing three separate halves of the same story - the
 * user had to leave the screen to answer "did I feed it around the time I
 * repotted it?". The grid now carries all three at once, with a filter for
 * looking at one, because the interesting questions are about how the care
 * lines up.
 *
 * Read-only on purpose. Logging happens on the detail screen against the live
 * schedule; letting someone fill in an arbitrary square here would let the
 * reminder be rescheduled from a date in the past, and the "3 days overdue"
 * line would start disagreeing with the calendar under it.
 */

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'WateringHistory'>;
  route: RouteProp<RootStackParamList, 'WateringHistory'>;
};

type Filter = CareKind | 'all';

interface KindCopy {
  /* Chip and legend label. */
  short: string;
  /* Screen title when this kind is the filter. */
  title: string;
  empty: string;
  one: string;
  many: string;
  icon: keyof typeof Ionicons.glyphMap;
  /* Theme token names, so light and dark both resolve through the palette. */
  color: 'water' | 'repot' | 'feed';
  onColor: 'onWater' | 'onRepot' | 'onFeed';
}

const COPY: Record<CareKind, KindCopy> = {
  water: {
    short: 'Water',
    title: 'Watering history',
    empty: 'No waterings logged yet - tap Water now on the plant to start.',
    one: 'watering',
    many: 'waterings',
    icon: 'water',
    color: 'water',
    onColor: 'onWater',
  },
  repot: {
    short: 'Repot',
    title: 'Repotting history',
    empty: 'No repotting logged yet - tap Log repot on the plant to start.',
    one: 'repot',
    many: 'repots',
    icon: 'flower-outline',
    color: 'repot',
    onColor: 'onRepot',
  },
  fertilizer: {
    short: 'Feed',
    title: 'Fertilizer history',
    empty: 'No feeding logged yet - tap Log feed on the plant to start.',
    one: 'feed',
    many: 'feeds',
    icon: 'nutrition-outline',
    color: 'feed',
    onColor: 'onFeed',
  },
};

export default function WateringHistoryScreen({ navigation, route }: Props) {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
  /*
   * `kind` now chooses which filter the screen OPENS on rather than what it can
   * show, so the detail screen's three entry points still land where the user
   * expects. No param means the whole picture.
   */
  const { plantId, kind } = route.params;
  const [filter, setFilter] = useState<Filter>(kind ?? 'all');

  // Re-read by id rather than taking the plant through params, for the same
  // reason the detail screen does: params are a snapshot of a record that may
  // have been watered or deleted since.
  const [plant] = useState(() => plantLibrary.load().plants.find((p) => p.id === plantId) ?? null);
  const [view, setView] = useState(() => {
    const now = new Date();
    return monthView(now.getFullYear(), now.getMonth());
  });

  /* Every kind's history, always - the filter decides what is drawn, not what
   * is computed, so switching chips never re-reads storage. */
  const histories = useMemo(() => {
    const out = {} as Record<CareKind, string[]>;
    for (const k of CARE_KINDS) out[k] = plant ? careHistory(plant, k) : [];
    return out;
  }, [plant]);

  const daySets = useMemo(() => {
    const out = {} as Record<CareKind, Set<string>>;
    for (const k of CARE_KINDS) out[k] = dayKeySet(histories[k]);
    return out;
  }, [histories]);

  const shown = useMemo<CareKind[]>(
    () => (filter === 'all' ? CARE_KINDS : [filter]),
    [filter]
  );

  /*
   * Next due, per kind. Watering's interval comes from the diagnosis; repot and
   * feed use the standard houseplant intervals in lib/care.ts, because the care
   * plan has never carried one and a plant saved last year would otherwise show
   * a calendar with no future in it.
   */
  const due = useMemo(() => {
    const out = {} as Record<CareKind, string>;
    if (!plant) return out;
    const now = Date.now();
    const lastOf: Record<CareKind, string | undefined> = {
      water: plant.lastWateredAt,
      repot: plant.lastRepottedAt,
      fertilizer: plant.lastFertilizedAt,
    };
    for (const k of CARE_KINDS) {
      const state = careState(k, plant.diagnosis?.carePlan, lastOf[k], now);
      out[k] = state.nextDueAt ? dayKey(state.nextDueAt) : '';
    }
    return out;
  }, [plant]);

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

  /* Nickname first: what the user calls the plant beats what it is called, and
   * a hand-added plant has no diagnosis to fall back to. */
  const plantName =
    plant.nickname ?? plant.species?.name ?? plant.diagnosis?.plantName ?? 'Unnamed plant';

  /* Which kinds happened on a given day, in the fixed order of CARE_KINDS so
   * the dots never swap places between one square and the next. */
  const kindsOn = (key: string): CareKind[] => shown.filter((k) => daySets[k].has(key));
  const dueOn = (key: string): CareKind[] => shown.filter((k) => due[k] === key);

  const total = shown.reduce((n, k) => n + histories[k].length, 0);
  const monthDays = view.weeks.flat().filter((c) => c.date);
  const monthCount = monthDays.filter((c) => kindsOn(dayKey(c.date!)).length > 0).length;

  /* The Recent list merges the kinds it is showing, newest first, because the
   * order things happened in is the point of reading it. */
  const recent = useMemo(() => {
    return shown
      .flatMap((k) => histories[k].map((at) => ({ at, kind: k })))
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
      .slice(0, 10);
  }, [shown, histories]);

  const single = filter === 'all' ? null : COPY[filter];

  return (
    <SafeAreaView style={s.container} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <View style={s.header}>
          <Pressable
            style={s.backBtn}
            onPress={() => navigation.goBack()}
            accessibilityRole="button"
            accessibilityLabel={`Back to ${plantName}`}
          >
            <Ionicons name="chevron-back" size={22} color={t.color.primary} style={directionalIconStyle} />
            <Text style={s.backText}>{plantName}</Text>
          </Pressable>
        </View>

        <Text style={s.title}>{single ? single.title : 'Care history'}</Text>
        <Text style={s.subtitle}>
          {total === 0
            ? single
              ? single.empty
              : 'Nothing logged yet - water, repot or feed the plant to start.'
            : single
              ? `${total} ${total === 1 ? single.one : single.many} logged`
              : `${total} care ${total === 1 ? 'entry' : 'entries'} logged`}
        </Text>

        {/* Filter, not navigation: every chip shows the same month of the same
            plant, so switching must never reset the month the user paged to. */}
        <View style={s.filterRow}>
          {(['all', ...CARE_KINDS] as Filter[]).map((f) => {
            const active = filter === f;
            const label = f === 'all' ? 'All' : COPY[f].short;
            const count = f === 'all' ? undefined : histories[f].length;
            return (
              <Pressable
                key={f}
                style={[s.chip, active && s.chipActive]}
                onPress={() => setFilter(f)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`Show ${label.toLowerCase()}`}
              >
                {f !== 'all' && (
                  <View style={[s.chipDot, { backgroundColor: t.color[COPY[f].color] }]} />
                )}
                <Text style={[s.chipText, active && s.chipTextActive]}>
                  {label}
                  {count !== undefined && count > 0 ? ` ${count}` : ''}
                </Text>
              </Pressable>
            );
          })}
        </View>

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
              <Ionicons name="chevron-back" size={20} color={t.color.primary} style={directionalIconStyle} />
            </Pressable>
            <Text style={s.monthTitle}>{view.title}</Text>
            <Pressable
              style={s.monthBtn}
              onPress={() => setView((v) => shiftMonth(v, 1))}
              accessibilityRole="button"
              accessibilityLabel="Next month"
              hitSlop={8}
            >
              <Ionicons name="chevron-forward" size={20} color={t.color.primary} style={directionalIconStyle} />
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
                const done = kindsOn(key);
                const dueKinds = dueOn(key).filter((k) => !done.includes(k));
                const isToday = key === todayKey;

                /*
                 * A square filled by ONE kind is that kind's colour; a square
                 * with two or three logged on the same day cannot be, so it
                 * stays neutral and lets the dots underneath carry the meaning.
                 * A colour per pair would need six more tokens to say something
                 * the dots already say.
                 */
                const fill = done.length === 1 ? t.color[COPY[done[0]].color] : null;
                const onFill = done.length === 1 ? t.color[COPY[done[0]].onColor] : null;
                /* Due is an outline, done is a fill: one is a plan and the
                 * other is a fact, and they must not read alike. */
                const ring = dueKinds.length > 0 ? t.color[COPY[dueKinds[0]].color] : null;

                return (
                  <View key={ci} style={s.cell}>
                    <View
                      style={[
                        s.cellInner,
                        done.length > 1 && s.cellMulti,
                        fill ? { backgroundColor: fill } : null,
                        ring && !fill ? { borderWidth: 1.5, borderColor: ring, borderStyle: 'dashed' } : null,
                        isToday && done.length === 0 && !ring ? s.cellToday : null,
                      ]}
                      accessible
                      accessibilityLabel={
                        `${cell.date.toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}` +
                        done.map((k) => `, ${COPY[k].short.toLowerCase()} logged`).join('') +
                        dueKinds.map((k) => `, ${COPY[k].short.toLowerCase()} due`).join('') +
                        (isToday ? ', today' : '')
                      }
                    >
                      <Text
                        style={[
                          s.cellText,
                          onFill ? { color: onFill, fontWeight: '700' } : null,
                          !fill && ring ? { color: ring, fontWeight: '700' } : null,
                        ]}
                      >
                        {cell.day}
                      </Text>
                      {/* Dots only when the fill cannot say it: several kinds
                          on one day, or a day already filled by another. */}
                      {done.length > 1 && (
                        <View style={s.dotRow}>
                          {done.map((k) => (
                            <View key={k} style={[s.dot, { backgroundColor: t.color[COPY[k].color] }]} />
                          ))}
                        </View>
                      )}
                    </View>
                  </View>
                );
              })}
            </View>
          ))}

          <Text style={s.monthCount}>
            {monthCount === 0
              ? single
                ? `No ${single.many} this month`
                : 'Nothing logged this month'
              : `${monthCount} ${monthCount === 1 ? 'day' : 'days'} of care this month`}
          </Text>
        </View>

        <View style={s.legend}>
          {shown.map((k) => (
            <View key={k} style={s.legendItem}>
              <View style={[s.legendSwatch, { backgroundColor: t.color[COPY[k].color] }]} />
              <Text style={s.legendText}>{COPY[k].short}</Text>
            </View>
          ))}
          <View style={s.legendItem}>
            <View style={[s.legendSwatch, s.legendSwatchDue]} />
            <Text style={s.legendText}>Next due</Text>
          </View>
        </View>

        {recent.length > 0 && (
          <View style={s.recent}>
            <Text style={s.recentTitle}>Recent</Text>
            {/*
              A short list under the grid, because a calendar shows THAT a day
              had care and this shows WHICH and WHEN - the kind and the time of
              day are the parts a grid square physically cannot hold.
            */}
            {recent.map((entry) => (
              <View key={`${entry.kind}-${entry.at}`} style={s.recentRow}>
                <Ionicons
                  name={COPY[entry.kind].icon}
                  size={14}
                  color={t.color[COPY[entry.kind].color]}
                />
                <Text style={s.recentText}>
                  {new Date(entry.at).toLocaleDateString(undefined, {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                  })}
                </Text>
                {filter === 'all' && <Text style={s.recentKind}>{COPY[entry.kind].short}</Text>}
                <Text style={s.recentTime}>
                  {new Date(entry.at).toLocaleTimeString(undefined, {
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
    subtitle: { ...t.type.body, color: t.color.textSecondary, marginTop: 2, marginBottom: t.space.md, writingDirection: 'auto' },

    filterRow: { flexDirection: 'row', gap: t.space.sm, marginBottom: t.space.md, flexWrap: 'wrap' },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      minHeight: 36,
      paddingHorizontal: t.space.md,
      borderRadius: t.radius.pill,
      borderWidth: 1,
      borderColor: t.color.border,
      backgroundColor: t.color.surface,
    },
    chipActive: { backgroundColor: t.color.primaryWash, borderColor: t.color.primary },
    chipDot: { width: 8, height: 8, borderRadius: 4 },
    chipText: { ...t.type.caption, color: t.color.textSecondary },
    chipTextActive: { color: t.color.primary, fontWeight: '700' },

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
    cellMulti: { backgroundColor: t.color.surfaceMuted },
    cellToday: { backgroundColor: t.color.surfaceMuted },
    cellText: { ...t.type.caption, color: t.color.textSecondary },

    dotRow: { flexDirection: 'row', gap: 2, position: 'absolute', bottom: 3 },
    dot: { width: 4, height: 4, borderRadius: 2 },

    monthCount: {
      ...t.type.caption,
      color: t.color.textMuted,
      textAlign: 'center',
      marginTop: t.space.sm,
    },

    legend: {
      flexDirection: 'row',
      justifyContent: 'center',
      flexWrap: 'wrap',
      gap: t.space.lg,
      marginTop: t.space.md,
    },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    legendSwatch: { width: 12, height: 12, borderRadius: 4 },
    legendSwatchDue: { borderWidth: 1.5, borderColor: t.color.textMuted, borderStyle: 'dashed' },
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
    recentKind: { ...t.type.caption, color: t.color.textSecondary },
    recentTime: { ...t.type.caption, color: t.color.textMuted },

    missing: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: t.space.xl },
    missingTitle: { ...t.type.heading, color: t.color.foreground, marginTop: t.space.md, textAlign: 'center' },
    backLink: { marginTop: t.space.lg, minHeight: 44, justifyContent: 'center' },
    backLinkText: { ...t.type.label, color: t.color.primary },
  });
