import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Image, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { RootStackParamList } from '../types';
import { Theme, useTheme } from '../theme';
import { directionalIconStyle } from '../lib/rtl';
import { LOGO_GLYPH } from '../brand';
import { plantLibrary } from '../services/plantLibrary';
import { plantPhotos } from '../services/photos';
import { wateringState } from '../lib/watering';
import { CARE_KINDS, plantCarePlan, soilPlanFor } from '../lib/care';
import type { GenusCarePlan } from '../lib/genusCarePlan';
import type { SoilMediumId } from '../lib/soilMedia';
import { plantDisplayName, plantSecondaryName } from '../lib/portfolio';
import { genusCarePlans } from '../services/genusCarePlans';
import { careHistory, type CareKind } from '../services/plantStore';
import { useNurserySearch } from '../hooks/useNurserySearch';
import { cancelWateringReminder, scheduleWateringReminder } from '../services/wateringReminder';
import ScheduleCard from '../components/ScheduleCard';
import CarePlanCard from '../components/CarePlanCard';
import SoilCard from '../components/SoilCard';

/*
 * A saved plant, read back from the library.
 *
 * Deliberately a re-read by id rather than a plant passed through navigation
 * params: params are a snapshot, and a plant deleted or changed elsewhere
 * would still render here from stale data.
 */

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'PlantDetail'>;
  route: RouteProp<RootStackParamList, 'PlantDetail'>;
};

/*
 * The three schedules, ordered by how often each comes round: weekly, monthly,
 * every other year. That puts the card the user almost certainly opened this
 * screen for at the top, and it degrades gently - a plant with no schedule at
 * all still reads top to bottom in a sensible order.
 *
 * SORTED out of CARE_KINDS rather than relisted. A hand-written list here would
 * silently drop a fourth kind added to lib/care.ts: the screen would keep
 * compiling and the new schedule would simply never appear. Anything unranked
 * lands at the end instead, which is visible.
 */
const SCHEDULE_RANK: Partial<Record<CareKind, number>> = { water: 0, fertilizer: 1, repot: 2 };
const SCHEDULES = [...CARE_KINDS].sort(
  (a, b) => (SCHEDULE_RANK[a] ?? 99) - (SCHEDULE_RANK[b] ?? 99)
);

const CONDITION_COLOR: Record<string, keyof Theme['color']> = {
  healthy: 'conditionHealthy',
  mild: 'conditionMild',
  moderate: 'conditionModerate',
  severe: 'conditionSevere',
  critical: 'conditionCritical',
};

