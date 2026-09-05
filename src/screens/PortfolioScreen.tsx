import React, { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Animated,
  ScrollView,
  SectionList,
  AccessibilityInfo,
  Image,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { RootStackParamList } from '../types';
import { Theme, useTheme } from '../theme';
import { plantRepo } from '../services/plantRepoInstance';
import { plantLibrary } from '../services/plantLibrary';
import { plantPhotos } from '../services/photos';
import { genusCarePlans } from '../services/genusCarePlans';
import { triageSections } from '../lib/triage';
import {
  dueSoon,
  filterPortfolio,
  isBehindOnCare,
  plantSchedule,
  offersGuestImport,
  plantDisplayName,
  showsLibraryLayout,
  type CareSlot,
  type DueItem,
  type PortfolioFilter,
} from '../lib/portfolio';
import { directionalIconStyle } from '../lib/rtl';
import type { CareKind, StoredPlant } from '../services/plantStore';
import { APP_LOGO } from '../brand';
import { FEATURES } from '../content/features';
import { onboarding } from '../services/onboarding';
import { useSession } from '../hooks/useSession';
import { getSessionHint } from '../services/sessionHint';
import { copy } from '../services/language';
import { diagnoseTargets, waterTargets } from '../lib/bulkCare';
import { bulkDiagnose } from '../services/bulkDiagnoseInstance';
import type { BulkProgress } from '../services/bulkDiagnose';
import PlantCard from '../components/PlantCard';
import ImportBanner from '../components/ImportBanner';
import { TAB_BAR_CLEARANCE } from '../navigation/tabBarMetrics';

/*
 * The Portfolio tab - every plant the user owns, not just the ones they
 * photographed.
 *
 * This replaces the old "My Plants" screen, which could only ever show scanned
 * plants because the camera was the only way a record got created. A user with
 * nine plants and two problems had a library of two. The tab now holds both
 * kinds of record, with a two-chip filter that answers the question the user
 * actually asked for - "which of these have I had checked" - and a strip of
 * what is due this week so nobody has to open nine plants to find out.
 *
 * Everything about WHICH plants and WHAT they are called is decided in
 * src/lib/portfolio.ts, under `node --test`. This file is a renderer over it,
 * which is what keeps the interesting cases testable without a device.
 */

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Home'>;
};

/* The care kinds' glyphs and tints, matching ScheduleCard so the same kind is
 * the same colour wherever the user meets it. Palette keys rather than
 * literals: the theme owns light and dark. */
const KIND_ICON: Record<CareKind, { icon: keyof typeof Ionicons.glyphMap; tint: keyof Theme['color'] }> = {
  water: { icon: 'water-outline', tint: 'water' },
  fertilizer: { icon: 'nutrition-outline', tint: 'feed' },
  repot: { icon: 'flower-outline', tint: 'repot' },
};

/*
 * The strip is a nudge, not a task list. Four rows is roughly one plant's worth
 * of screen: enough that the common case (a couple of thirsty plants) is shown
 * whole, and short enough that a library where everything came due at once
 * cannot push the portfolio itself below the fold - which would leave the user
 * scrolling past a wall of reminders to reach the thing they opened the tab
 * for. The overflow is not hidden, it is counted, so a truncated strip says so.
 */
const DUE_ROW_CAP = 4;

