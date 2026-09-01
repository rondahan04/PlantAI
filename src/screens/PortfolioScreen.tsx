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
  offersGuestImport,
  plantDisplayName,
  showsLibraryLayout,
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
import PlantCard from '../components/PlantCard';
import ImportBanner from '../components/ImportBanner';

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

  const visible = useMemo(() => filterPortfolio(library.plants, filter), [library, filter]);

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
        ? triageSections(visible)
        : /* One untitled section, so SectionList renders a flat list without a
           * second code path for it. `TriageKey` is deliberately not widened to
           * hold a 'diagnosed' bucket - this is a rendering shape, not a triage
           * bucket, and triage.ts should not learn about the filter. */
          [{ key: 'diagnosed', title: '', data: visible }],
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
    return dueSoon(library.plants, Date.now(), (plant: StoredPlant) => {
      const genus = plant.species?.genus ?? plant.diagnosis?.genus;
      return genus ? genusCarePlans.peek(genus) : null;
    });
    // `library` is the input; the clock is read once per library read on
    // purpose - re-running this on a timer would reshuffle the strip under a
    // user mid-scroll for a day boundary they cannot see.
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

  const renderChip = (value: PortfolioFilter, label: string) => {
    const active = filter === value;
    return (
      <Pressable
        key={value}
        onPress={() => setFilter(value)}
        style={({ pressed }) => [s.chip, active && s.chipActive, pressed && s.chipPressed]}
        accessibilityRole="button"
        // Selected state announced rather than left to colour alone (a11y).
        accessibilityState={{ selected: active }}
        accessibilityLabel={
          value === 'all' ? 'Show all plants' : 'Show only plants you have diagnosed'
        }
      >
        <Text style={[s.chipText, active && s.chipTextActive]}>{label}</Text>
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
              <View style={s.header}>
                <Image source={APP_LOGO} style={s.logoIcon} accessibilityIgnoresInvertColors />
                <View style={s.headerText}>
                  <Text style={s.logoText}>PlantAI</Text>
                  <Text style={s.logoSub}>
                    {profileName ? `${profileName}'s plants` : 'Plant Doctor'}
                  </Text>
                </View>
                <Pressable
                  onPress={() => navigation.navigate('Settings')}
                  accessibilityRole="button"
                  accessibilityLabel="Account settings"
                  style={s.settingsBtn}
                  hitSlop={8}
                >
                  <Ionicons name="settings-outline" size={22} color={t.color.textSecondary} />
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
                        ? 'Saved by a newer version'
                        : "Some saved plants couldn't be read"}
                    </Text>
                    <Text style={s.warnText}>
                      {library.reason === 'future_version'
                        ? 'Update PlantAI to see this library again. Nothing has been deleted.'
                        : 'Your data has been set aside, not deleted. New plants save normally.'}
                    </Text>
                  </View>
                </View>
              )}

              {due.length > 0 && (
                <View style={s.dueCard}>
                  <Text style={s.dueTitle}>Due this week</Text>
                  {due.slice(0, DUE_ROW_CAP).map(renderDueRow)}
                  {due.length > DUE_ROW_CAP && (
                    <Text style={s.dueMore}>
                      +{due.length - DUE_ROW_CAP} more in your plants below
                    </Text>
                  )}
                </View>
              )}

              <Text style={s.libTitle}>Portfolio</Text>

              <View style={s.chipRow}>
                {renderChip('all', 'All')}
                {renderChip('diagnosed', 'Diagnosed')}
              </View>

              {/*
                A filter that matches nothing is not an empty library, and the
                copy has to say so - otherwise the Diagnosed chip on a
                hand-built portfolio reads as data loss.
              */}
              {visible.length === 0 && filter === 'diagnosed' && (
                <Text style={s.emptyFilter}>
                  None of your plants have been diagnosed yet. Scan one to see what it needs.
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
              onPress={() => navigation.navigate('PlantDetail', { plantId: item.id })}
            />
          )}
          ListFooterComponent={
            <Pressable
              style={({ pressed }) => [s.ctaBtn, s.libCta, pressed && s.ctaBtnPressed]}
              onPress={() => navigation.navigate('Camera')}
              accessibilityRole="button"
              accessibilityLabel="Diagnose another plant - open the camera"
            >
              <Ionicons name="camera" size={22} color={t.color.onPrimary} />
              <Text style={s.ctaText}>Diagnose Another Plant</Text>
            </Pressable>
          }
        />

        {/*
          The second way in, floating rather than in the footer: adding a plant
          you already own has to be reachable from anywhere in a long list, and
          it is the one action on this tab that the camera CTA cannot cover.
          Secondary styling on purpose - diagnosing is still the app's job, and
          two filled accent buttons would leave neither one primary.
        */}
        <Pressable
          style={({ pressed }) => [s.fab, pressed && s.fabPressed]}
          onPress={() => navigation.navigate('AddPlant')}
          accessibilityRole="button"
          accessibilityLabel="Add a plant you already own"
        >
          <Ionicons name="add" size={20} color={t.color.onPrimary} />
          <Text style={s.fabText}>Add plant</Text>
        </Pressable>
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
            <Text style={s.logoText}>PlantAI</Text>
            <Text style={s.logoSub}>{profileName ? `Hello, ${profileName}` : 'Plant Doctor'}</Text>
          </View>
          <Pressable
            onPress={() => navigation.navigate('Settings')}
            accessibilityRole="button"
            accessibilityLabel="Account settings"
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
          <Text style={s.heroTitle}>Is your plant{'\n'}in trouble?</Text>
          <Text style={s.heroSub}>
            Snap a photo. Get a diagnosis in seconds.{'\n'}Find a healthy replacement if needed.
          </Text>
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
            accessibilityLabel="Diagnose my plant - open the camera"
          >
            <Ionicons name="camera" size={22} color={t.color.onPrimary} />
            <Text style={s.ctaText}>Diagnose My Plant</Text>
          </Pressable>
        </Animated.View>

        <Animated.View style={[s.secondaryWrap, { opacity: fadeAnim }]}>
          <Pressable
            style={({ pressed }) => [s.secondaryBtn, pressed && s.secondaryBtnPressed]}
            onPress={() => navigation.navigate('AddPlant')}
            accessibilityRole="button"
            accessibilityLabel="Add a plant you already own, without a photo"
          >
            <Ionicons name="add-circle-outline" size={20} color={t.color.primary} />
            <Text style={s.secondaryText}>Add a plant I already own</Text>
          </Pressable>
        </Animated.View>

        {/* Features */}
        <Animated.View style={[s.features, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          <Text style={s.featuresTitle}>How it works</Text>
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
          <Text style={s.bottomNote}>We diagnose 1000+ plant species · fast and accurate</Text>
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: t.color.background },
    scroll: { paddingBottom: t.space['2xl'], paddingHorizontal: t.space.xl },

    // ── Returning-user library layout ──────────────────────────────────────
    // The extra bottom padding clears the floating Add plant button, so the
    // last card is scrollable out from under it rather than trapped beneath.
    libScroll: { paddingBottom: t.space['3xl'] + t.space['2xl'], paddingHorizontal: t.space.xl },
    libTitle: { ...t.type.title, color: t.color.foreground, marginTop: t.space.lg, marginBottom: t.space.sm },
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

    chipRow: { flexDirection: 'row', gap: t.space.sm, marginBottom: t.space.md },
    chip: {
      paddingHorizontal: t.space.lg,
      paddingVertical: t.space.sm,
      borderRadius: t.radius.pill,
      borderWidth: 1,
      borderColor: t.color.border,
      backgroundColor: t.color.surface,
      minHeight: 36,
      justifyContent: 'center',
    },
    chipActive: { backgroundColor: t.color.primaryWash, borderColor: t.color.primary },
    chipPressed: { opacity: 0.7 },
    chipText: { ...t.type.label, color: t.color.textSecondary },
    chipTextActive: { color: t.color.primary },
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

    fab: {
      position: 'absolute',
      end: t.space.xl,
      bottom: t.space.xl,
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space.xs,
      backgroundColor: t.color.secondary,
      borderRadius: t.radius.pill,
      paddingHorizontal: t.space.lg,
      minHeight: 48,
      ...t.elevation.raised,
    },
    fabPressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
    fabText: { ...t.type.label, color: t.color.onPrimary },

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
