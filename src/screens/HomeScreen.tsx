import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Image,
  AccessibilityInfo,
  InteractionManager,
} from 'react-native';
import FramedPhoto from '../components/FramedPhoto';
import Avatar from '../components/Avatar';
import { syncPhotoCache } from '../services/media/photoCache';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import type { RootStackParamList } from '../types';
import { Theme, useTheme } from '../theme';
import { plantRepo } from '../services/plants/plantRepoInstance';
import { genusCarePlans } from '../services/plants/genusCarePlans';
import { dueSoon, plantDisplayName } from '../lib/portfolio';
import {
  gardenState,
  greetingFor,
  needsCareCount,
  pickHeroPhoto,
  stripFaces,
  taskGroups,
  taskSubtitle,
  type TaskGroup,
} from '../lib/home';
import { directionalIconStyle, iconRow } from '../lib/i18n/rtl';
import { onboarding } from '../services/onboarding';
import { useSession } from '../hooks/useSession';
import { copy, localeTag } from '../services/language';
import { LOGO_GLYPH } from '../brand';
import type { CareKind } from '../services/plants/plantStore';

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

/*
 * The two "See all" links are 14pt text on a 20pt line box. 8pt of slop left
 * them at 36pt of tappable height - under the 44pt floor, and on the screen a
 * user taps first. The bell next to them is a 44x44 circle and always met it;
 * these are text, so the target has to be bought with slop instead.
 */
