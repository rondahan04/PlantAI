import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Image, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { RootStackParamList } from '../types';
import { Theme, useTheme } from '../theme';
import { plantLibrary } from '../services/plantLibrary';

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

export default function PlantDetailScreen({ navigation, route }: Props) {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
  const { plantId } = route.params;

  const [plant] = useState(() =>
    plantLibrary.load().plants.find((p) => p.id === plantId) ?? null
  );

  /*
   * The plant is gone. Reachable if it was removed in another tab of the
   * navigation stack. Say so plainly instead of rendering an empty shell.
   */
  if (!plant) {
    return (
      <SafeAreaView style={s.container} edges={['top', 'bottom']}>
        <View style={s.missing}>
          <Ionicons name="leaf-outline" size={40} color={t.color.textMuted} />
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
          <Ionicons name="leaf-outline" size={40} color={t.color.textMuted} />
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