export default function PortfolioScreen({ navigation }: Props) {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);

  /*
   * Adaptive Portfolio (D8/H2): marketing copy on first run, the library once a
   * plant exists.
   *
   * The lazy useState initializer is the whole reason the store is
   * synchronous. Reading in an effect would render the first-run layout for a
   * frame and then swap it, so a returning user would see marketing content
   * flash before their own plants. This runs during the first render instead,
   * so the correct layout is the only one ever painted.
   */
  const session = useSession();

  /*
   * Same lazy-initializer requirement as before (D8) - `plantRepo.loadLocal`
   * is still synchronous, it just picks guest vs. mirror key internally via
   * `sessionHint`, which `useSession` above keeps current.
   */
  const [library, setLibrary] = useState(() => plantRepo.loadLocal());

  /*
   * The name from onboarding, read synchronously for the same reason the
   * library is: the header would otherwise render "Plant Doctor" and then swap
   * to the greeting a frame later. Read once - it cannot change while the app
   * is running, since onboarding only precedes this tab.
   */
  const [profileName] = useState(() => onboarding.load()?.name);
  const [importOffered, setImportOffered] = useState(() =>
    offersGuestImport({ loggedIn: getSessionHint(), guestCount: plantRepo.guestPlantCount() })
  );
  /* Declining is per-visit and deliberately not persisted - see ImportBanner. */
  const [importDismissed, setImportDismissed] = useState(false);
  const showImportBanner = importOffered && !importDismissed;

  /* All or diagnosed. Local, not persisted: the chip is a lens the user holds
   * for a moment, and a filter that survived a relaunch would look like plants
   * had gone missing. */
  const [filter, setFilter] = useState<PortfolioFilter>('all');

  /*
   * The bulk job lives in a module-level service, not here: it keeps running
   * while the user browses other tabs, so this screen only mirrors its
   * progress. Subscribing hands the current state immediately, which is what
   * lets a returning user see a job that started before they left.
   */
  const [bulk, setBulk] = useState<BulkProgress>(() => bulkDiagnose.get());
  useEffect(() => bulkDiagnose.subscribe(setBulk), []);

  /* Refresh the cards as findings land, so a diagnosed plant stops looking
   * untouched while the job is still working through the rest. */
  useEffect(() => {
    if (bulk.state === 'running' || bulk.state === 'done') setLibrary(plantRepo.loadLocal());
  }, [bulk.done, bulk.state]);

  const [watering, setWatering] = useState(false);

  // A plant saved on the Diagnosis screen - or on the add-plant form - has to
  // appear on the way back.
  useFocusEffect(
    useCallback(() => {
      setLibrary(plantRepo.loadLocal());
    }, [])
  );

  // Logged-in background refresh (local cache first, then reconcile from
  // Supabase) - re-fetches after the synchronous mirror read above has
  // already painted, and only touches state if the result actually differs
  // in size.
  useEffect(() => {
    if (!session) return;
    plantRepo.refreshFromCloud().then((fresh) => {
      setLibrary((current) => (fresh.plants.length !== current.plants.length ? fresh : current));
    });
  }, [session]);

  // Guest plants left un-imported can change across a login/logout
  // transition (a fresh login's guest key may now have entries a previous
  // session's mirror didn't) - re-check whenever session identity changes,
  // rather than only once at mount.
  useEffect(() => {
    setImportOffered(
      offersGuestImport({ loggedIn: session !== null, guestCount: plantRepo.guestPlantCount() })
    );
  }, [session]);

  /*
   * Photo housekeeping (TODOS item 9), once per launch and off the render path.
   *
   * Two jobs. First, RETRY: a plant whose `photoUri` still points at the cache
   * directory had its copy interrupted - by a kill, a full disk, a removal that
   * raced it. The cache file often survives long enough for a second attempt to
   * work, and the alternative is a photo that is lost for good.
   *
   * Second, SWEEP: a file no plant claims can never be reached again. It comes
   * from the same interruptions, and from an unsave that landed after its copy.
   * Both are silent leaks into a directory the system never reclaims.
   *
   * Neither runs against a library that failed to load: it reports zero plants,
   * so a sweep would delete every photo the user has.
   */
  useEffect(() => {
    // Photos for a logged-in user live in Supabase Storage, not the document
    // directory, so this local-file adopt/sweep must not run against the mirror.
    if (!library.ok || getSessionHint()) return;
    const plants = library.plants;

    (async () => {
      let repaired = false;
      for (const plant of plants) {
        if (plantPhotos.owns(plant.photoUri)) continue;
        const persisted = await plantPhotos.adopt(plant.id, plant.photoUri);
        if (persisted && plantLibrary.update(plant.id, { photoUri: persisted }).ok) {
          repaired = true;
        }
      }

      // Re-read rather than sweeping against `plants`: a plant could have been
      // saved or removed while the copies were running, and the newest read is
      // the only one that can say which files are still claimed.
      const current = plantLibrary.load();
      plantPhotos.sweep(
        current.plants.map((p) => p.id),
        { libraryReadable: current.ok }
      );

      if (repaired) setLibrary(current);
    })();
    // Launch-time housekeeping, not a reaction to the library changing - the
    // focus effect above re-reads it constantly and this must not run each time.
  }, [session]);

  /*
   * Every plant's three care slots, built once per library read and shared by
   * the cards, the Needs care chip and its count. Building them per card would
   * run the same genus lookup three times over for the same plant, and building
   * them twice - once for the chip, once for the card - is how a chip that says
   * "(2)" ends up next to three highlighted cards.
   */
  const schedules = useMemo(() => {
    const map = new Map<string, CareSlot[]>();
    for (const plant of library.plants) {
      const genus = plant.species?.genus ?? plant.diagnosis?.genus;
      map.set(
        plant.id,
        plantSchedule(
          plant,
          Date.now(),
          genus ? genusCarePlans.peek(genus) : null,
          copy.schedule,
          copy.care,
          copy.watering
        )
      );
    }
    return map;
    // Same contract as `due` below: the clock is read once per library read, so
    // the list cannot reshuffle under a scrolling thumb for a day boundary.
  }, [library]);

  const behind = useCallback(
    (plant: StoredPlant) => isBehindOnCare(schedules.get(plant.id) ?? []),
    [schedules]
  );

  const counts = useMemo(
    () => ({
      all: library.plants.length,
      needsCare: library.plants.filter(behind).length,
      diagnosed: library.plants.filter((p) => p.diagnosis !== undefined).length,
    }),
    [library, behind]
  );

  const visible = useMemo(
    () => filterPortfolio(library.plants, filter, behind),
    [library, filter, behind]
  );

  /*
   * Triage grouping stays exactly where it was, and ONLY on the All view. The
   * user asked for a filter, not a reorganisation: a chip that both narrows the
   * list and regroups it is two changes at once, and the second one is the kind
   * that makes a user think plants moved. Diagnosed renders flat, in the
   * library's own newest-first order, which is what `filterPortfolio` preserves.
   */
  const sections = useMemo<{ key: string; title: string; data: StoredPlant[] }[]>(
    () =>
      filter === 'all'
        ? triageSections(visible, copy.triage)
        : /* One untitled section, so SectionList renders a flat list without a
           * second code path for it. `TriageKey` is deliberately not widened to
           * hold a 'diagnosed' bucket - this is a rendering shape, not a triage
           * bucket, and triage.ts should not learn about the filter. */
          [{ key: filter, title: '', data: visible }],
    [visible, filter]
  );

  /*
   * Due this week, computed from the WHOLE library rather than the filtered
   * view: what needs water this week does not change because the user is
   * looking at a subset, and a strip that emptied when the chip moved would
   * read as care disappearing.
   *
   * `peek`, never `get`. The strip renders on the first frame and there is one
   * lookup per plant, so a network call per genus would either block the paint
   * or fill the strip in a frame later, under the user's thumb. A genus with no
   * cached plan simply gets null, and `dueSoon` degrades to the diagnosis's own
   * interval - which is exactly what the card showed before this feature
   * existed, so the miss costs nothing that was ever there.
   */
  const due = useMemo(() => {
    return dueSoon(
      library.plants,
      Date.now(),
      (plant: StoredPlant) => {
        const genus = plant.species?.genus ?? plant.diagnosis?.genus;
        return genus ? genusCarePlans.peek(genus) : null;
      },
      copy.care,
      copy.watering
    );
    // `library` is the input; the clock is read once per library read on
    // purpose - re-running this on a timer would reshuffle the strip under a
    // user mid-scroll for a day boundary they cannot see.
  }, [library]);


  /* Both bulk actions act on many plants at once, so both state the count
   * before spending anything - see lib/bulkCare.ts for who they act on. */
  const onDiagnoseAll = useCallback(() => {
    const { targets, skippedNoPhoto } = diagnoseTargets(library.plants);
    if (targets.length === 0) {
      /* Two different "nothing to do" stories: everything is already checked,
       * or there are plants we cannot check because they have no picture. The
       * second is actionable, so it names the fix. */
      Alert.alert(
        copy.bulkCare.diagnoseNothingTitle,
        skippedNoPhoto > 0
          ? copy.bulkCare.diagnoseNoPhotos(skippedNoPhoto)
          : copy.bulkCare.diagnoseNothingBody
      );
      return;
    }
    Alert.alert(
      copy.bulkCare.diagnoseConfirmTitle,
      copy.bulkCare.diagnoseConfirmBody(targets.length, skippedNoPhoto),
      [
        { text: copy.bulkCare.cancelAction, style: 'cancel' },
        {
          text: copy.bulkCare.confirm,
          onPress: () => {
            // Not awaited: the whole point is that it runs while the user
            // carries on. Progress arrives through the subscription above.
            void bulkDiagnose.run(targets, skippedNoPhoto);
          },
        },
      ]
    );
  }, [library]);

  const onWaterAll = useCallback(() => {
    /*
     * Every plant in the library, not the filtered view: "water all" means the
     * portfolio, and the All/Diagnosed chips are a way of looking at it rather
     * than a selection.
     */
    const targets = waterTargets(library.plants);
    if (targets.length === 0) {
      Alert.alert(copy.bulkCare.waterNothingTitle, copy.bulkCare.waterNothingBody);
      return;
    }
    Alert.alert(
      copy.bulkCare.waterConfirmTitle,
      copy.bulkCare.waterConfirmBody(targets.length),
      [
        { text: copy.bulkCare.cancelAction, style: 'cancel' },
        {
          text: copy.bulkCare.confirm,
          onPress: async () => {
            setWatering(true);
            /*
             * One stamp for the whole batch rather than Date.now() per plant:
             * the user watered them in one pass, and a spread of timestamps
             * would put the same errand on several minutes of the history.
             */
            const at = Date.now();
            const results = await Promise.all(targets.map((p) => plantRepo.markWatered(p.id, at)));
            setLibrary(plantRepo.loadLocal());
            setWatering(false);
            const failed = results.filter((r) => !r.ok).length;
            Alert.alert(
              copy.bulkCare.waterDone(results.length - failed),
              failed > 0 ? copy.bulkCare.waterFailed : undefined
            );
          },
        },
      ]
    );
  }, [library]);

  /*
   * NOT just "does the library have plants". When logged in, `library` is the cloud mirror, and a
   * brand new account's mirror is empty - so a user who signed up holding guest
   * plants fell through to the first-run layout, which is the only layout that
   * does not render the import banner. Their plants were on disk the whole
   * time with no way to reach them.
   */
  const libraryLayout = showsLibraryLayout({
    plantCount: library.plants.length,
    libraryReadable: library.ok !== false,
    offeringImport: showImportBanner,
  });

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(40)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 400, useNativeDriver: true }),
    ]).start();

    // Ambient CTA pulse - respect reduced-motion (a11y: reduced-motion).
    let loop: Animated.CompositeAnimation | undefined;
    AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (reduced) return;
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.03, duration: 1400, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 1400, useNativeDriver: true }),
        ])
      );
      loop.start();
    });
    return () => loop?.stop();
  }, []);

  const CHIP_A11Y: Record<PortfolioFilter, string> = {
    all: copy.portfolio.filterAllA11y,
    needsCare: copy.portfolio.filterNeedsCareA11y,
    diagnosed: copy.portfolio.filterDiagnosedA11y,
  };

  const renderChip = (value: PortfolioFilter, label: string) => {
    const active = filter === value;
    const count = counts[value];
    return (
      <Pressable
        key={value}
        onPress={() => setFilter(value)}
        style={({ pressed }) => [s.chip, active && s.chipActive, pressed && s.chipPressed]}
        accessibilityRole="button"
        // Selected state announced rather than left to colour alone (a11y).
        accessibilityState={{ selected: active }}
        accessibilityLabel={CHIP_A11Y[value]}
      >
        {/*
          The dot is only on Needs care, and only when something actually is:
          it is the one chip that reports a problem, and a dot that is always
          there is a dot nobody sees.
        */}
        {value === 'needsCare' && count > 0 && (
          <View style={[s.chipDot, { backgroundColor: active ? t.color.onPrimary : t.color.accent }]} />
        )}
        <Text style={[s.chipText, active && s.chipTextActive]}>
          {copy.portfolio.filterCount(label, count)}
        </Text>
      </Pressable>
    );
  };

  const renderDueRow = (item: DueItem) => {
    const kind = KIND_ICON[item.kind];
    const tint = t.color[kind.tint];
    const name = plantDisplayName(item.plant);
    return (
      <Pressable
        key={`${item.plant.id}:${item.kind}`}
        style={({ pressed }) => [s.dueRow, pressed && s.dueRowPressed]}
        onPress={() => navigation.navigate('PlantDetail', { plantId: item.plant.id })}
        accessibilityRole="button"
        accessibilityLabel={`${name}, ${item.label}`}
      >
        <View style={[s.dueIcon, { backgroundColor: t.color.surfaceMuted }]}>
          <Ionicons name={kind.icon} size={14} color={tint} />
        </View>
        <Text style={s.dueName} numberOfLines={1}>
          {name}
        </Text>
        <Text style={[s.dueLabel, { color: tint }]} numberOfLines={1}>
          {item.label}
        </Text>
        <Ionicons
          name="chevron-forward"
          size={14}
          color={t.color.textMuted}
          style={directionalIconStyle}
        />
      </Pressable>
    );
  };


  /*
   * Returning-user layout. The design review's "do not touch Home" rule was
   * about not degrading the first-run screen, which is why that branch below
   * is untouched - this is a second layout holding the same tokens on purpose
   * rather than by inheritance.
   */
  if (libraryLayout) {
    return (
      <SafeAreaView style={s.container} edges={['top']} /* bottom inset belongs to the tab bar */>
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          contentContainerStyle={s.libScroll}
          showsVerticalScrollIndicator={false}
          stickySectionHeadersEnabled={false}
          ListHeaderComponent={
            <>
              {/*
                The library masthead. The app's own name is not here on purpose:
                a returning user knows which app they opened, and the one thing
                worth the widest line on the screen is what they came for - their
                plants, and how many of them there are.
              */}
              <View style={s.libHeader}>
                <View style={s.libHeaderText}>
                  <Text style={s.libEyebrow}>
                    {profileName
                      ? copy.portfolio.greetingNamed(profileName)
                      : copy.portfolio.greetingAnonymous}
                  </Text>
                  <Text style={s.libHeaderTitle}>{copy.portfolio.title}</Text>
                  <Text style={s.libHeaderCount}>{copy.home.plantCount(library.plants.length)}</Text>
                </View>
                <Pressable
                  onPress={() => navigation.navigate('Settings')}
                  accessibilityRole="button"
                  accessibilityLabel={copy.portfolio.settingsA11y}
                  style={({ pressed }) => [s.iconBtn, pressed && s.chipPressed]}
                  hitSlop={8}
                >
                  <Ionicons name="settings-outline" size={20} color={t.color.textSecondary} />
                </Pressable>
                {/*
                  Adding a plant you already own was a floating button over the
                  list. It lives in the header now: a FAB parked over the last
                  card is a second primary action fighting the camera CTA in the
                  footer, and this reads as what it is - a way to file a plant,
                  not the thing the app is for.
                */}
                <Pressable
                  style={({ pressed }) => [s.addBtn, pressed && s.addBtnPressed]}
                  onPress={() => navigation.navigate('AddPlant')}
                  accessibilityRole="button"
                  accessibilityLabel={copy.portfolio.addPlantA11y}
                >
                  <Ionicons name="add" size={18} color={t.color.onPrimary} />
                  <Text style={s.addBtnText}>{copy.portfolio.addPlant}</Text>
                </Pressable>
              </View>

              {showImportBanner && (
                <ImportBanner
                  count={plantRepo.guestPlantCount()}
                  onImport={async () => {
                    const result = await plantRepo.importGuestPlants();
                    const fresh = await plantRepo.refreshFromCloud();
                    setLibrary(fresh);
                    return result;
                  }}
                  onDismiss={() => setImportDismissed(true)}
                />
              )}

              {/*
                A damaged library must never be reported as an empty one -
                "you have no plants" is indistinguishable from a deletion the
                user never performed. The store preserved the bytes, so the
                copy says recoverable, not lost.
              */}
              {library.ok === false && (
                <View style={s.warnCard}>
                  <Ionicons name="alert-circle" size={20} color={t.color.warning} />
                  <View style={s.warnBody}>
                    <Text style={s.warnTitle}>
                      {library.reason === 'future_version'
                        ? copy.portfolio.warnFutureTitle
                        : copy.portfolio.warnUnreadableTitle}
                    </Text>
                    <Text style={s.warnText}>
                      {library.reason === 'future_version'
                        ? copy.portfolio.warnFutureText
                        : copy.portfolio.warnUnreadableText}
                    </Text>
                  </View>
                </View>
              )}

              {due.length > 0 && (
                <View style={s.dueCard}>
                  <Text style={s.dueTitle}>{copy.portfolio.dueThisWeek}</Text>
                  {due.slice(0, DUE_ROW_CAP).map(renderDueRow)}
                  {due.length > DUE_ROW_CAP && (
                    <Text style={s.dueMore}>
                      {copy.portfolio.dueMore(due.length - DUE_ROW_CAP)}
                    </Text>
                  )}
                </View>
              )}

              {/*
                Two bulk actions, above the filter chips: they act on the whole
                library, so they belong with the library-wide controls rather
                than inside a filtered view whose contents they ignore.
              */}
              <View style={s.bulkRow}>
                <Pressable
                  style={({ pressed }) => [s.bulkBtn, pressed && s.bulkBtnPressed]}
                  onPress={onDiagnoseAll}
                  accessibilityRole="button"
                  accessibilityLabel={copy.bulkCare.a11yDiagnoseAll}
                >
                  <Ionicons name="scan-outline" size={18} color={t.color.primary} />
                  <Text style={s.bulkBtnText} numberOfLines={1}>
                    {copy.bulkCare.diagnoseAll}
                  </Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [s.bulkBtn, pressed && s.bulkBtnPressed]}
                  onPress={onWaterAll}
                  disabled={watering}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: watering }}
                  accessibilityLabel={copy.bulkCare.a11yWaterAll}
                >
                  {watering ? (
                    <ActivityIndicator size="small" color={t.color.water} />
                  ) : (
                    <Ionicons name="water-outline" size={18} color={t.color.water} />
                  )}
                  <Text style={s.bulkBtnText} numberOfLines={1}>
                    {copy.bulkCare.waterAll}
                  </Text>
                </Pressable>
              </View>

              {/*
                The job outlives this screen, so the row reports it wherever the
                user left it - and stays after it finishes until dismissed, so
                a run that completed in another tab is still reported.
              */}
              {bulk.state !== 'idle' && (
                <View style={s.bulkProgress}>
                  {bulk.state === 'running' ? (
                    <ActivityIndicator size="small" color={t.color.primary} />
                  ) : (
                    <Ionicons name="checkmark-circle" size={18} color={t.color.primary} />
                  )}
                  <View style={s.bulkProgressText}>
                    <Text style={s.bulkProgressTitle} numberOfLines={1}>
                      {bulk.state === 'running'
                        ? copy.bulkCare.diagnoseRunning(bulk.done, bulk.total)
                        : bulk.failed > 0
                          ? copy.bulkCare.diagnoseDoneWithFailures(bulk.done, bulk.failed)
                          : copy.bulkCare.diagnoseDone(bulk.done)}
                    </Text>
                    {bulk.state === 'running' && bulk.currentName !== undefined && (
                      <Text style={s.bulkProgressSub} numberOfLines={1}>
                        {bulk.currentName}
                      </Text>
                    )}
                    {bulk.state === 'done' && bulk.skippedNoPhoto > 0 && (
                      <Text style={s.bulkProgressSub} numberOfLines={1}>
                        {copy.bulkCare.diagnoseDoneSkipped(bulk.skippedNoPhoto)}
                      </Text>
                    )}
                  </View>
                  <Pressable
                    onPress={() => (bulk.state === 'running' ? bulkDiagnose.cancel() : bulkDiagnose.dismiss())}
                    hitSlop={10}
                    accessibilityRole="button"
                  >
                    <Text style={s.bulkProgressAction}>
                      {bulk.state === 'running' ? copy.bulkCare.cancel : copy.bulkCare.dismiss}
                    </Text>
                  </Pressable>
                </View>
              )}

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={s.chipRow}
              >
                {renderChip('all', copy.portfolio.filterAll)}
                {renderChip('needsCare', copy.portfolio.filterNeedsCare)}
                {renderChip('diagnosed', copy.portfolio.filterDiagnosed)}
              </ScrollView>

              {/*
                A filter that matches nothing is not an empty library, and the
                copy has to say so - otherwise the Diagnosed chip on a
                hand-built portfolio reads as data loss.
              */}
              {visible.length === 0 && filter !== 'all' && (
                <Text style={s.emptyFilter}>
                  {filter === 'needsCare' ? copy.portfolio.noneNeedCare : copy.portfolio.noneDiagnosed}
                </Text>
              )}
            </>
          }
          renderSectionHeader={({ section }) =>
            /* Flat on the Diagnosed view: one section with no title, so the
             * list is a list rather than a group of one. */
            section.title ? <Text style={s.sectionHeader}>{section.title}</Text> : null
          }
          renderItem={({ item }) => (
            <PlantCard
              plant={item}
              slots={schedules.get(item.id)}
              onPress={() => navigation.navigate('PlantDetail', { plantId: item.id })}
              onEdit={() => navigation.navigate('EditPlant', { plantId: item.id })}
            />
          )}
          ListFooterComponent={
            <Pressable
              style={({ pressed }) => [s.ctaBtn, s.libCta, pressed && s.ctaBtnPressed]}
              onPress={() => navigation.navigate('Camera')}
              accessibilityRole="button"
              accessibilityLabel={copy.portfolio.diagnoseAnotherA11y}
            >
              <Ionicons name="camera" size={22} color={t.color.onPrimary} />
              <Text style={s.ctaText}>{copy.portfolio.diagnoseAnother}</Text>
            </Pressable>
          }
        />

      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container} edges={['top']} /* bottom inset belongs to the tab bar */>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <Animated.View style={[s.header, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          <Image source={APP_LOGO} style={s.logoIcon} accessibilityIgnoresInvertColors />
          <View style={s.headerText}>
            <Text style={s.logoText}>{copy.portfolio.brand}</Text>
            <Text style={s.logoSub}>
              {profileName ? copy.portfolio.helloNamed(profileName) : copy.portfolio.greetingAnonymous}
            </Text>
          </View>
          <Pressable
            onPress={() => navigation.navigate('Settings')}
            accessibilityRole="button"
            accessibilityLabel={copy.portfolio.settingsA11y}
            style={s.settingsBtn}
            hitSlop={8}
          >
            <Ionicons name="settings-outline" size={22} color={t.color.textSecondary} />
          </Pressable>
        </Animated.View>

        {/* Hero */}
        <Animated.View style={[s.heroCard, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          <View style={s.heroIcon}>
            <Ionicons name="medkit-outline" size={36} color={t.color.primary} />
          </View>
          <Text style={s.heroTitle}>{copy.portfolio.heroTitle}</Text>
          <Text style={s.heroSub}>{copy.portfolio.heroSub}</Text>
        </Animated.View>

        {/*
          Two ways in, not one. The camera keeps the accent - it is what the app
          is for, and it is the only action here that produces an answer - but a
          user whose plants are all fine had no way to start a portfolio at all
          before this, and a first run that only offers the camera teaches them
          this tab is for sick plants.
        */}
        <Animated.View style={[s.ctaWrap, { opacity: fadeAnim, transform: [{ scale: pulseAnim }] }]}>
          <Pressable
            style={({ pressed }) => [s.ctaBtn, pressed && s.ctaBtnPressed]}
            onPress={() => navigation.navigate('Camera')}
            accessibilityRole="button"
            accessibilityLabel={copy.portfolio.diagnoseMineA11y}
          >
            <Ionicons name="camera" size={22} color={t.color.onPrimary} />
            <Text style={s.ctaText}>{copy.portfolio.diagnoseMine}</Text>
          </Pressable>
        </Animated.View>

        <Animated.View style={[s.secondaryWrap, { opacity: fadeAnim }]}>
          <Pressable
            style={({ pressed }) => [s.secondaryBtn, pressed && s.secondaryBtnPressed]}
            onPress={() => navigation.navigate('AddPlant')}
            accessibilityRole="button"
            accessibilityLabel={copy.portfolio.addOwnedA11y}
          >
            <Ionicons name="add-circle-outline" size={20} color={t.color.primary} />
            <Text style={s.secondaryText}>{copy.portfolio.addOwned}</Text>
          </Pressable>
        </Animated.View>

        {/* Features */}
        <Animated.View style={[s.features, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          <Text style={s.featuresTitle}>{copy.portfolio.howItWorks}</Text>
          {FEATURES.map((f, i) => (
            <View key={f.title} style={s.featureCard}>
              <View style={s.featureIconWrap}>
                <Ionicons name={f.icon} size={22} color={t.color.primary} />
              </View>
              <View style={s.featureText}>
                <Text style={s.featureTitle}>{f.title}</Text>
                <Text style={s.featureDesc}>{f.desc}</Text>
              </View>
              <View style={s.featureStep}>
                <Text style={s.featureStepText}>{i + 1}</Text>
              </View>
            </View>
          ))}
        </Animated.View>

        <Animated.View style={{ opacity: fadeAnim }}>
          <Text style={s.bottomNote}>{copy.portfolio.bottomNote}</Text>
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: t.color.background },
    scroll: { paddingBottom: t.space['2xl'] + TAB_BAR_CLEARANCE, paddingHorizontal: t.space.xl },

    // ── Returning-user library layout ──────────────────────────────────────
    // The extra bottom padding clears the floating Add plant button, so the
    // last card is scrollable out from under it rather than trapped beneath.
    libScroll: { paddingBottom: t.space['3xl'] + TAB_BAR_CLEARANCE, paddingHorizontal: t.space.xl },
    libHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: t.space.sm,
      paddingTop: t.space.lg,
      paddingBottom: t.space.lg,
    },
    libHeaderText: { flex: 1, marginEnd: t.space.sm },
    libEyebrow: { ...t.type.eyebrow, color: t.color.textMuted, writingDirection: 'auto' },
    libHeaderTitle: { ...t.type.display, color: t.color.foreground, marginTop: t.space.xs, writingDirection: 'auto' },
    libHeaderCount: { ...t.type.caption, color: t.color.textSecondary, marginTop: 2, writingDirection: 'auto' },
    iconBtn: {
      width: 40,
      height: 40,
      borderRadius: t.radius.pill,
      backgroundColor: t.color.surface,
      alignItems: 'center',
      justifyContent: 'center',
      ...t.elevation.card,
    },
    addBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space.xs,
      backgroundColor: t.color.primary,
      borderRadius: t.radius.pill,
      paddingHorizontal: t.space.lg,
      height: 40,
      ...t.elevation.card,
    },
    addBtnPressed: { opacity: 0.85 },
    addBtnText: { ...t.type.label, color: t.color.onPrimary },
    // Sections carry the grouping, so headers stay quiet - the condition
    // colour on each card is what should draw the eye.
    sectionHeader: {
      ...t.type.caption,
      color: t.color.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginTop: t.space.md,
      marginBottom: t.space.sm,
    },
    libCta: { marginTop: t.space.xl },
    bulkRow: { flexDirection: 'row', gap: t.space.md, marginTop: t.space.lg },
    bulkBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: t.space.sm,
      minHeight: 44,
      paddingHorizontal: t.space.md,
      borderRadius: t.radius.pill,
      borderWidth: 1,
      borderColor: t.color.border,
      backgroundColor: t.color.surface,
    },
    bulkBtnPressed: { opacity: 0.7 },
    bulkBtnText: { ...t.type.bodyStrong, color: t.color.foreground, flexShrink: 1 },
    bulkProgress: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space.md,
      marginTop: t.space.md,
      padding: t.space.md,
      borderRadius: t.radius.lg,
      backgroundColor: t.color.surfaceMuted,
    },
    bulkProgressText: { flex: 1, gap: 2 },
    bulkProgressTitle: { ...t.type.bodyStrong, color: t.color.foreground, writingDirection: 'auto' },
    bulkProgressSub: { ...t.type.caption, color: t.color.textSecondary, writingDirection: 'auto' },
    bulkProgressAction: { ...t.type.bodyStrong, color: t.color.primary },

    // The row scrolls rather than wraps: three chips fit on a phone, but the
    // Hebrew labels are longer and a wrapped second line pushes the first card
    // off the screen for a control the user has already read.
    chipRow: { flexDirection: 'row', gap: t.space.sm, paddingBottom: t.space.md },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: t.space.lg,
      borderRadius: t.radius.pill,
      backgroundColor: t.color.surface,
      minHeight: 40,
      ...t.elevation.card,
    },
    // Filled, not tinted: the selected chip is the one thing on this row that
    // has to be readable at a glance, and a wash reads as another unselected
    // chip in a slightly different colour.
    chipActive: { backgroundColor: t.color.primary },
    chipPressed: { opacity: 0.7 },
    chipDot: { width: 7, height: 7, borderRadius: 4 },
    chipText: { ...t.type.label, color: t.color.foreground },
    chipTextActive: { color: t.color.onPrimary },
    emptyFilter: {
      ...t.type.body,
      color: t.color.textSecondary,
      marginTop: t.space.md,
      marginBottom: t.space.sm,
    },

    dueCard: {
      backgroundColor: t.color.surface,
      borderRadius: t.radius.lg,
      borderWidth: 1,
      borderColor: t.color.border,
      paddingHorizontal: t.space.md,
      paddingVertical: t.space.sm,
      marginTop: t.space.md,
      ...t.elevation.card,
    },
    dueTitle: {
      ...t.type.caption,
      color: t.color.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginTop: t.space.xs,
      marginBottom: t.space.xs,
    },
    dueRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space.sm,
      minHeight: 44, // H6 minimum target
    },
    dueRowPressed: { opacity: 0.6 },
    dueIcon: {
      width: 26,
      height: 26,
      borderRadius: t.radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // Name takes the slack so the state label always sits on the trailing edge,
    // in either writing direction - `textAlign: 'right'` would pin it to the
    // wrong side of a mirrored row.
    dueName: { ...t.type.label, color: t.color.foreground, flex: 1, writingDirection: 'auto' },
    dueLabel: { ...t.type.caption, flexShrink: 0, writingDirection: 'auto' },
    dueMore: { ...t.type.caption, color: t.color.textMuted, marginTop: t.space.xs, marginBottom: t.space.xs },


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
    header: { flexDirection: 'row', alignItems: 'center', gap: t.space.md, paddingTop: t.space.lg, paddingBottom: t.space.sm },
    /*
     * The logo carries its own teal ground, so this is a clipping frame, not a
     * tile: a `backgroundColor` behind it would only show as a rim if the art
     * were ever swapped for something with transparent edges.
     */
    logoIcon: {
      width: 44,
      height: 44,
      borderRadius: t.radius.md,
      overflow: 'hidden',
    },
    logoText: { ...t.type.title, color: t.color.foreground },
    logoSub: { ...t.type.caption, color: t.color.secondary, writingDirection: 'auto' },
    headerText: { flex: 1 },
    settingsBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },

    heroCard: {
      marginTop: t.space.xl,
      marginBottom: t.space.xl,
      backgroundColor: t.color.surface,
      borderRadius: t.radius['2xl'],
      padding: t.space.xl,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: t.color.border,
      ...t.elevation.card,
    },
    heroIcon: {
      width: 72,
      height: 72,
      borderRadius: t.radius.pill,
      backgroundColor: t.color.surfaceMuted,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: t.space.lg,
    },
    heroTitle: { ...t.type.display, color: t.color.foreground, textAlign: 'center', marginBottom: t.space.md },
    heroSub: { ...t.type.body, color: t.color.textSecondary, textAlign: 'center' },

    ctaWrap: { marginBottom: t.space.md },
    ctaBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: t.space.sm,
      backgroundColor: t.color.primary,
      borderRadius: t.radius.xl,
      paddingVertical: t.space.lg,
      minHeight: 52,
      ...t.elevation.raised,
    },
    ctaBtnPressed: { backgroundColor: t.color.primaryPressed, transform: [{ scale: 0.98 }] },
    ctaText: { ...t.type.heading, color: t.color.onPrimary },

    secondaryWrap: { marginBottom: t.space['2xl'] },
    secondaryBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: t.space.sm,
      borderRadius: t.radius.xl,
      borderWidth: 1,
      borderColor: t.color.border,
      backgroundColor: t.color.surface,
      paddingVertical: t.space.md,
      minHeight: 48,
    },
    secondaryBtnPressed: { backgroundColor: t.color.surfaceMuted },
    secondaryText: { ...t.type.bodyStrong, color: t.color.primary },

    features: { marginBottom: t.space.sm },
    featuresTitle: { ...t.type.heading, color: t.color.foreground, marginBottom: t.space.lg },
    featureCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space.md,
      backgroundColor: t.color.surface,
      borderRadius: t.radius.lg,
      padding: t.space.lg,
      marginBottom: t.space.md,
      borderWidth: 1,
      borderColor: t.color.border,
      ...t.elevation.card,
    },
    featureIconWrap: {
      width: 44,
      height: 44,
      borderRadius: t.radius.md,
      backgroundColor: t.color.surfaceMuted,
      alignItems: 'center',
      justifyContent: 'center',
    },
    featureText: { flex: 1 },
    featureTitle: { ...t.type.bodyStrong, color: t.color.foreground, marginBottom: 2 },
    featureDesc: { ...t.type.label, color: t.color.textSecondary, fontWeight: '400' },
    featureStep: {
      width: 28,
      height: 28,
      borderRadius: t.radius.pill,
      backgroundColor: t.color.surfaceMuted,
      alignItems: 'center',
      justifyContent: 'center',
    },
    featureStepText: { ...t.type.caption, color: t.color.primary, fontWeight: '700' },

    bottomNote: { ...t.type.caption, color: t.color.textMuted, textAlign: 'center', marginTop: t.space.lg },
  });
}
