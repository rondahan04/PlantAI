import React, { useMemo, useState } from 'react';
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
import { intervalLabel, wateringState } from '../lib/watering';
import { careHistory, type CareKind } from '../services/plantStore';
import { cancelWateringReminder, scheduleWateringReminder } from '../services/wateringReminder';

/*
 * A saved plant, read back from the library.
 *
 * Deliberately a re-read by id rather than a plant passed through navigation
 * params: params are a snapshot, and a plant deleted or changed elsewhere
 * would still render here from stale data.
 */

/* The care LOG (things the user records), distinct from CARE_ROWS below, which
 * is the care PLAN (advice the model gave). Watering has its own card. */
const CARE_LOG_ROWS: {
  kind: CareKind;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  verb: string;
}[] = [
  { kind: 'repot', label: 'Repot / soil change', icon: 'flower-outline', verb: 'Log repot' },
  { kind: 'fertilizer', label: 'Fertilizer', icon: 'nutrition-outline', verb: 'Log feed' },
];

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'PlantDetail'>;
  route: RouteProp<RootStackParamList, 'PlantDetail'>;
};

const CONDITION_COLOR: Record<string, keyof Theme['color']> = {
  healthy: 'conditionHealthy',
  mild: 'conditionMild',
  moderate: 'conditionModerate',
  severe: 'conditionSevere',
  critical: 'conditionCritical',
};

/*
 * The care plan reads as three fixed rows in a fixed order rather than a loop
 * over whatever keys arrived: soil, then light, then water is the order a
 * person actually sets a plant up in, and a stable layout is what makes the
 * section skimmable on a plant you have opened twenty times.
 */
const CARE_ROWS: {
  key: 'soil' | 'light' | 'water';
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { key: 'soil', label: 'Soil', icon: 'layers-outline' },
  { key: 'light', label: 'Light', icon: 'sunny-outline' },
  { key: 'water', label: 'Water', icon: 'water-outline' },
];