export default function PlantDetailScreen({ navigation, route }: Props) {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
  const { plantId } = route.params;

  const [plant, setPlant] = useState(() =>
    plantLibrary.load().plants.find((p) => p.id === plantId) ?? null
  );
  const [watering, setWatering] = useState(false);
  const { busy: searching, search: findNurseries } = useNurserySearch();

  /*
   * The genus this plant's care advice is keyed on.
   *
   * The species record wins over the diagnosis because it is the user pointing
   * at a catalog entry rather than a model guessing from a photo, and the
   * whole cache is keyed on the genus - getting it from the weaker source
   * would fetch and cache advice for a plant this may not be.
   *
   * Read before the missing-plant return below, and so optional-chained: hooks
   * cannot live behind an early return, and a deleted plant still has to run
   * them in the same order.
   */
  const genus = plant?.species?.genus ?? plant?.diagnosis?.genus;
  /*
   * A hint, not a key. Only the catalog knows the family; a scanned plant has
   * no species record and there is nothing honest to put here, so it goes as
   * an empty string rather than as a family inferred from the genus. The
   * server treats it as optional prompt context and the cache is keyed on the
   * genus alone, so an empty family costs nothing but a slightly thinner
   * prompt.
   */
  const family = plant?.species?.family ?? '';

  /*
   * READ THE CACHE DURING RENDER, not in an effect.
   *
   * `peek` is synchronous and never touches the network, and that is the whole
   * reason it exists: a plant in LECA whose plan is already cached paints the
   * LECA schedule on its FIRST frame. Reading it in an effect instead would
   * paint the potting-mix fallback, then swap every interval and every line of
   * advice on the next frame - and the user cannot tell a correction from a
   * bug, so they would stop trusting whichever number they saw second.
   */
  const [genusPlan, setGenusPlan] = useState<GenusCarePlan | null>(() =>
    genus ? genusCarePlans.peek(genus) : null
  );

  /*
   * The miss, filled in behind the screen. `get` returns the cached plan
   * without a call when there is one, but this effect does not even ask in
   * that case: `genusPlan` is already the answer, and re-entering on every
   * render would be a wasted round through the dedupe map.
   *
   * `alive` guards the resolve, not the fetch. The call is deduped process-
   * wide and its result is cached, so a user who backs out mid-flight has
   * still paid for a plan worth keeping - what must not happen is setting
   * state on an unmounted screen. A null result is a failed fetch, and it is
   * left as a miss on purpose: nothing is stored, so the next visit retries,
   * and in the meantime the medium multipliers in soilMedia.ts still schedule
   * the plant.
   */
  useEffect(() => {
    if (!genus || genusPlan) return;
    let alive = true;
    genusCarePlans.get(genus, family).then((plan) => {
      if (alive && plan) setGenusPlan(plan);
    });
    return () => {
      alive = false;
    };
  }, [genus, family, genusPlan]);

  /*
   * The plant is gone. Reachable if it was removed in another tab of the
   * navigation stack. Say so plainly instead of rendering an empty shell.
   */
  if (!plant) {
    return (
      <SafeAreaView style={s.container} edges={['top', 'bottom']}>
        <View style={s.missing}>
          <Image source={LOGO_GLYPH} style={[s.emptyGlyph, { tintColor: t.color.textMuted }]} />
          <Text style={s.missingTitle}>This plant is no longer saved</Text>
          <Pressable style={s.backLink} onPress={() => navigation.goBack()} accessibilityRole="button">
            <Text style={s.backLinkText}>Back to my plants</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  /*
   * OPTIONAL since library v2: a plant added by hand from the Portfolio tab was
   * never diagnosed. Everything below optional-chains through it, and the
   * blocks that only make sense for a scanned plant - issues, treatments, the
   * condition badge - simply do not render. A fuller Portfolio-aware detail
   * screen is a later task; this keeps the scanned path exactly as it was.
   */
  const { diagnosis } = plant;
  /* One naming rule for the whole app, in lib/portfolio.ts: nickname, then the
   * species the user picked, then the model's guess. Duplicating that ordering
   * here is how the card and the detail screen come to call the same plant two
   * different things. */
  const plantName = plantDisplayName(plant);
  const secondaryName = plantSecondaryName(plant);
  const color = t.color[CONDITION_COLOR[diagnosis?.condition ?? 'healthy'] ?? 'conditionModerate'];

  /*
   * The two derived facts every schedule below is built from.
   *
   * `soilPlan` is the genus plan's entry for the medium this plant is actually
   * in, and `carePlan` is the watering plan resolved against it - the genus
   * plan's real interval when there is one, the diagnosis interval bent by the
   * medium's multiplier when there is not, and `undefined` when there is
   * neither. Both go through lib/care.ts rather than being assembled here, so
   * this screen, the Portfolio strip and the Home badge cannot answer "when is
   * this due" three different ways.
   */
  const soilPlan = soilPlanFor(genusPlan, plant.soilMedium);
  const carePlan = plantCarePlan(diagnosis?.carePlan, genusPlan, plant.soilMedium);

  /*
   * Changing the growing medium. Local and instant on purpose: every plan for
   * every medium was fetched in one call when the genus was first seen, so a
   * tap at the sink reschedules the plant on the same frame with no network
   * and works offline. The write can still fail on a full disk, and that has
   * to be said - silently keeping the old medium while the picker shows the
   * new one is the worst of both.
   */
  const handleSoil = (next: SoilMediumId) => {
    const stored = plantLibrary.update(plant.id, { soilMedium: next });
    if (!stored.ok) {
      Alert.alert(
        "Couldn't save that",
        stored.reason === 'not_found'
          ? 'This plant is no longer saved.'
          : 'Your device is out of storage space, so the growing medium was not saved.'
      );
      return;
    }
    setPlant(stored.plant);
  };

  /*
   * Repot and feed. Simpler than handleWater on purpose: neither schedules a
   * reminder, so there is no OS handle to cancel and no ordering constraint -
   * storage is the whole operation.
   */
  const handleCare = (kind: CareKind) => {
    const logged = plantLibrary.markCare(plant.id, kind, Date.now());
    if (!logged.ok) {
      Alert.alert(
        "Couldn't record that",
        logged.reason === 'not_found'
          ? 'This plant is no longer saved.'
          : 'Your device is out of storage space, so nothing was saved.'
      );
      return;
    }
    setPlant(logged.plant);
  };

  /*
   * Log a watering.
   *
   * The order matters and is the opposite of the obvious one: the record is
   * written FIRST and the notification scheduled after. Storage is the source of
   * truth for the schedule, so a reminder scheduled against a watering that
   * failed to persist would fire for a date the app does not believe in. The
   * reverse - a stored watering with no notification - is the degraded state
   * this whole feature is designed to survive, since the detail screen and the
   * library badge both read from storage, not from the OS.
   */
  const handleWater = async () => {
    if (watering) return;
    setWatering(true);
    try {
      // Cancel before rescheduling: the pending reminder points at a due date
      // this watering is about to move.
      await cancelWateringReminder(plant.reminderId);

      const at = Date.now();
      const logged = plantLibrary.markWatered(plant.id, at);
      if (!logged.ok) {
        Alert.alert(
          "Couldn't record that",
          logged.reason === 'not_found'
            ? 'This plant is no longer saved.'
            : 'Your device is out of storage space, so the watering was not saved.'
        );
        return;
      }
      setPlant(logged.plant);

      // The RESOLVED plan, not the diagnosis's: the reminder has to fire on the
      // same date the card counts down to, and for a plant in LECA those are
      // different numbers.
      const next = wateringState(carePlan, logged.plant.lastWateredAt, at);
      if (next.nextDueAt === null) return;

      // Null means no permission, or a runtime that cannot schedule. Both are
      // normal: the in-app countdown above is unaffected, so there is nothing
      // to tell the user about.
      const reminderId = await scheduleWateringReminder({
        // The DISPLAY name on purpose, nickname and all: this is a notification
        // the user reads, and "Steve needs water" is better than the species.
        // Contrast the nursery search below, which is a query and must not.
        plantName,
        dueAt: next.nextDueAt,
        now: at,
      });
      if (!reminderId) return;

      const stored = plantLibrary.update(plant.id, { reminderId });
      if (stored.ok) setPlant(stored.plant);
    } finally {
      setWatering(false);
    }
  };

  const confirmRemove = () => {
    Alert.alert('Remove this plant?', `${plantName} will be removed from your plants.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          const result = plantLibrary.remove(plant.id);
          if (!result.ok) {
            Alert.alert("Couldn't remove", 'Your device is out of storage space.');
            return;
          }
          // The record is gone, so its photo is unreachable - leaving the file
          // behind would grow the document directory forever. Deleted after
          // the write, never before: a failed removal must not cost the user a
          // picture of a plant that is still in their library.
          plantPhotos.discard(plant.id);
          navigation.goBack();
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={s.container} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <View style={s.header}>
          <Pressable
            style={s.backBtn}
            onPress={() => navigation.goBack()}
            accessibilityRole="button"
            accessibilityLabel="Back to my plants"
          >
            <Ionicons name="chevron-back" size={22} color={t.color.primary} style={directionalIconStyle} />
            <Text style={s.backText}>My Plants</Text>
          </Pressable>
          <Pressable
            style={s.removeBtn}
            onPress={confirmRemove}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${plantName} from my plants`}
            hitSlop={8}
          >
            <Ionicons name="trash-outline" size={20} color={t.color.danger} />
          </Pressable>
        </View>

        {/* Same caveat as the card: a photo that never finished copying out of
            the cache may be gone, so the mark sits underneath. */}
        <View style={s.imageWrap}>
          <Image source={LOGO_GLYPH} style={[s.heroGlyph, { tintColor: t.color.textMuted }]} />
          <Image source={{ uri: plant.photoUri }} style={s.image} />
        </View>

        {/* No diagnosis, no badge. An empty coloured pill would read as a
            condition the app failed to load rather than as one it was never
            asked for. */}
        {!!diagnosis?.conditionLabel && (
          <View style={[s.badge, { backgroundColor: color }]}>
            <Text style={s.badgeText}>{diagnosis.conditionLabel}</Text>
          </View>
        )}

        <Text style={s.name}>{plantName}</Text>
        {/* `plantSecondaryName` returns '' rather than a repeat when the
            botanical name is already the title - a card showing "Monstera
            deliciosa" twice, stacked, looks broken rather than thorough. */}
        {!!secondaryName && <Text style={s.sciName}>{secondaryName}</Text>}
        {!!diagnosis?.variety && <Text style={s.sciName}>{diagnosis.variety}</Text>}
        {!!diagnosis?.description && <Text style={s.desc}>{diagnosis.description}</Text>}

        {/*
          A hand-added plant. Said out loud rather than left as an absence: the
          blocks above (badge, issues, treatments) simply do not render for it,
          and a screen that is quietly missing three sections reads as one that
          failed to load. It is also the only place the camera is offered for a
          plant already in the library, which is exactly when someone notices a
          leaf going wrong on a plant they added by hand.
        */}
        {!diagnosis && (
          <View style={s.undiagnosed}>
            <Ionicons name="scan-outline" size={18} color={t.color.textSecondary} />
            <Text style={s.undiagnosedText}>You have not had this plant checked yet.</Text>
            <Pressable
              style={({ pressed }) => [s.undiagnosedBtn, pressed && { opacity: 0.7 }]}
              onPress={() => navigation.navigate('Camera')}
              accessibilityRole="button"
              accessibilityLabel={`Check ${plantName} with the camera`}
              hitSlop={6}
            >
              <Text style={s.undiagnosedBtnText}>Check it</Text>
            </Pressable>
          </View>
        )}

        {!!diagnosis && diagnosis.issues.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Issues detected</Text>
            {diagnosis.issues.map((issue, i) => (
              <View key={i} style={s.issueRow}>
                <View style={[s.issueDot, { backgroundColor: color }]} />
                <Text style={s.issueText}>{issue}</Text>
              </View>
            ))}
          </View>
        )}

        {!!diagnosis && diagnosis.treatments.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Treatment plan</Text>
            {diagnosis.treatments.map((tr, i) => (
              <View key={i} style={s.treatmentCard}>
                {tr.urgent && (
                  <View style={s.urgentPill}>
                    <Text style={s.urgentText}>URGENT</Text>
                  </View>
                )}
                <Text style={s.treatmentTitle}>{tr.title}</Text>
                <Text style={s.treatmentDesc}>{tr.description}</Text>
              </View>
            ))}
          </View>
        )}

        {/*
          THE MEDIUM FIRST, then the schedules, because that is the direction
          the data flows: every interval below is derived from what this plant
          is potted in, so the control that changes them all has to sit above
          them where the change is visible. Instant and offline - all eight
          media were fetched in the one call that cached this genus.
        */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Care schedule</Text>
          <SoilCard value={plant.soilMedium} onChange={handleSoil} />

          {/*
            One card per kind, from one component. Water, feed and repot are the
            same question with different intervals, and the previous layout -
            a hand-built watering card plus a loop over two thin care-log rows -
            is what let watering grow a history link, an interval line and a
            long-press while feeding and repotting got none of it.
          */}
          {SCHEDULES.map((kind) => (
            <ScheduleCard
              key={kind}
              kind={kind}
              carePlan={carePlan}
              soilPlan={soilPlan}
              /* `careHistory` rather than `lastWateredAt` and friends: it folds
                 the legacy single-date fields back into the log, so a plant
                 watered before the log existed still shows its last date. */
              lastAt={careHistory(plant, kind)[0]}
              /* Only watering talks to the OS, so only watering can hang. */
              busy={kind === 'water' && watering}
              onLog={kind === 'water' ? handleWater : () => handleCare(kind)}
              onHistory={() => navigation.navigate('WateringHistory', { plantId: plant.id, kind })}
            />
          ))}
        </View>

        {/*
          The standing advice, which knows whose advice it is - the genus plan
          for THIS medium when one is cached, the diagnosis's own plan when not.
          Renders nothing at all when there is neither.
        */}
        <CarePlanCard
          soilPlan={soilPlan}
          fallback={diagnosis?.carePlan}
          medium={plant.soilMedium}
          genus={genus}
        />

        {/*
          Buy another one. Until now the nursery search was reachable only from
          a fresh diagnosis, so a plant you already owned - the exact thing you
          are most likely to want a second of - had no way to reach it.
        */}
        <Pressable
          style={({ pressed }) => [s.findBtn, pressed && { opacity: 0.7 }]}
          /*
           * The SPECIES, never the nickname. Everything else on this screen
           * shows the display name, but this one is a query into a paid scrape:
           * a user who called their monstera "Steve" would otherwise send
           * nurseries looking for "Steve". Falls back to the display name only
           * when there is nothing else to search for.
           */
          onPress={() =>
            findNurseries(plant.species?.name ?? plant.diagnosis?.plantName ?? plantName, 'delivery')
          }
          disabled={searching}
          accessibilityRole="button"
          accessibilityState={{ disabled: searching }}
          accessibilityLabel={`Find nurseries selling ${plantName}`}
        >
          <Ionicons name="storefront-outline" size={18} color={t.color.primary} />
          <Text style={s.findBtnText}>
            {searching ? 'Finding nurseries...' : 'Find this plant at a nursery'}
          </Text>
        </Pressable>

        <Text style={s.savedAt}>Saved {new Date(plant.savedAt).toLocaleDateString()}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: t.color.background },
    scroll: { paddingHorizontal: t.space.xl, paddingBottom: t.space['2xl'] },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: t.space.md,
    },
    backBtn: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
    backText: { ...t.type.label, color: t.color.primary },
    removeBtn: { minWidth: 44, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center' },

    imageWrap: {
      height: 240,
      borderRadius: t.radius.xl,
      backgroundColor: t.color.surfaceMuted,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      ...t.elevation.card,
    },
    // Both marks are drawn inside the adaptive-icon safe zone, so they run
    // larger than the 40pt icons they replaced to land at the same visual size.
    heroGlyph: { width: 96, height: 96, resizeMode: 'contain' as const },
    emptyGlyph: { width: 72, height: 72, resizeMode: 'contain' as const },
    image: { position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0 },

    badge: {
      alignSelf: 'flex-start',
      borderRadius: t.radius.pill,
      paddingHorizontal: t.space.md,
      paddingVertical: 6,
      marginTop: t.space.lg,
    },
    badgeText: { ...t.type.caption, color: '#FFFFFF' },

    name: { ...t.type.display, color: t.color.foreground, marginTop: t.space.sm, writingDirection: 'auto' },
    sciName: { ...t.type.body, color: t.color.textMuted, fontStyle: 'italic', marginTop: 2, writingDirection: 'auto' },
    desc: { ...t.type.body, color: t.color.textSecondary, marginTop: t.space.md },

    section: { marginTop: t.space.xl },
    sectionTitle: { ...t.type.heading, color: t.color.foreground, marginBottom: t.space.sm },

    /*
     * The one row that says something is MISSING, so it is drawn as a hint
     * rather than as an alert: a dashed outline and muted text. A filled
     * warning card here would tell a user their perfectly healthy hand-added
     * plant has a problem, when all it has is a diagnosis they never asked for.
     */
    undiagnosed: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space.sm,
      marginTop: t.space.lg,
      padding: t.space.md,
      borderRadius: t.radius.lg,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: t.color.border,
      backgroundColor: t.color.surfaceMuted,
    },
    undiagnosedText: { ...t.type.caption, color: t.color.textSecondary, flex: 1 },
    undiagnosedBtn: {
      paddingHorizontal: t.space.md,
      paddingVertical: t.space.sm,
      borderRadius: t.radius.pill,
      backgroundColor: t.color.surface,
      minHeight: 36,
      justifyContent: 'center',
    },
    undiagnosedBtnText: { ...t.type.label, color: t.color.primary },

    findBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: t.space.sm,
      marginTop: t.space.xl,
      paddingVertical: t.space.md,
      borderRadius: t.radius.pill,
      borderWidth: 1,
      borderColor: t.color.border,
      backgroundColor: t.color.surface,
    },
    findBtnText: { ...t.type.bodyStrong, color: t.color.primary },

    issueRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: t.space.sm },
    issueDot: { width: 8, height: 8, borderRadius: 4, marginTop: 8, marginEnd: t.space.sm },
    issueText: { ...t.type.body, color: t.color.textSecondary, flex: 1, writingDirection: 'auto' },

    treatmentCard: {
      backgroundColor: t.color.surface,
      borderRadius: t.radius.lg,
      padding: t.space.md,
      marginBottom: t.space.sm,
      ...t.elevation.card,
    },
    urgentPill: {
      alignSelf: 'flex-start',
      backgroundColor: t.color.danger,
      borderRadius: t.radius.sm,
      paddingHorizontal: 8,
      paddingVertical: 2,
      marginBottom: 6,
    },
    urgentText: { ...t.type.caption, color: t.color.onDanger, fontSize: 10 },
    treatmentTitle: { ...t.type.bodyStrong, color: t.color.foreground, writingDirection: 'auto' },
    treatmentDesc: { ...t.type.body, color: t.color.textSecondary, marginTop: 2, writingDirection: 'auto' },

    savedAt: { ...t.type.caption, color: t.color.textMuted, marginTop: t.space.xl, textAlign: 'center' },

    missing: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: t.space.xl },
    missingTitle: { ...t.type.heading, color: t.color.foreground, marginTop: t.space.md, textAlign: 'center' },
    backLink: { marginTop: t.space.lg, minHeight: 44, justifyContent: 'center' },
    backLinkText: { ...t.type.label, color: t.color.primary },
  });
