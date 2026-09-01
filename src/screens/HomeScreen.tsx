import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import type { RootStackParamList } from '../types';
import { Theme, useTheme } from '../theme';
import { plantRepo } from '../services/plantRepoInstance';
import { genusCarePlans } from '../services/genusCarePlans';
import { dueSoon, plantDisplayName } from '../lib/portfolio';
import { greetingFor, needsCareCount, stripFaces, taskGroups, taskSubtitle, type TaskGroup } from '../lib/home';
import { directionalIconStyle } from '../lib/rtl';
import { onboarding } from '../services/onboarding';
import { useSession } from '../hooks/useSession';
import { copy, localeTag } from '../services/language';
import { LOGO_GLYPH } from '../brand';
import type { CareKind } from '../services/plantStore';
import { TAB_BAR_CLEARANCE } from '../navigation/tabBarMetrics';

/*
 * Home - the first screen of the app, and the only one that answers "what
 * should I do about my plants today" without the user picking a plant first.
 *
 * It owns no data. Every plant, every due date and every name comes from the
 * same modules the Portfolio tab reads, and every decision about WHICH two
 * tasks and HOW MANY plants are behind lives in src/lib/home.ts under
 * `node --test`. This file is a renderer, deliberately: a dashboard is exactly
 * the kind of screen that grows business rules in JSX if you let it.
 */

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Home'>;
};

/* Same glyph and tint per care kind as ScheduleCard and Portfolio, so a kind
 * is the same colour wherever the user meets it. */
const KIND_ICON: Record<CareKind, { icon: keyof typeof Ionicons.glyphMap; tint: keyof Theme['color'] }> = {
  water: { icon: 'water-outline', tint: 'water' },
  fertilizer: { icon: 'nutrition-outline', tint: 'feed' },
  repot: { icon: 'flower-outline', tint: 'repot' },
};

