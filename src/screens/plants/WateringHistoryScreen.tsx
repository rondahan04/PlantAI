import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { RootStackParamList } from '../../types/index';
import { Theme, useTheme } from '../../theme/index';
import { directionalIconStyle, iconRow } from '../../lib/i18n/rtl';
import { plantRepo } from '../../services/plants/plantRepoInstance';
import { careHistory, leafHistory, type CareKind } from '../../services/plants/plantStore';
import { leafDays, leafStamps } from '../../lib/care/leaves';
import { dayKey, dayKeySet, monthView, shiftMonth, weekdayLabels } from '../../lib/care/calendar';
import { copy, getLanguage, localeTag } from '../../services/language';
import { CARE_KINDS, careState } from '../../lib/care/care';

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

/*
 * A FILTER is what the user picks; a MARK is what the grid draws. They are
 * one-to-one for the three care kinds and deliberately not for new growth: one
 * chip says "leaves", and it puts TWO markers on the calendar - the day a leaf
 * appeared and the day it finished opening. Collapsing those into one marker
 * would throw away the only thing the two-tap tracking buys.
 */
type Filter = CareKind | 'leaf' | 'all';
type Mark = CareKind | 'leafNew' | 'leafGrown';

const MARKS: Mark[] = [...CARE_KINDS, 'leafNew', 'leafGrown'];

/* Which markers a filter draws. 'all' is everything, and the leaf chip is the
 * one row that expands to two. */
const MARKS_FOR: Record<Filter, Mark[]> = {
  all: MARKS,
  water: ['water'],
  repot: ['repot'],
  fertilizer: ['fertilizer'],
  leaf: ['leafNew', 'leafGrown'],
};

interface FilterCopy {
  /* Chip label. */
  short: string;
  /* Screen title when this is the filter. */
  title: string;
  empty: string;
  logged: (n: number) => string;
  noneThisMonth: string;
  /* Theme token, for the chip's dot. */
  color: MarkColor;
}

type MarkColor = 'water' | 'repot' | 'feed' | 'growth';
type MarkOnColor = 'onWater' | 'onRepot' | 'onFeed' | 'onGrowth';

interface MarkCopy {
  /* Legend and "recent" label. */
  short: string;
  icon: keyof typeof Ionicons.glyphMap;
  /* Theme token names, so light and dark both resolve through the palette. */
  color: MarkColor;
  onColor: MarkOnColor;
  /*
   * Drawn as a ring rather than a filled square. New growth shares ONE colour
   * across its two markers - they are two ends of the same event, and a second
   * green would read as a second kind of care - so the shape is what tells them
   * apart: an outline for the leaf appearing, a fill for it finishing.
   */
  outline?: boolean;
}

const FILTER_COPY: Record<Exclude<Filter, 'all'>, FilterCopy> = {
  water: {
    short: copy.careHistory.water.short,
    title: copy.careHistory.water.title,
    empty: copy.careHistory.water.empty,
    logged: copy.careHistory.water.logged,
    noneThisMonth: copy.careHistory.water.noneThisMonth,
    color: 'water',
  },
  repot: {
    short: copy.careHistory.repot.short,
    title: copy.careHistory.repot.title,
    empty: copy.careHistory.repot.empty,
    logged: copy.careHistory.repot.logged,
    noneThisMonth: copy.careHistory.repot.noneThisMonth,
    color: 'repot',
  },
  fertilizer: {
    short: copy.careHistory.fertilizer.short,
    title: copy.careHistory.fertilizer.title,
    empty: copy.careHistory.fertilizer.empty,
    logged: copy.careHistory.fertilizer.logged,
    noneThisMonth: copy.careHistory.fertilizer.noneThisMonth,
    color: 'feed',
  },
  leaf: {
    short: copy.careHistory.leaf.short,
    title: copy.careHistory.leaf.title,
    empty: copy.careHistory.leaf.empty,
    logged: copy.careHistory.leaf.logged,
    noneThisMonth: copy.careHistory.leaf.noneThisMonth,
    color: 'growth',
  },
};