const SEE_ALL_HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 };

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
  /*
   * Whether the garden is readable at all, asked BEFORE anything is said about
   * how many plants are in it. Every failure path in plantStore returns
   * `plants: []`, so `plants.length === 0` cannot tell a corrupt library from a
   * new user - and Home's empty state is written for the new user. See
   * gardenState.
   */
  const garden = gardenState(library);
  const [profileName] = useState(() => onboarding.load()?.name);

  /* Coming back from the camera or a plant detail must not leave a stale count
   * on the dashboard - this is the screen most likely to be looked at and not
   * scrolled, so a wrong number here is a wrong number the user trusts. */
  /*
   * Re-rolled on every focus, not once per mount: coming back to Home from
   * another tab is a visit, and the card showing a different plant each time
   * is the point of the feature. Held in state rather than drawn during render
   * so a re-render (a reminder toggling, the library reloading) cannot quietly
   * swap the photo mid-scroll.
   */
  const [heroRoll, setHeroRoll] = useState(() => Math.random());

  /*
   * Photos the strip has watched fail to load. Only the renderer can know this
   * - a dead URI is a truthy string until something tries to fetch it - so
   * onError feeds it back to stripFaces, which then treats it exactly like a
   * plant with no photo at all. Without this the strip drew the grey box its
   * own has-a-photo filter was written to prevent.
   */
  const [failedPhotos, setFailedPhotos] = useState<ReadonlySet<string>>(() => new Set());

  /*
   * Reduce Motion, read once. The hero re-rolls on EVERY focus, so its crossfade
   * is not a one-off entrance animation - it fires each time the user opens the
   * app or comes back to the tab, on the first screen they see. PortfolioScreen
   * already reads this setting for its CTA pulse; Home animating regardless left
   * two screens in one app disagreeing about whether the preference applies.
   *
   * Defaults to false so the animation is the fallback if the query fails: a
   * missing fade is a smaller wrong than a screen that silently stops animating
   * for everyone.
   */
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduced) => {
        if (alive) setReduceMotion(reduced);
      })
      .catch(() => {
        /* a preference we could not read is not a reason to fail the screen */
      });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (reduced) =>
      setReduceMotion(reduced)
    );
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  const notePhotoFailed = useCallback((uri: string) => {
    setFailedPhotos((prev) => (prev.has(uri) ? prev : new Set(prev).add(uri)));
  }, []);

  useFocusEffect(
    useCallback(() => {
      const loaded = plantRepo.loadLocal();
      setLibrary(loaded);

      /*
       * The re-roll waits for the tab transition to finish.
       *
       * It swaps the hero to a DIFFERENT plant, so it is a full-width image
       * mounting and decoding - and firing it from the focus effect meant that
       * happened while the screen was still animating in, which is exactly the
       * frame budget a transition has none of to spare. After the animation the
       * swap is free, and the user actually sees it happen rather than arriving
       * to a picture that changed behind the slide.
       */
      const roll = InteractionManager.runAfterInteractions(() => setHeroRoll(Math.random()));

      /*
       * Warm the photographs this screen is about to draw, and pull any that
       * still live only in the cloud down onto the phone.
       *
       * Home is the screen this matters most on. The hero re-rolls on EVERY
       * focus, so it is a DIFFERENT plant each visit and therefore a guaranteed
       * cold decode of a full-width image - the one photo on the dashboard that
       * could never benefit from having been drawn a moment ago. Warming the
       * whole photographed pool means whichever plant the roll lands on is
       * already decoded.
       *
       * Filtered to plants that HAVE a photo so the warm budget is not spent on
       * rows that have nothing to draw. Idempotent and near-free once the
       * library is mirrored, which is what makes it safe on every focus.
       */
      syncPhotoCache(loaded.plants.filter((p) => !!p.photoUri));

      /* Leaving before the animation settled means the roll was for a visit
       * that is already over - re-rolling into a blurred-out screen only costs
       * the decode. */
      return () => roll.cancel();
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
  const { shown, overflow } = useMemo(
    () => stripFaces(plants, undefined, failedPhotos),
    [plants, failedPhotos]
  );

  const greeting = copy.home.greeting[greetingFor(new Date(now).getHours())];
  const title = profileName ? copy.home.greetingWithName(greeting, profileName) : greeting;
  const today = new Date(now).toLocaleDateString(localeTag(), {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  /* The hero photograph is one of the user's own plants, not stock art: the
   * card is about THEIR garden, and a stranger's monstera under "your garden
   * at a glance" is a small lie the whole screen then has to live with. Which
   * one is re-rolled every visit - see pickHeroPhoto. With no photographed
   * plants there is no photo, and the card drops it rather than showing a
   * placeholder box. */

  /* What the card showed last, so the next roll can avoid repeating it. A ref
   * rather than state: it must not itself trigger a render. Declared before the
   * memo that reads it. */
  const heroPrevious = useRef<string | undefined>(undefined);
  const heroPhoto = useMemo(
    () => pickHeroPhoto(plants, heroRoll, heroPrevious.current),
    [plants, heroRoll]
  );
  heroPrevious.current = heroPhoto;

  /* The hero is picked as a URI, so the plant behind it has to be found again
   * to honour its framing. Cheap - the library is a dozen rows - and keeps
   * `pickHeroPhoto` a pure choice between photos. */
  const heroPlant = useMemo(
    () => plants.find((p) => p.photoUri === heroPhoto),
    [plants, heroPhoto]
  );

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
          {/*
            The account's face, next to the greeting that already uses their
            name. Tapping it goes to Settings rather than straight to the photo
            editor: on this screen it is an identity, not a control, and a user
            reaching for "my account" expects the account.
          */}
          <Avatar
            size={40}
            name={profileName}
            onPress={() => navigation.navigate('Settings')}
            accessibilityLabel={copy.settings.profileSettings}
            style={s.headerAvatar}
          />
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

        {/*
          The library could not be read, so say that before saying anything
          else. Same copy as Portfolio's warning, deliberately: this is one
          fact about one library, and two wordings for it would drift.
        */}
        {garden.kind === 'unreadable' && (
          <View style={s.warnCard}>
            <Ionicons name="alert-circle" size={20} color={t.color.warning} />
            <View style={s.warnBody}>
              <Text style={s.warnTitle}>
                {garden.reason === 'future_version'
                  ? copy.portfolio.warnFutureTitle
                  : copy.portfolio.warnUnreadableTitle}
              </Text>
              <Text style={s.warnText}>
                {garden.reason === 'future_version'
                  ? copy.portfolio.warnFutureText
                  : copy.portfolio.warnUnreadableText}
              </Text>
            </View>
          </View>
        )}

        {/* --- hero ------------------------------------------------------- */}
        <View style={s.hero}>
          <View style={s.heroTop}>
            <View style={s.heroHeadRow}>
              <Text style={s.heroEyebrow}>{copy.home.heroEyebrow}</Text>
              {/* A count is a claim about the library. Suppressed when the
                  library did not load, because "0 plants" there is false. */}
              {garden.kind !== 'unreadable' && (
                <View style={s.heroCountPill}>
                  <Text style={s.heroCountText}>{copy.home.plantCount(plants.length)}</Text>
                </View>
              )}
            </View>
            <Text style={s.heroTitle}>
              {/*
                The new-user invitation ("Start your garden with one photo.")
                only fits a user who HAS no garden. An unreadable library keeps
                the neutral headline: the camera still works, and that is the
                one thing still true.
              */}
              {garden.kind === 'empty' ? copy.home.heroEmptyTitle : copy.home.heroTitle}
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
          {heroPhoto !== undefined && (
            <FramedPhoto
              uri={heroPhoto}
              plantId={heroPlant?.id}
              focusY={heroPlant?.photoFocusY}
              zoom={heroPlant?.photoZoom}
              style={s.heroPhoto}
              recyclingKey={heroPhoto}
              transition={reduceMotion ? 0 : 160}
            />
          )}
        </View>

        {/* --- upcoming tasks --------------------------------------------- */}
        <View style={s.sectionHead}>
          <Text style={s.sectionTitle}>{copy.home.tasksTitle}</Text>
          {groups.length > 0 && (
            <Pressable
              onPress={() => navigation.navigate('Home', { screen: 'Portfolio' })}
              accessibilityRole="button"
              hitSlop={SEE_ALL_HIT_SLOP}
            >
              <Text style={s.sectionLink}>{copy.home.tasksSeeAll}</Text>
            </Pressable>
          )}
        </View>

        {groups.length === 0 ? (
          /*
            "Nothing due this week. Your plants are set." is a green tick and an
            all-clear. On a library we could not read it is the most damaging of
            the three lines, because it does not merely mislead - it actively
            reassures. No tasks were derived because no plants were, so the
            honest answer is that we do not know.
          */
          garden.kind === 'unreadable' ? (
            <View style={s.emptyCard}>
              <Ionicons name="help-circle-outline" size={18} color={t.color.textMuted} />
              <Text style={s.emptyText}>{copy.home.tasksUnknown}</Text>
            </View>
          ) : (
            <View style={s.emptyCard}>
              <Ionicons name="checkmark-circle-outline" size={18} color={t.color.success} />
              <Text style={s.emptyText}>{copy.home.tasksEmpty}</Text>
            </View>
          )
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
            hitSlop={SEE_ALL_HIT_SLOP}
          >
            <Text style={s.sectionLink}>{copy.home.plantsSeeAll}</Text>
          </Pressable>
        </View>

        <Pressable
          style={({ pressed }) => [s.stripCard, pressed && s.pressed]}
          onPress={() => navigation.navigate('Home', { screen: 'Portfolio' })}
          accessibilityRole="button"
          accessibilityLabel={
            garden.kind === 'unreadable'
              ? copy.home.unreadableStrip
              : garden.kind === 'empty'
                ? copy.home.emptyStrip
                : `${copy.home.plantCount(plants.length)}, ${
                    behind > 0 ? `${behind} ${copy.home.needsCare(behind)}` : copy.home.allHealthy
                  }`
          }
        >
          {garden.kind !== 'ready' ? (
            <>
              <Image source={LOGO_GLYPH} style={[s.stripGlyph, { tintColor: t.color.textMuted }]} />
              {/* "No plants yet. Diagnose one to get started." reads as a fresh
                  install. On an unreadable library it reads as a deletion the
                  user never performed - the precise sentence Portfolio exists
                  to avoid. */}
              <Text style={s.stripEmpty}>
                {garden.kind === 'unreadable' ? copy.home.unreadableStrip : copy.home.emptyStrip}
              </Text>
            </>
          ) : (
            <>
              <View style={s.faces}>
                {/* ExpoImage rather than RN's Image: this strip was the last
                    place still using the platform one, which has no disk cache
                    of its own, so these faces were re-fetched from the network
                    on every launch even after the rest of the app stopped. */}
                {shown.map((p, i) => (
                  <FramedPhoto
                    key={p.id}
                    uri={p.photoUri}
                    plantId={p.id}
                    focusY={p.photoFocusY}
                    zoom={p.photoZoom}
                    style={[s.face, i > 0 && s.faceOverlap]}
                    recyclingKey={p.id}
                    accessibilityLabel={plantDisplayName(p)}
                    onError={() => notePhotoFailed(p.photoUri)}
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
    scroll: { padding: t.space.lg },

    /* Same shape as Portfolio's warning card - one library, one look. */
    warnCard: {
      flexDirection: 'row',
      backgroundColor: t.color.warningWash,
      borderRadius: t.radius.lg,
      padding: t.space.md,
      marginTop: t.space.md,
    },
    warnBody: { flex: 1, marginStart: t.space.sm },
    warnTitle: { ...t.type.bodyStrong, color: t.color.foreground },
    warnText: { ...t.type.caption, color: t.color.textSecondary, marginTop: 2 },

    headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: t.space.md },
    /* Nudged down so a 40pt circle sits against the two lines of the greeting
     * rather than against the top of the date above them. */
    headerAvatar: { marginTop: 2 },
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
    /* The whole block is deliberately tighter than the 8pt rhythm's default
     * would give it: this is the first thing on the screen and it was taking
     * enough height to push the actual content - tasks, and the plant list -
     * below the fold on a smaller phone. */
    heroTop: { padding: t.space.lg },
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
    /* `title` rather than `display`: 23/30 instead of 32/40. The hero is a
     * greeting, not a headline, and the 32pt cut was buying presence at the
     * cost of two lines of wrap on any name longer than a few words. */
    heroTitle: { ...t.type.title, color: t.color.onPrimary, marginTop: t.space.sm, writingDirection: 'auto' },
    heroCta: {
      ...iconRow,
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: t.space.sm,
      marginTop: t.space.md,
      backgroundColor: t.color.accent,
      borderRadius: t.radius.pill,
      paddingHorizontal: t.space.lg,
      paddingVertical: t.space.sm,
      /* 44, not lower. That is the accessibility floor for a tap target and
       * the audit on NurseriesScreen already holds every other button to it -
       * shrinking the hero must not quietly make its main action harder to
       * hit than the ones around it. */
      minHeight: 44,
    },
    heroCtaPressed: { opacity: 0.85 },
    heroCtaText: { ...t.type.bodyStrong, color: t.color.onAccent },
    /*
     * A shape rather than a fixed height: 4:3 is what phone cameras shoot, so
     * this crops the user's own photograph least, and it scales with the phone
     * instead of being a 168pt sliver on a large screen and a letterbox on a
     * small one.
     */
    heroPhoto: { width: '100%', aspectRatio: 4 / 3 },

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