export default function HomeScreen({ navigation }: Props) {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);

  /*
   * Same lazy-initializer contract as Portfolio: `loadLocal` is synchronous so
   * the first painted frame is already the user's own garden, not an empty
   * dashboard that fills in a frame later.
   */
  const session = useSession();
  const [library, setLibrary] = useState(() => plantRepo.loadLocal());
  const plants = library.plants;
  const [profileName] = useState(() => onboarding.load()?.name);

  /* Coming back from the camera or a plant detail must not leave a stale count
   * on the dashboard - this is the screen most likely to be looked at and not
   * scrolled, so a wrong number here is a wrong number the user trusts. */
  useFocusEffect(
    useCallback(() => {
      setLibrary(plantRepo.loadLocal());
    }, [session])
  );

  const now = Date.now();
  /* Cached genus plans only - `peek`, never a fetch. Home paints on the first
   * frame, and a network call per genus would either block that paint or drop
   * new rows in under the user's thumb. A miss degrades to the diagnosis's own
   * interval, which is what the card showed before genus plans existed. */
  const due = useMemo(
    () =>
      dueSoon(
        plants,
        now,
        (plant) => {
          const genus = plant.species?.genus ?? plant.diagnosis?.genus;
          return genus ? genusCarePlans.peek(genus) : null;
        },
        copy.care,
        copy.watering
      ),
    // The clock is read once per library read on purpose: a dashboard that
    // recomputed on every tick would repaint for a boundary the user cannot see.
    [plants] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const groups = useMemo(() => taskGroups(due), [due]);
  const behind = needsCareCount(due);
  const { shown, overflow } = useMemo(() => stripFaces(plants), [plants]);

  const greeting = copy.home.greeting[greetingFor(new Date(now).getHours())];
  const title = profileName ? copy.home.greetingWithName(greeting, profileName) : greeting;
  const today = new Date(now).toLocaleDateString(localeTag(), {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  /* The hero photograph is the user's newest plant, not stock art: the card is
   * about THEIR garden, and a stranger's monstera under "your garden at a
   * glance" is a small lie the whole screen then has to live with. With no
   * plants there is no photo, and the card drops it rather than showing a
   * placeholder box. */
  const heroPhoto = shown[0]?.photoUri;

  /* The same compact vocabulary the plant cards print, so "Today" on a card and
   * "Today" on a task tile are one string rather than two that can drift. */
  const whenLabel = (days: number): string =>
    days < 0
      ? copy.schedule.overdue
      : days === 0
        ? copy.schedule.today
        : days === 1
          ? copy.schedule.tomorrow
          : copy.schedule.inDays(days);

  return (
    <SafeAreaView style={s.container} edges={['top']} /* bottom inset belongs to the tab bar */>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <View style={s.headerRow}>
          <View style={s.headerText}>
            <Text style={s.eyebrow}>{today}</Text>
            <Text style={s.title} numberOfLines={2}>
              {title}
            </Text>
          </View>
          <Pressable
            style={({ pressed }) => [s.bell, pressed && s.pressed]}
            onPress={() => navigation.navigate('Notifications')}
            accessibilityRole="button"
            accessibilityLabel={copy.settings.notifications}
          >
            <Ionicons name="notifications-outline" size={20} color={t.color.foreground} />
            {/* A dot, not a count: the bell opens reminder SETTINGS, so a number
                would promise an inbox that does not exist. It appears only when
                there is actually care outstanding. */}
            {behind > 0 && <View style={s.bellDot} />}
          </Pressable>
        </View>

        {/* --- hero ------------------------------------------------------- */}
        <View style={s.hero}>
          <View style={s.heroTop}>
            <View style={s.heroHeadRow}>
              <Text style={s.heroEyebrow}>{copy.home.heroEyebrow}</Text>
              <View style={s.heroCountPill}>
                <Text style={s.heroCountText}>{copy.home.plantCount(plants.length)}</Text>
              </View>
            </View>
            <Text style={s.heroTitle}>
              {plants.length === 0 ? copy.home.heroEmptyTitle : copy.home.heroTitle}
            </Text>
            <Pressable
              style={({ pressed }) => [s.heroCta, pressed && s.heroCtaPressed]}
              onPress={() => navigation.navigate('Camera')}
              accessibilityRole="button"
              accessibilityLabel={copy.home.a11yHero}
            >
              <Ionicons name="camera-outline" size={18} color={t.color.onAccent} />
              <Text style={s.heroCtaText}>{copy.home.heroCta}</Text>
              <Ionicons
                name="arrow-forward"
                size={16}
                color={t.color.onAccent}
                style={directionalIconStyle}
              />
            </Pressable>
          </View>
          {heroPhoto !== undefined && <Image source={{ uri: heroPhoto }} style={s.heroPhoto} />}
        </View>

        {/* --- upcoming tasks --------------------------------------------- */}
        <View style={s.sectionHead}>
          <Text style={s.sectionTitle}>{copy.home.tasksTitle}</Text>
          {groups.length > 0 && (
            <Pressable
              onPress={() => navigation.navigate('Home', { screen: 'Portfolio' })}
              accessibilityRole="button"
              hitSlop={8}
            >
              <Text style={s.sectionLink}>{copy.home.tasksSeeAll}</Text>
            </Pressable>
          )}
        </View>

        {groups.length === 0 ? (
          <View style={s.emptyCard}>
            <Ionicons name="checkmark-circle-outline" size={18} color={t.color.success} />
            <Text style={s.emptyText}>{copy.home.tasksEmpty}</Text>
          </View>
        ) : (
          <View style={s.taskRow}>
            {groups.map((group) => (
              <TaskCard key={group.kind} group={group} t={t} s={s} whenLabel={whenLabel} navigation={navigation} />
            ))}
            {/* One task keeps its half-width so the card never stretches into a
                banner - two cards is the layout, one card is the same layout
                with a gap. */}
            {groups.length === 1 && <View style={s.taskCardSpacer} />}
          </View>
        )}

        {/* --- my plants --------------------------------------------------- */}
        <View style={s.sectionHead}>
          <Text style={s.sectionTitle}>{copy.home.plantsTitle}</Text>
          <Pressable
            onPress={() => navigation.navigate('Home', { screen: 'Portfolio' })}
            accessibilityRole="button"
            hitSlop={8}
          >
            <Text style={s.sectionLink}>{copy.home.plantsSeeAll}</Text>
          </Pressable>
        </View>

        <Pressable
          style={({ pressed }) => [s.stripCard, pressed && s.pressed]}
          onPress={() => navigation.navigate('Home', { screen: 'Portfolio' })}
          accessibilityRole="button"
          accessibilityLabel={
            plants.length === 0
              ? copy.home.emptyStrip
              : `${copy.home.plantCount(plants.length)}, ${
                  behind > 0 ? `${behind} ${copy.home.needsCare(behind)}` : copy.home.allHealthy
                }`
          }
        >
          {plants.length === 0 ? (
            <>
              <Image source={LOGO_GLYPH} style={[s.stripGlyph, { tintColor: t.color.textMuted }]} />
              <Text style={s.stripEmpty}>{copy.home.emptyStrip}</Text>
            </>
          ) : (
            <>
              <View style={s.faces}>
                {shown.map((p, i) => (
                  <Image
                    key={p.id}
                    source={{ uri: p.photoUri }}
                    style={[s.face, i > 0 && s.faceOverlap]}
                    accessibilityLabel={plantDisplayName(p)}
                  />
                ))}
                {overflow > 0 && (
                  <View style={[s.face, s.faceOverlap, s.faceMore]}>
                    <Text style={s.faceMoreText}>+{overflow}</Text>
                  </View>
                )}
              </View>
              <View style={s.stripCount} importantForAccessibility="no">
                <Text style={s.stripNumber}>{behind > 0 ? behind : plants.length}</Text>
                <Text style={s.stripCaption}>
                  {behind > 0 ? copy.home.needsCare(behind) : copy.home.allHealthy}
                </Text>
              </View>
            </>
          )}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function TaskCard({
  group,
  t,
  s,
  whenLabel,
  navigation,
}: {
  group: TaskGroup;
  t: Theme;
  s: ReturnType<typeof makeStyles>;
  whenLabel: (days: number) => string;
  navigation: Props['navigation'];
}) {
  const { icon, tint } = KIND_ICON[group.kind];
  const color = t.color[tint];
  const kindLabel = copy.home.taskKind[group.kind];
  const subtitle = taskSubtitle(group, copy.home.taskOthers);
  const when = whenLabel(group.daysUntilDue);
  /* A single-plant group can open that plant directly; a group of three cannot
   * pick one for the user, so it lands on the list that shows all of them. */
  const target = () =>
    group.plants.length === 1
      ? navigation.navigate('PlantDetail', { plantId: group.plants[0].id })
      : navigation.navigate('Home', { screen: 'Portfolio' });

  return (
    <Pressable
      style={({ pressed }) => [s.taskCard, pressed && s.pressed]}
      onPress={target}
      accessibilityRole="button"
      accessibilityLabel={copy.home.a11yTask(kindLabel, subtitle, when)}
    >
      <View style={s.taskTop} importantForAccessibility="no">
        <View style={[s.taskGlyph, { backgroundColor: t.color.surfaceMuted }]}>
          <Ionicons name={icon} size={16} color={color} />
        </View>
        <Text style={[s.taskWhen, { color: group.daysUntilDue <= 0 ? color : t.color.textMuted }]} numberOfLines={1}>
          {when}
        </Text>
      </View>
      <Text style={s.taskKind} numberOfLines={1}>
        {kindLabel}
      </Text>
      <Text style={s.taskSub} numberOfLines={1}>
        {subtitle}
      </Text>
    </Pressable>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: t.color.background },
    scroll: { padding: t.space.lg, paddingBottom: t.space.lg + TAB_BAR_CLEARANCE },

    headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: t.space.md },
    headerText: { flex: 1 },
    eyebrow: { ...t.type.eyebrow, color: t.color.textMuted, writingDirection: 'auto' },
    title: { ...t.type.display, color: t.color.foreground, marginTop: t.space.xs, writingDirection: 'auto' },
    bell: {
      width: 44,
      height: 44,
      borderRadius: t.radius.pill,
      backgroundColor: t.color.surface,
      alignItems: 'center',
      justifyContent: 'center',
      ...t.elevation.card,
    },
    bellDot: {
      position: 'absolute',
      top: 10,
      end: 12,
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: t.color.accent,
    },
    pressed: { opacity: 0.7 },

    hero: {
      marginTop: t.space.xl,
      borderRadius: t.radius['2xl'],
      backgroundColor: t.color.primary,
      overflow: 'hidden',
      ...t.elevation.raised,
    },
    heroTop: { padding: t.space.xl },
    heroHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: t.space.sm },
    heroEyebrow: { ...t.type.label, color: t.color.onPrimary, opacity: 0.82, flexShrink: 1, writingDirection: 'auto' },
    heroCountPill: {
      borderRadius: t.radius.pill,
      paddingHorizontal: t.space.md,
      paddingVertical: 4,
      // A wash of the card's own surface rather than a new colour: the pill is
      // a label on the hero, not a second thing to look at.
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderColor: t.color.onPrimary,
    },
    heroCountText: { ...t.type.caption, color: t.color.onPrimary },
    heroTitle: { ...t.type.display, color: t.color.onPrimary, marginTop: t.space.md, writingDirection: 'auto' },
    heroCta: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: t.space.sm,
      marginTop: t.space.lg,
      backgroundColor: t.color.accent,
      borderRadius: t.radius.pill,
      paddingHorizontal: t.space.xl,
      paddingVertical: t.space.md,
      minHeight: 48,
    },
    heroCtaPressed: { opacity: 0.85 },
    heroCtaText: { ...t.type.bodyStrong, color: t.color.onAccent },
    heroPhoto: { width: '100%', height: 168, resizeMode: 'cover' as const },

    sectionHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: t.space.xl,
      marginBottom: t.space.md,
      gap: t.space.md,
    },
    sectionTitle: { ...t.type.title, color: t.color.foreground, flexShrink: 1, writingDirection: 'auto' },
    sectionLink: { ...t.type.label, color: t.color.accent },

    taskRow: { flexDirection: 'row', gap: t.space.md },
    taskCard: {
      flex: 1,
      backgroundColor: t.color.surface,
      borderRadius: t.radius.xl,
      padding: t.space.lg,
      minHeight: 116,
      ...t.elevation.card,
    },
    taskCardSpacer: { flex: 1 },
    taskTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: t.space.sm },
    taskGlyph: { width: 34, height: 34, borderRadius: t.radius.pill, alignItems: 'center', justifyContent: 'center' },
    taskWhen: { ...t.type.caption, flexShrink: 1, writingDirection: 'auto' },
    taskKind: { ...t.type.bodyStrong, color: t.color.foreground, marginTop: t.space.md, writingDirection: 'auto' },
    taskSub: { ...t.type.caption, color: t.color.textMuted, marginTop: 2, writingDirection: 'auto' },

    emptyCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space.sm,
      backgroundColor: t.color.surface,
      borderRadius: t.radius.xl,
      padding: t.space.lg,
      ...t.elevation.card,
    },
    emptyText: { ...t.type.body, color: t.color.textSecondary, flex: 1, writingDirection: 'auto' },

    stripCard: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: t.space.md,
      backgroundColor: t.color.surface,
      borderRadius: t.radius.xl,
      padding: t.space.lg,
      minHeight: 88,
      ...t.elevation.card,
    },
    stripGlyph: { width: 40, height: 40, resizeMode: 'contain' as const },
    stripEmpty: { ...t.type.body, color: t.color.textSecondary, flex: 1, writingDirection: 'auto' },
    faces: { flexDirection: 'row', alignItems: 'center' },
    face: {
      width: 44,
      height: 44,
      borderRadius: t.radius.pill,
      backgroundColor: t.color.surfaceMuted,
      borderWidth: 2,
      borderColor: t.color.surface,
    },
    // A negative start margin, not `left`: the overlap has to fall on the
    // trailing side of the previous face in Hebrew too.
    faceOverlap: { marginStart: -14 },
    faceMore: { alignItems: 'center', justifyContent: 'center', backgroundColor: t.color.primaryWash },
    faceMoreText: { ...t.type.caption, color: t.color.primary },
    stripCount: { alignItems: 'flex-end' },
    stripNumber: { ...t.type.title, color: t.color.foreground },
    stripCaption: { ...t.type.caption, color: t.color.textMuted, writingDirection: 'auto' },
  });