export default function PlantDetailScreen({ navigation, route }: Props) {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
  const { plantId } = route.params;

  const [plant, setPlant] = useState(() =>
    plantLibrary.load().plants.find((p) => p.id === plantId) ?? null
  );
  const [watering, setWatering] = useState(false);

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

  const { diagnosis } = plant;
  const color = t.color[CONDITION_COLOR[diagnosis.condition] ?? 'conditionModerate'];
  const water = wateringState(diagnosis.carePlan, plant.lastWateredAt, Date.now());
  /*
   * Watered, and not due again yet - there is no watering to log. `ok` is the
   * only status that means this: `due` and `overdue` are exactly when the
   * button has to work, and `never_watered` is the tap that starts everything.
   */
  const settled = water.status === 'ok';

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

      const next = wateringState(diagnosis.carePlan, logged.plant.lastWateredAt, at);
      if (next.nextDueAt === null) return;

      // Null means no permission, or a runtime that cannot schedule. Both are
      // normal: the in-app countdown above is unaffected, so there is nothing
      // to tell the user about.
      const reminderId = await scheduleWateringReminder({
        plantName: diagnosis.plantName,
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
    Alert.alert('Remove this plant?', `${diagnosis.plantName} will be removed from your plants.`, [
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
            accessibilityLabel={`Remove ${diagnosis.plantName} from my plants`}
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

        <View style={[s.badge, { backgroundColor: color }]}>
          <Text style={s.badgeText}>{diagnosis.conditionLabel}</Text>
        </View>

        <Text style={s.name}>{diagnosis.plantName}</Text>
        {!!diagnosis.scientificName && <Text style={s.sciName}>{diagnosis.scientificName}</Text>}
        {!!diagnosis.variety && <Text style={s.sciName}>{diagnosis.variety}</Text>}
        {!!diagnosis.description && <Text style={s.desc}>{diagnosis.description}</Text>}

        {diagnosis.issues.length > 0 && (
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

        {diagnosis.treatments.length > 0 && (
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
          Absent for every plant saved before this field existed, and for any
          diagnosis where the model's care plan failed validation server-side.
          Nothing is rendered in that case - a "Care plan" heading over three
          empty rows would read as a broken screen rather than as missing data.
        */}
        {!!diagnosis.carePlan && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Care plan</Text>
            <Text style={s.sectionNote}>How to keep this plant well, once it is.</Text>
            {CARE_ROWS.map(({ key, label, icon }) => (
              <View
                key={key}
                style={s.careCard}
                // One node per row: a screen reader should say "Light: bright
                // indirect", not read the icon and the label as separate stops.
                accessible
                accessibilityLabel={`${label}: ${diagnosis.carePlan![key]}`}
              >
                {/*
                  The water row is tinted blue so the eye connects it to the
                  schedule card directly beneath - they are one idea split over
                  two blocks, and the colour is what says so.
                */}
                <View style={[s.careIconWrap, key === 'water' && { backgroundColor: t.color.waterWash }]}>
                  <Ionicons name={icon} size={20} color={key === 'water' ? t.color.water : t.color.primary} />
                </View>
                <View style={s.careBody}>
                  <Text style={s.logLabel}>{label}</Text>
                  <Text style={s.careText}>{diagnosis.carePlan![key]}</Text>
                </View>
              </View>
            ))}

            {/*
              The schedule hangs off the water row rather than sitting in its
              own section: "every 7-10 days" and "next water in 3 days" are the
              same fact in two tenses, and splitting them makes the user read
              the interval twice. Absent entirely when the diagnosis carried no
              number - a tap that promises a reminder the app cannot schedule is
              worse than no button.
            */}
            {water.status !== 'unscheduled' && (
              <View style={s.scheduleCard}>
                <View style={s.scheduleRow}>
                  <View style={s.scheduleHeading}>
                    <Ionicons name="calendar-outline" size={14} color={t.color.water} />
                    <Text style={s.scheduleLabel}>Watering schedule</Text>
                  </View>
                  {/*
                    A quiet text button, not a second filled control: the card
                    already has one action, and history is something you go look
                    at rather than something you do.
                  */}
                  <Pressable
                    style={({ pressed }) => [s.historyBtn, pressed && { opacity: 0.6 }]}
                    onPress={() => navigation.navigate('WateringHistory', { plantId: plant.id })}
                    accessibilityRole="button"
                    accessibilityLabel={`See the watering history for ${diagnosis.plantName}`}
                    hitSlop={8}
                  >
                    <Text style={s.historyBtnText}>History</Text>
                    <Ionicons name="chevron-forward" size={14} color={t.color.water} style={directionalIconStyle} />
                  </Pressable>
                </View>

                <Text style={s.scheduleInterval}>{intervalLabel(diagnosis.carePlan)}</Text>

                {/*
                  The countdown sits in ONE place, and which place depends on
                  whether it is news. Due and overdue are the reason the user
                  opened the card, so they get the loud line; a plant with days
                  left is reassurance, and reassurance belongs under the button
                  rather than shouted above it.
                */}
                {!settled && (
                  <Text
                    style={[
                      s.scheduleStatus,
                      water.status === 'overdue' && { color: t.color.danger },
                      water.status === 'due' && { color: t.color.warning },
                    ]}
                  >
                    {water.label}
                  </Text>
                )}

                {/*
                  Nothing to do until the plant is due again, so the button
                  stops being a button: filled and blue while there is an action
                  to take, an outlined "Watered" receipt once the schedule is
                  running. It comes back on its own the day watering is due -
                  the state is derived from the schedule, never from a flag
                  somebody has to remember to clear.
                */}
                <Pressable
                  style={({ pressed }) => [
                    s.waterBtn,
                    settled && s.waterBtnDone,
                    // Still gives feedback while held, or the long press feels
                    // like nothing is happening until it fires.
                    pressed && (settled ? s.waterBtnDonePressed : s.waterBtnPressed),
                    watering && s.waterBtnBusy,
                  ]}
                  /*
                   * Settled swaps the gestures rather than switching the button
                   * off: a tap does nothing, but a hold still logs a watering.
                   * Someone who tops a plant up on day 3 of a 7-day interval is
                   * not making a mistake, and a schedule that refuses the real
                   * event goes stale - but it takes a deliberate press, so the
                   * common case (already watered, nothing to do) stays inert.
                   */
                  onPress={settled ? undefined : handleWater}
                  onLongPress={settled ? handleWater : undefined}
                  disabled={watering}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: watering }}
                  accessibilityLabel={
                    settled
                      ? `${diagnosis.plantName} has been watered. ${water.label}.`
                      : `Log a watering for ${diagnosis.plantName}. ${water.label}`
                  }
                  accessibilityHint={
                    settled ? 'Double tap and hold to log an early watering' : undefined
                  }
                >
                  <Ionicons
                    name={settled ? 'checkmark-circle' : 'water'}
                    size={18}
                    color={settled ? t.color.water : t.color.onWater}
                  />
                  <Text style={[s.waterBtnText, settled && s.waterBtnDoneText]}>
                    {settled
                      ? 'Watered'
                      : water.status === 'never_watered'
                        ? 'I watered it today'
                        : 'Water now'}
                  </Text>
                </Pressable>

                {/*
                  The date the plant was last watered was the wrong fact to end
                  on: it is history, and the only question a person opens this
                  card with is when the next watering is. That answer is the
                  status line above, so this row carries only what it does not -
                  whether the OS will actually remind them, and how to log an
                  early watering once the button has gone quiet.
                */}
                {(settled || !!plant.reminderId) && (
                  <Text style={s.scheduleNote}>
                    {[
                      settled ? water.label : null,
                      plant.reminderId ? 'reminder set' : null,
                      settled ? 'hold Watered to log an early one' : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                )}
              </View>
            )}
          </View>
        )}

        {/*
          Repotting and feeding. Deliberately no countdown and no "due" state:
          unlike watering, the care plan carries no interval for either, and a
          schedule invented here would be advice the app made up.
        */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Care log</Text>
          {CARE_LOG_ROWS.map(({ kind, label, icon, verb }) => {
            const last = careHistory(plant, kind)[0];
            return (
              <View key={kind} style={s.logRow}>
                <Ionicons name={icon} size={18} color={t.color.textSecondary} />
                <View style={s.logRowText}>
                  <Text style={s.logLabel}>{label}</Text>
                  <Text style={s.logMeta}>
                    {last ? `Last ${new Date(last).toLocaleDateString()}` : 'Never logged'}
                  </Text>
                </View>
                {!!last && (
                  <Pressable
                    style={({ pressed }) => [s.historyBtn, pressed && { opacity: 0.6 }]}
                    onPress={() => navigation.navigate('WateringHistory', { plantId: plant.id, kind })}
                    accessibilityRole="button"
                    accessibilityLabel={`See the ${label.toLowerCase()} history for ${diagnosis.plantName}`}
                    hitSlop={8}
                  >
                    <Ionicons
                      name="chevron-forward"
                      size={16}
                      color={t.color.textSecondary}
                      style={directionalIconStyle}
                    />
                  </Pressable>
                )}
                <Pressable
                  style={({ pressed }) => [s.logBtn, pressed && { opacity: 0.7 }]}
                  onPress={() => handleCare(kind)}
                  accessibilityRole="button"
                  accessibilityLabel={`${verb} ${diagnosis.plantName} today`}
                  hitSlop={6}
                >
                  <Text style={s.logBtnText}>{verb}</Text>
                </Pressable>
              </View>
            );
          })}
        </View>

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
    logRow: { flexDirection: 'row', alignItems: 'center', gap: t.space.md, paddingVertical: t.space.sm },
    logRowText: { flex: 1 },
    logLabel: { ...t.type.bodyStrong, color: t.color.foreground },
    logMeta: { ...t.type.caption, color: t.color.textMuted },
    logBtn: {
      paddingHorizontal: t.space.md,
      paddingVertical: t.space.sm,
      borderRadius: t.radius.pill,
      backgroundColor: t.color.surfaceMuted,
    },
    logBtnText: { ...t.type.label, color: t.color.foreground },
    sectionNote: { ...t.type.caption, color: t.color.textMuted, marginTop: -t.space.xs, marginBottom: t.space.sm },

    /*
     * Same card shell as a treatment, deliberately: both are advice about this
     * plant. The icon column is what separates them at a glance - no urgency
     * colour here, because ongoing care is never the thing to act on first.
     */
    careCard: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      backgroundColor: t.color.surface,
      borderRadius: t.radius.lg,
      padding: t.space.md,
      marginBottom: t.space.sm,
      ...t.elevation.card,
    },
    careIconWrap: {
      width: 36,
      height: 36,
      borderRadius: t.radius.md,
      backgroundColor: t.color.surfaceMuted,
      alignItems: 'center',
      justifyContent: 'center',
      marginEnd: t.space.md,
    },
    careBody: { flex: 1 },
    careLabel: { ...t.type.caption, color: t.color.textMuted, textTransform: 'uppercase', letterSpacing: 0.6 },
    careText: { ...t.type.body, color: t.color.foreground, marginTop: 2, writingDirection: 'auto' },

    /*
     * The one card in this section the user ACTS on, so it is drawn as an
     * object rather than a tint: its own water-blue ground, a blue edge, and
     * lift off the page. Sitting on `surfaceMuted` with no border, it read as a
     * gap between the care rows instead of as a thing to press.
     */
    scheduleCard: {
      backgroundColor: t.color.waterWash,
      borderRadius: t.radius.lg,
      borderWidth: 1,
      borderColor: t.color.water,
      padding: t.space.lg,
      marginTop: t.space.sm,
      ...t.elevation.card,
    },
    scheduleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    scheduleHeading: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    scheduleLabel: {
      ...t.type.caption,
      color: t.color.water,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },
    scheduleInterval: { ...t.type.caption, color: t.color.textSecondary, marginTop: 2 },
    historyBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 28 },
    historyBtnText: { ...t.type.caption, color: t.color.water, fontWeight: '700' },
    scheduleStatus: { ...t.type.bodyStrong, color: t.color.foreground, marginTop: 4 },
    scheduleNote: { ...t.type.caption, color: t.color.textMuted, marginTop: t.space.sm, textAlign: 'center' },
    waterBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: t.space.sm,
      // Water blue, not the app's nature green: this is a watering action, and
      // green here would compete with the screen's real primary CTA.
      backgroundColor: t.color.water,
      borderRadius: t.radius.lg,
      marginTop: t.space.md,
      paddingVertical: t.space.md,
      minHeight: 48,
      ...t.elevation.raised,
    },
    waterBtnPressed: { backgroundColor: t.color.waterPressed, transform: [{ scale: 0.98 }] },
    /*
     * Outlined, unfilled, unlifted - a receipt rather than an action. Greying it
     * out was the alternative and was rejected: a disabled grey control reads as
     * "broken" or "not available to you", when what actually happened is the
     * user succeeded.
     */
    waterBtnDone: {
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderColor: t.color.water,
      shadowOpacity: 0,
      elevation: 0,
    },
    waterBtnDonePressed: { opacity: 0.55, transform: [{ scale: 0.98 }] },
    waterBtnDoneText: { color: t.color.water },
    // The write is fast, but scheduling talks to the OS and can hang behind a
    // permission dialog. Dimming beats a spinner that flashes for one frame.
    waterBtnBusy: { opacity: 0.6 },
    waterBtnText: { ...t.type.label, color: t.color.onWater },

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