const MARK_COPY: Record<Mark, MarkCopy> = {
  water: { short: copy.careHistory.water.short, icon: 'water', color: 'water', onColor: 'onWater' },
  repot: {
    short: copy.careHistory.repot.short,
    icon: 'flower-outline',
    color: 'repot',
    onColor: 'onRepot',
  },
  fertilizer: {
    short: copy.careHistory.fertilizer.short,
    icon: 'nutrition-outline',
    color: 'feed',
    onColor: 'onFeed',
  },
  leafNew: {
    short: copy.careHistory.leaf.emerged,
    icon: 'leaf-outline',
    color: 'growth',
    onColor: 'onGrowth',
    outline: true,
  },
  leafGrown: {
    short: copy.careHistory.leaf.matured,
    icon: 'leaf',
    color: 'growth',
    onColor: 'onGrowth',
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
  const [plant] = useState(() => plantRepo.loadLocal().plants.find((p) => p.id === plantId) ?? null);
  const [view, setView] = useState(() => {
    const now = new Date();
    return monthView(now.getFullYear(), now.getMonth(), localeTag());
  });

  /* Every marker's history, always - the filter decides what is drawn, not what
   * is computed, so switching chips never re-reads storage. The two leaf
   * markers are the two ENDS of the same records, split here so the grid below
   * needs to know nothing about how a leaf is stored. */
  const histories = useMemo(() => {
    const out = {} as Record<Mark, string[]>;
    for (const k of CARE_KINDS) out[k] = plant ? careHistory(plant, k) : [];
    const stamps = plant ? leafStamps(leafHistory(plant)) : [];
    out.leafNew = stamps.filter((stamp) => stamp.stage === 'emerged').map((stamp) => stamp.at);
    out.leafGrown = stamps.filter((stamp) => stamp.stage === 'matured').map((stamp) => stamp.at);
    return out;
  }, [plant]);

  const daySets = useMemo(() => {
    const out = {} as Record<Mark, Set<string>>;
    for (const k of CARE_KINDS) out[k] = dayKeySet(histories[k]);
    /* Through `leafDays` rather than `dayKeySet` on the stamps above: both
     * answer "which local days", and keeping the leaf rule in lib/leaves.ts
     * means one module owns what a leaf day is. */
    const days = leafDays(plant ? leafHistory(plant) : []);
    out.leafNew = days.emerged;
    out.leafGrown = days.matured;
    return out;
  }, [histories, plant]);

  const shown = useMemo<Mark[]>(() => MARKS_FOR[filter], [filter]);

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
      const state = careState(k, plant.diagnosis?.carePlan, lastOf[k], now, undefined, copy.care, copy.watering);
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
          <Text style={s.missingTitle}>{copy.careHistory.missingTitle}</Text>
          <Pressable style={s.backLink} onPress={() => navigation.goBack()} accessibilityRole="button">
            <Text style={s.backLinkText}>{copy.careHistory.goBack}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  /* Nickname first: what the user calls the plant beats what it is called, and
   * a hand-added plant has no diagnosis to fall back to. */
  const plantName =
    plant.nickname ?? plant.species?.name ?? plant.diagnosis?.plantName ?? copy.careHistory.unnamed;

  /* Which markers land on a given day, in the fixed order of MARKS so they
   * never swap places between one square and the next. */
  const kindsOn = (key: string): Mark[] => shown.filter((k) => daySets[k].has(key));
  /* Only the three care kinds have a due date. New growth has none - the plant
   * decides when it pushes a leaf, and a dashed "next leaf due" square would be
   * the app inventing a schedule for something it cannot schedule. */
  const dueOn = (key: string): CareKind[] =>
    CARE_KINDS.filter((k) => shown.includes(k) && due[k] === key);

  /*
   * A leaf is ONE entry however many markers it draws, so the count skips the
   * maturity stamps - "12 leaves tracked" over six leaves that have each been
   * marked grown is a number the user cannot reconcile with anything.
   */
  const total = shown
    .filter((k) => k !== 'leafGrown')
    .reduce((n, k) => n + histories[k].length, 0);
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

  const single = filter === 'all' ? null : FILTER_COPY[filter];

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

        <Text style={s.title}>{single ? single.title : copy.careHistory.allTitle}</Text>
        <Text style={s.subtitle}>
          {total === 0
            ? single
              ? single.empty
              : copy.careHistory.allEmpty
            : single
              ? single.logged(total)
              : copy.careHistory.allLogged(total)}
        </Text>

        {/* Filter, not navigation: every chip shows the same month of the same
            plant, so switching must never reset the month the user paged to. */}
        <View style={s.filterRow}>
          {(['all', ...CARE_KINDS, 'leaf'] as Filter[]).map((f) => {
            const active = filter === f;
            const label = f === 'all' ? copy.careHistory.filterAll : FILTER_COPY[f].short;
            /* One leaf is one count, so the chip counts the leaves that
               appeared rather than every marker the filter draws. */
            const count =
              f === 'all' ? undefined : f === 'leaf' ? histories.leafNew.length : histories[f].length;
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
                  <View style={[s.chipDot, { backgroundColor: t.color[FILTER_COPY[f].color] }]} />
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
              onPress={() => setView((v) => shiftMonth(v, -1, localeTag()))}
              accessibilityRole="button"
              accessibilityLabel={copy.careHistory.prevMonth}
              hitSlop={8}
            >
              <Ionicons name="chevron-back" size={20} color={t.color.primary} style={directionalIconStyle} />
            </Pressable>
            <Text style={s.monthTitle}>{view.title}</Text>
            <Pressable
              style={s.monthBtn}
              onPress={() => setView((v) => shiftMonth(v, 1, localeTag()))}
              accessibilityRole="button"
              accessibilityLabel={copy.careHistory.nextMonth}
              hitSlop={8}
            >
              <Ionicons name="chevron-forward" size={20} color={t.color.primary} style={directionalIconStyle} />
            </Pressable>
          </View>

          <View style={s.weekRow}>
            {weekdayLabels(getLanguage()).map((d, i) => (
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
                 * A square carrying ONE marker takes that marker's colour; a
                 * square with two or more logged on the same day cannot, so it
                 * stays neutral and lets the dots underneath carry the meaning.
                 * A colour per pair would need six more tokens to say something
                 * the dots already say.
                 */
                const only = done.length === 1 ? MARK_COPY[done[0]] : null;
                /*
                 * A leaf APPEARING is drawn as a solid ring rather than a fill -
                 * same green as the leaf finishing, different shape. The two
                 * are one event seen twice, so they must read as related, and
                 * only the shape can say which end of it this square is.
                 */
                const outlined = only?.outline === true;
                const fill = only && !outlined ? t.color[only.color] : null;
                const onFill = only && !outlined ? t.color[only.onColor] : null;
                const markRing = only && outlined ? t.color[only.color] : null;
                /* Due is a DASHED outline, done is a fill or a solid ring: one
                 * is a plan and the other is a fact, and they must not read
                 * alike. */
                const ring = dueKinds.length > 0 ? t.color[MARK_COPY[dueKinds[0]].color] : null;

                return (
                  <View key={ci} style={s.cell}>
                    <View
                      style={[
                        s.cellInner,
                        done.length > 1 && s.cellMulti,
                        fill ? { backgroundColor: fill } : null,
                        markRing ? { borderWidth: 2, borderColor: markRing } : null,
                        ring && !fill && !markRing
                          ? { borderWidth: 1.5, borderColor: ring, borderStyle: 'dashed' }
                          : null,
                        isToday && done.length === 0 && !ring ? s.cellToday : null,
                      ]}
                      accessible
                      accessibilityLabel={
                        `${cell.date.toLocaleDateString(localeTag(), { day: 'numeric', month: 'long' })}` +
                        done.map((k) => copy.careHistory.doneSuffix(MARK_COPY[k].short)).join('') +
                        dueKinds.map((k) => copy.careHistory.dueSuffix(MARK_COPY[k].short)).join('') +
                        (isToday ? ', today' : '')
                      }
                    >
                      <Text
                        style={[
                          s.cellText,
                          onFill ? { color: onFill, fontWeight: '700' } : null,
                          markRing ? { color: markRing, fontWeight: '700' } : null,
                          !fill && !markRing && ring ? { color: ring, fontWeight: '700' } : null,
                        ]}
                      >
                        {cell.day}
                      </Text>
                      {/* Dots only when the fill cannot say it: several kinds
                          on one day, or a day already filled by another. */}
                      {done.length > 1 && (
                        <View style={s.dotRow}>
                          {done.map((k) => (
                            /* Hollow for the leaf that appeared, solid for
                               everything that happened - the same shape rule
                               the filled square follows, at dot scale. */
                            <View
                              key={k}
                              style={[
                                s.dot,
                                MARK_COPY[k].outline
                                  ? { borderWidth: 1.5, borderColor: t.color[MARK_COPY[k].color] }
                                  : { backgroundColor: t.color[MARK_COPY[k].color] },
                              ]}
                            />
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
                ? single.noneThisMonth
                : copy.careHistory.allNoneThisMonth
              : copy.careHistory.daysOfCare(monthCount)}
          </Text>
        </View>

        <View style={s.legend}>
          {shown.map((k) => (
            <View key={k} style={s.legendItem}>
              <View
                style={[
                  s.legendSwatch,
                  MARK_COPY[k].outline
                    ? { borderWidth: 2, borderColor: t.color[MARK_COPY[k].color] }
                    : { backgroundColor: t.color[MARK_COPY[k].color] },
                ]}
              />
              <Text style={s.legendText}>{MARK_COPY[k].short}</Text>
            </View>
          ))}
          <View style={s.legendItem}>
            <View style={[s.legendSwatch, s.legendSwatchDue]} />
            <Text style={s.legendText}>{copy.careHistory.nextDue}</Text>
          </View>
        </View>

        {recent.length > 0 && (
          <View style={s.recent}>
            <Text style={s.recentTitle}>{copy.careHistory.recent}</Text>
            {/*
              A short list under the grid, because a calendar shows THAT a day
              had care and this shows WHICH and WHEN - the kind and the time of
              day are the parts a grid square physically cannot hold.
            */}
            {recent.map((entry) => (
              <View key={`${entry.kind}-${entry.at}`} style={s.recentRow}>
                <Ionicons
                  name={MARK_COPY[entry.kind].icon}
                  size={14}
                  color={t.color[MARK_COPY[entry.kind].color]}
                />
                <Text style={s.recentText}>
                  {new Date(entry.at).toLocaleDateString(localeTag(), {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                  })}
                </Text>
                {/* The marker's own word, not the filter's: inside the leaf
                    filter the two rows differ only by which end they are. */}
                {(filter === 'all' || filter === 'leaf') && (
                  <Text style={s.recentKind}>{MARK_COPY[entry.kind].short}</Text>
                )}
                <Text style={s.recentTime}>
                  {new Date(entry.at).toLocaleTimeString(localeTag(), {
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
      ...iconRow,
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
