import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Image, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { RootStackParamList } from '../types';
import { Theme, useTheme } from '../theme';
import { LOGO_GLYPH } from '../brand';
import { plantLibrary } from '../services/plantLibrary';
import { intervalLabel, wateringState } from '../lib/watering';
import { cancelWateringReminder, scheduleWateringReminder } from '../services/wateringReminder';

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
   * Log a watering.
   *
   * The order matters and is the opposite of the obvious one: the record is
   * written FIRST and the notification scheduled after. Storage is the source of
   * truth for the schedule, so a reminder scheduled against a watering that
   * failed to persist would fire for a date the app does not believe in. The
   * reverse — a stored watering with no notification — is the degraded state
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
            <Ionicons name="chevron-back" size={22} color={t.color.primary} />
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

        {/* Same caveat as the card: the cache URI may be dead until item 9. */}
        <View style={s.imageWrap}>
          <Image source={LOGO_GLYPH} style={[s.heroGlyph, { tintColor: t.color.textMuted }]} />
          <Image source={{ uri: plant.photoUri }} style={s.image} />
        </View>

        <View style={[s.badge, { backgroundColor: color }]}>
          <Text style={s.badgeText}>{diagnosis.conditionLabel}</Text>
        </View>

        <Text style={s.name}>{diagnosis.plantName}</Text>
        {!!diagnosis.scientificName && <Text style={s.sciName}>{diagnosis.scientificName}</Text>}
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
          Nothing is rendered in that case — a "Care plan" heading over three
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
                <View style={s.careIconWrap}>
                  <Ionicons name={icon} size={20} color={t.color.primary} />
                </View>
                <View style={s.careBody}>
                  <Text style={s.careLabel}>{label}</Text>
                  <Text style={s.careText}>{diagnosis.carePlan![key]}</Text>
                </View>
              </View>
            ))}

            {/*
              The schedule hangs off the water row rather than sitting in its
              own section: "every 7-10 days" and "next water in 3 days" are the
              same fact in two tenses, and splitting them makes the user read
              the interval twice. Absent entirely when the diagnosis carried no
              number — a tap that promises a reminder the app cannot schedule is
              worse than no button.
            */}
            {water.status !== 'unscheduled' && (
              <View style={s.scheduleCard}>
                <View style={s.scheduleRow}>
                  <Text style={s.careLabel}>Schedule</Text>
                  <Text style={s.scheduleInterval}>{intervalLabel(diagnosis.carePlan)}</Text>
                </View>

                <Text
                  style={[
                    s.scheduleStatus,
                    water.status === 'overdue' && { color: t.color.danger },
                    water.status === 'due' && { color: t.color.warning },
                  ]}
                >
                  {water.label}
                </Text>

                <Pressable
                  style={({ pressed }) => [
                    s.waterBtn,
                    pressed && s.waterBtnPressed,
                    watering && s.waterBtnBusy,
                  ]}
                  onPress={handleWater}
                  disabled={watering}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: watering }}
                  accessibilityLabel={`Log a watering for ${diagnosis.plantName}. ${water.label}`}
                >
                  <Ionicons name="water" size={18} color={t.color.onPrimary} />
                  <Text style={s.waterBtnText}>
                    {water.status === 'never_watered' ? 'I watered it today' : 'Water now'}
                  </Text>
                </Pressable>

                {!!plant.lastWateredAt && (
                  <Text style={s.scheduleNote}>
                    Last watered {new Date(plant.lastWateredAt).toLocaleDateString()}
                    {plant.reminderId ? ' · reminder set' : ''}
                  </Text>
                )}
              </View>
            )}
          </View>
        )}

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

    name: { ...t.type.display, color: t.color.foreground, marginTop: t.space.sm },
    sciName: { ...t.type.body, color: t.color.textMuted, fontStyle: 'italic', marginTop: 2 },
    desc: { ...t.type.body, color: t.color.textSecondary, marginTop: t.space.md },

    section: { marginTop: t.space.xl },
    sectionTitle: { ...t.type.heading, color: t.color.foreground, marginBottom: t.space.sm },
    sectionNote: { ...t.type.caption, color: t.color.textMuted, marginTop: -t.space.xs, marginBottom: t.space.sm },

    /*
     * Same card shell as a treatment, deliberately: both are advice about this
     * plant. The icon column is what separates them at a glance — no urgency
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
      marginRight: t.space.md,
    },
    careBody: { flex: 1 },
    careLabel: { ...t.type.caption, color: t.color.textMuted, textTransform: 'uppercase', letterSpacing: 0.6 },
    careText: { ...t.type.body, color: t.color.foreground, marginTop: 2 },

    /*
     * Tinted rather than plain surface: this is the one card in the section the
     * user acts on, and it has to read as different from the three they only
     * read. The accent stays on the button — the card itself only leans.
     */
    scheduleCard: {
      backgroundColor: t.color.surfaceMuted,
      borderRadius: t.radius.lg,
      padding: t.space.md,
      marginTop: t.space.xs,
    },
    scheduleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    scheduleInterval: { ...t.type.caption, color: t.color.textSecondary },
    scheduleStatus: { ...t.type.bodyStrong, color: t.color.foreground, marginTop: 4 },
    scheduleNote: { ...t.type.caption, color: t.color.textMuted, marginTop: t.space.sm, textAlign: 'center' },
    waterBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: t.space.sm,
      backgroundColor: t.color.primary,
      borderRadius: t.radius.lg,
      marginTop: t.space.md,
      paddingVertical: t.space.md,
      minHeight: 48,
    },
    waterBtnPressed: { backgroundColor: t.color.primaryPressed, transform: [{ scale: 0.98 }] },
    // The write is fast, but scheduling talks to the OS and can hang behind a
    // permission dialog. Dimming beats a spinner that flashes for one frame.
    waterBtnBusy: { opacity: 0.6 },
    waterBtnText: { ...t.type.label, color: t.color.onPrimary },

    issueRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: t.space.sm },
    issueDot: { width: 8, height: 8, borderRadius: 4, marginTop: 8, marginRight: t.space.sm },
    issueText: { ...t.type.body, color: t.color.textSecondary, flex: 1 },

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
    treatmentTitle: { ...t.type.bodyStrong, color: t.color.foreground },
    treatmentDesc: { ...t.type.body, color: t.color.textSecondary, marginTop: 2 },

    savedAt: { ...t.type.caption, color: t.color.textMuted, marginTop: t.space.xl, textAlign: 'center' },

    missing: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: t.space.xl },
    missingTitle: { ...t.type.heading, color: t.color.foreground, marginTop: t.space.md, textAlign: 'center' },
    backLink: { marginTop: t.space.lg, minHeight: 44, justifyContent: 'center' },
    backLinkText: { ...t.type.label, color: t.color.primary },
  });
