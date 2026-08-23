import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Image,
  Animated,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { RootStackParamList, DeliveryMode } from '../types';
import { Theme, useTheme } from '../theme';
import { directionalIconStyle } from '../lib/rtl';
import { prefetchNearbyNurseries } from '../services/nurseryService';
import { plantRepo } from '../services/plantRepoInstance';
import { plantLibrary } from '../services/plantLibrary';
import { plantPhotos } from '../services/photos';
import { identityConfidence } from '../lib/confidence';
import { useSession } from '../hooks/useSession';
import { getSessionHint } from '../services/sessionHint';

// Tel Aviv center - used as fallback when location permission is denied
const FALLBACK_LAT = 32.1624;
const FALLBACK_LNG = 34.8443;

// Resolve the device location, falling back to Herzliya center when permission
// is denied or GPS is unavailable.
async function resolveCoords(): Promise<{ lat: number; lng: number }> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status === 'granted') {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      return { lat: loc.coords.latitude, lng: loc.coords.longitude };
    }
  } catch {
    // fall through to fallback
  }
  return { lat: FALLBACK_LAT, lng: FALLBACK_LNG };
}

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Diagnosis'>;
  route: RouteProp<RootStackParamList, 'Diagnosis'>;
};

type IconName = keyof typeof Ionicons.glyphMap;

// Condition scale icons (used for badge/dot/bar, never as low-contrast body
// text). Accent colors come from theme tokens (t.color.condition*) so they
// stay readable in both light and dark.
const CONDITION_ICON: Record<string, IconName> = {
  healthy: 'checkmark-circle',
  mild: 'alert-circle-outline',
  moderate: 'warning-outline',
  severe: 'warning',
  critical: 'skull-outline',
};

export default function DiagnosisScreen({ navigation, route }: Props) {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
  const session = useSession();
  const { imageUri, diagnosis } = route.params;
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>('delivery');
  const [findingNurseries, setFindingNurseries] = useState(false);
  const coordsRef = useRef<{ lat: number; lng: number } | null>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(24)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 400, useNativeDriver: true }),
    ]).start();
  }, []);

  // Resolve the user's location and PREFETCH the nursery scrape as soon as the
  // diagnosis is shown, so the (30-60s) scrape is already in flight by the time
  // the user taps "Find" - the nurseries screen then loads with minimal wait.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const coords = await resolveCoords();
      if (cancelled) return;
      coordsRef.current = coords;
      prefetchNearbyNurseries(diagnosis.plantName, coords.lat, coords.lng);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const conditionColor: Record<string, string> = {
    healthy: t.color.conditionHealthy,
    mild: t.color.conditionMild,
    moderate: t.color.conditionModerate,
    severe: t.color.conditionSevere,
    critical: t.color.conditionCritical,
  };
  const condition = {
    icon: CONDITION_ICON[diagnosis.condition] || CONDITION_ICON.moderate,
    color: conditionColor[diagnosis.condition] || conditionColor.moderate,
  };

  const identity = identityConfidence(diagnosis.confidence, diagnosis.plantName);

  const handleFindReplacement = async () => {
    // Coordinates are usually already resolved by the mount effect (and the
    // scrape prefetched). If the user taps before that finishes, resolve now.
    let coords = coordsRef.current;
    if (!coords) {
      setFindingNurseries(true);
      coords = await resolveCoords();
      coordsRef.current = coords;
      prefetchNearbyNurseries(diagnosis.plantName, coords.lat, coords.lng);
      setFindingNurseries(false);
    }
    // NurseriesScreen awaits the same (prefetched) request, so its loading time
    // is minimal. We only pass the query params here.
    navigation.navigate('Nurseries', {
      plantName: diagnosis.plantName,
      lat: coords.lat,
      lng: coords.lng,
      mode: deliveryMode,
    });
  };


  /*
   * Save to the plant library (TODOS item 7).
   *
   * Placement is the header icon rather than a fourth button: this screen
   * already carries three actions and up to two URGENT badges, and "Find a
   * replacement" is the commerce CTA that has to keep the accent colour. The
   * header had a reserved empty slot opposite Back, which is exactly the
   * weight a bookmark action deserves.
   *
   * `saved` is set BEFORE the write, not after. A double-tap on a slow device
   * would otherwise run save() twice and put two identical plants in the
   * library; the flag is rolled back if the write actually fails.
   */
  const [saved, setSaved] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);

  const handleSave = async () => {
    if (saved) return;
    setSaved(true);

    const result = await plantRepo.save({ photoUri: imageUri, diagnosis });
    if (!result.ok) {
      setSaved(false);
      // The store already distinguishes this from every other failure: the
      // write did not land, and retrying after freeing space will work.
      Alert.alert(
        "Couldn't save",
        result.reason === 'network'
          ? "Couldn't reach your account. Check your connection and try again."
          : 'Your device is out of storage space. Free some space and try again.',
        [{ text: 'OK' }]
      );
      return;
    }
    setSavedId(result.plant.id);

    /*
     * Photo persistence (TODOS item 9), deliberately AFTER the synchronous
     * write and deliberately not awaited. Guest-only: a cloud save already
     * uploaded the photo as part of `plantRepo.save()`, so re-adopting it
     * into the local document directory would be pointless (and would
     * repoint a mirror-only record's local field to a local file path).
     *
     * `imageUri` points into the cache directory, which iOS empties whenever it
     * wants the space - so the record would outlive its picture. The copy is
     * async in expo-file-system 56, and putting an await in front of the save
     * would trade a guaranteed record for a nicer photo: killed mid-copy, the
     * plant itself would be gone. This way the worst case is a plant whose
     * photo never made it across, which the next load repairs or forgets.
     */
    const id = result.plant.id;
    if (!getSessionHint()) {
      void plantPhotos.adopt(id, imageUri).then((persisted) => {
        if (persisted) plantLibrary.update(id, { photoUri: persisted });
      });
    }
  };

  const handleUnsave = async () => {
    if (!savedId) return;
    const result = await plantRepo.remove(savedId);
    if (!result.ok) return;
    // Only after the record is gone - a failed removal must not cost the photo
    // of a plant that is still in the library. Guest-only: a cloud save's
    // photo lives in Supabase Storage, which `discard()` has no way to reach.
    if (!getSessionHint()) {
      plantPhotos.discard(savedId);
    }
    setSaved(false);
    setSavedId(null);
  };

  return (
    <SafeAreaView style={s.container} edges={['top', 'bottom']}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>
        {/* Header */}
        <View style={s.header}>
          <Pressable style={s.backBtn} onPress={() => navigation.navigate('Home')} accessibilityRole="button" accessibilityLabel="Back to home">
            <Ionicons name="chevron-back" size={22} color={t.color.primary} style={directionalIconStyle} />
            <Text style={s.backText}>Back</Text>
          </Pressable>
          <Text style={s.headerTitle}>Diagnosis</Text>
          <Pressable
            style={s.saveBtn}
            onPress={saved ? handleUnsave : handleSave}
            accessibilityRole="button"
            accessibilityLabel={saved ? 'Saved to my plants. Tap to remove.' : 'Save to my plants'}
            accessibilityState={{ selected: saved }}
            hitSlop={8}
          >
            <Ionicons
              name={saved ? 'bookmark' : 'bookmark-outline'}
              size={22}
              color={saved ? t.color.primary : t.color.foreground}
            />
            <Text style={[s.saveText, saved && s.saveTextActive]}>
              {saved ? 'Saved' : 'Save'}
            </Text>
          </Pressable>
        </View>

        <Animated.View style={{ opacity: fadeAnim }}>
          <View style={s.imageWrap}>
            <Image source={{ uri: imageUri }} style={s.plantImage} />
            <View style={s.conditionBadge}>
              <Ionicons name={condition.icon} size={16} color={condition.color} />
              <Text style={[s.conditionBadgeText, { color: condition.color }]}>{diagnosis.conditionLabel}</Text>
            </View>
          </View>
        </Animated.View>

        {/* Plant name + species-match confidence.
            The bar is NOT tinted with condition.color: that conflated "how sure
            are we what this plant is" with "how sick is it". */}
        <Animated.View style={[s.plantInfo, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          {!!identity.namePrefix && <Text style={s.namePrefix}>{identity.namePrefix}</Text>}
          <Text
            style={s.plantName}
            accessibilityLabel={
              identity.needsCaveat
                ? `${identity.namePrefix} ${diagnosis.plantName}. ${identity.label}. ${identity.noteTitle}.`
                : `${diagnosis.plantName}. ${identity.label}.`
            }
          >
            {diagnosis.plantName}
          </Text>
          {!!diagnosis.variety && <Text style={s.variety}>{diagnosis.variety}</Text>}
          <View style={s.confidenceRow}>
            <View style={s.confidenceBar}>
              <View
                style={[
                  s.confidenceFill,
                  { width: `${diagnosis.confidence}%`, backgroundColor: t.color.textSecondary },
                ]}
              />
            </View>
            <Text style={s.confidenceText}>{identity.label}</Text>
          </View>
        </Animated.View>

        {/* Uncertainty caveat - a card, not a color, so it cannot be scanned past
            and does not depend on color vision. */}
        {identity.needsCaveat && (
          <Animated.View style={[s.caveatCard, { opacity: fadeAnim }]}>
            <View style={s.caveatHeader}>
              <Ionicons name="help-circle-outline" size={20} color={t.color.warning} />
              <Text style={s.caveatTitle}>{identity.noteTitle}</Text>
            </View>
            <Text style={s.caveatBody}>{identity.noteBody}</Text>
            <Pressable
              style={({ pressed }) => [s.caveatBtn, pressed && s.caveatBtnPressed]}
              onPress={() => navigation.replace('Camera')}
              accessibilityRole="button"
              accessibilityLabel="Not your plant? Retake the photo"
            >
              <Ionicons name="camera-outline" size={18} color={t.color.foreground} />
              <Text style={s.caveatBtnText}>Not your plant? Retake photo</Text>
            </Pressable>
          </Animated.View>
        )}

        {/* Description */}
        <Animated.View style={[s.card, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          <Text style={s.descText}>{diagnosis.description}</Text>
        </Animated.View>

        {/* Issues */}
        {diagnosis.issues.length > 0 && (
          <Animated.View style={[s.section, { opacity: fadeAnim }]}>
            <View style={s.sectionTitleRow}>
              <Ionicons name="search-outline" size={18} color={t.color.foreground} />
              <Text style={s.sectionTitle}>Issues detected</Text>
            </View>
            {diagnosis.issues.map((issue, i) => (
              <View key={i} style={s.issueRow}>
                <View style={[s.issueDot, { backgroundColor: condition.color }]} />
                <Text style={s.issueText}>{issue}</Text>
              </View>
            ))}
          </Animated.View>
        )}

        {/* Treatments */}
        {diagnosis.canBeSaved && diagnosis.treatments.length > 0 && (
          <Animated.View style={[s.section, { opacity: fadeAnim }]}>
            <View style={s.sectionTitleRow}>
              <Ionicons name="medkit-outline" size={18} color={t.color.foreground} />
              <Text style={s.sectionTitle}>Treatment plan</Text>
            </View>
            {diagnosis.treatments.map((tr, i) => (
              <View key={i} style={[s.treatmentCard, tr.urgent && s.treatmentUrgent]}>
                {tr.urgent && (
                  <View style={s.urgentBadge}>
                    <Text style={s.urgentText}>URGENT</Text>
                  </View>
                )}
                <Text style={s.treatmentTitle}>{tr.title}</Text>
                <Text style={s.treatmentDesc}>{tr.description}</Text>
              </View>
            ))}
          </Animated.View>
        )}

        {/* Replace Section */}
        <Animated.View style={[s.replaceCard, { opacity: fadeAnim }]}>
          <Text style={s.replaceSectionTitle}>
            {diagnosis.canBeSaved ? 'Or replace with a healthy one' : 'Find a healthy replacement'}
          </Text>
          {!diagnosis.canBeSaved && (
            <Text style={s.replaceDesc}>
              This plant is too damaged to save. Find an identical, healthy {diagnosis.plantName} at nurseries near you.
            </Text>
          )}

          {/* Delivery toggle */}
          <View style={s.toggleRow}>
            {(['delivery', 'pickup'] as DeliveryMode[]).map((mode) => {
              const active = deliveryMode === mode;
              return (
                <Pressable
                  key={mode}
                  style={[s.toggleBtn, active && s.toggleBtnActive]}
                  onPress={() => setDeliveryMode(mode)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Ionicons
                    name={mode === 'delivery' ? 'rocket-outline' : 'storefront-outline'}
                    size={22}
                    color={active ? t.color.primary : t.color.textMuted}
                  />
                  <Text style={[s.toggleBtnText, active && s.toggleBtnTextActive]}>
                    {mode === 'delivery' ? 'Get it delivered today' : 'Pick it up'}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Pressable
            style={({ pressed }) => [s.findBtn, pressed && s.btnPressed]}
            onPress={handleFindReplacement}
            disabled={findingNurseries}
            accessibilityRole="button"
            accessibilityLabel="Find nurseries"
          >
            {findingNurseries ? (
              <ActivityIndicator color={t.color.onPrimary} />
            ) : (
              <Text style={s.findBtnText}>
                {deliveryMode === 'delivery' ? 'Find Delivery Options' : 'Find Nearby Nurseries'}
              </Text>
            )}
          </Pressable>
        </Animated.View>

        {/* Scan again */}
        <Pressable style={s.scanAgainBtn} onPress={() => navigation.navigate('Camera')} accessibilityRole="button">
          <Ionicons name="camera-outline" size={18} color={t.color.primary} />
          <Text style={s.scanAgainText}>Scan Another Plant</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: t.color.background },
    scroll: { paddingBottom: t.space['2xl'], paddingHorizontal: t.space.xl },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: t.space.md },
    backBtn: { flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingEnd: t.space.sm },
    backText: { ...t.type.label, color: t.color.primary },
    // Mirrors backBtn's 44pt target and width so the title stays centred.
    saveBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      minWidth: 60,
      minHeight: 44,
      paddingStart: t.space.sm,
    },
    saveText: { ...t.type.label, color: t.color.foreground, marginStart: 4 },
    saveTextActive: { color: t.color.primary },
    headerTitle: { ...t.type.heading, color: t.color.foreground },
    imageWrap: { borderRadius: t.radius.xl, overflow: 'hidden', height: 240, ...t.elevation.card },
    plantImage: { width: '100%', height: '100%' },
    conditionBadge: {
      position: 'absolute',
      bottom: t.space.md,
      start: t.space.md,
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space.xs,
      paddingHorizontal: t.space.md,
      paddingVertical: t.space.xs,
      borderRadius: t.radius.pill,
      backgroundColor: t.color.surface,
      ...t.elevation.card,
    },
    conditionBadgeText: { ...t.type.label, fontWeight: '700' },
    plantInfo: { paddingTop: t.space.lg, paddingBottom: t.space.sm },
    plantName: { ...t.type.title, fontSize: 26, lineHeight: 32, color: t.color.foreground, marginBottom: t.space.sm, writingDirection: 'auto' },
    namePrefix: { ...t.type.label, color: t.color.textMuted, marginBottom: 2 },
    variety: { ...t.type.body, color: t.color.textSecondary, marginTop: -t.space.sm / 2, marginBottom: t.space.sm, writingDirection: 'auto' },
    caveatCard: {
      backgroundColor: t.color.warningWash,
      borderRadius: t.radius.lg,
      padding: t.space.lg,
      marginTop: t.space.lg,
    },
    caveatHeader: { flexDirection: 'row', alignItems: 'center', gap: t.space.sm, marginBottom: t.space.sm },
    caveatTitle: { ...t.type.bodyStrong, color: t.color.foreground, flex: 1 },
    caveatBody: { ...t.type.label, color: t.color.textSecondary, fontWeight: '400', marginBottom: t.space.lg },
    caveatBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: t.space.sm,
      minHeight: 44,
      borderRadius: t.radius.md,
      borderWidth: 1,
      borderColor: t.color.border,
      backgroundColor: t.color.surface,
    },
    caveatBtnPressed: { backgroundColor: t.color.surfaceMuted },
    caveatBtnText: { ...t.type.label, color: t.color.foreground },

    confidenceRow: { flexDirection: 'row', alignItems: 'center', gap: t.space.md },
    confidenceBar: { flex: 1, height: 6, backgroundColor: t.color.surfaceMuted, borderRadius: t.radius.pill, overflow: 'hidden' },
    confidenceFill: { height: '100%', borderRadius: t.radius.pill },
    confidenceText: { ...t.type.caption, color: t.color.textSecondary },
    card: {
      marginTop: t.space.md,
      backgroundColor: t.color.surface,
      borderRadius: t.radius.lg,
      padding: t.space.lg,
      borderWidth: 1,
      borderColor: t.color.border,
      ...t.elevation.card,
    },
    descText: { ...t.type.body, fontSize: 14, lineHeight: 21, color: t.color.textSecondary, writingDirection: 'auto' },
    section: { marginTop: t.space.xl },
    sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: t.space.sm, marginBottom: t.space.md },
    sectionTitle: { ...t.type.heading, fontSize: 16, color: t.color.foreground },
    issueRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: t.space.sm, gap: t.space.md },
    issueDot: { width: 8, height: 8, borderRadius: 4, marginTop: 7 },
    issueText: { flex: 1, ...t.type.body, fontSize: 14, lineHeight: 20, color: t.color.textSecondary, writingDirection: 'auto' },
    treatmentCard: {
      backgroundColor: t.color.surface,
      borderRadius: t.radius.md,
      padding: t.space.lg,
      marginBottom: t.space.md,
      borderWidth: 1,
      borderColor: t.color.border,
      ...t.elevation.card,
    },
    treatmentUrgent: { borderColor: t.color.danger },
    urgentBadge: {
      backgroundColor: t.color.danger,
      paddingHorizontal: t.space.sm,
      paddingVertical: 3,
      borderRadius: t.radius.sm,
      alignSelf: 'flex-start',
      marginBottom: t.space.sm,
    },
    urgentText: { ...t.type.caption, fontSize: 10, fontWeight: '800', color: t.color.onDanger, letterSpacing: 1 },
    treatmentTitle: { ...t.type.bodyStrong, fontSize: 15, color: t.color.foreground, marginBottom: t.space.xs, writingDirection: 'auto' },
    treatmentDesc: { ...t.type.label, fontWeight: '400', fontSize: 13, lineHeight: 19, color: t.color.textSecondary, writingDirection: 'auto' },
    replaceCard: {
      marginTop: t.space.xl,
      backgroundColor: t.color.surfaceMuted,
      borderRadius: t.radius.xl,
      padding: t.space.xl,
      borderWidth: 1,
      borderColor: t.color.border,
    },
    replaceSectionTitle: { ...t.type.heading, color: t.color.foreground, marginBottom: t.space.sm },
    replaceDesc: { ...t.type.body, fontSize: 14, lineHeight: 20, color: t.color.textSecondary, marginBottom: t.space.lg },
    toggleRow: { flexDirection: 'row', gap: t.space.md, marginVertical: t.space.md },
    toggleBtn: {
      flex: 1,
      alignItems: 'center',
      gap: t.space.sm,
      paddingVertical: t.space.md,
      paddingHorizontal: t.space.md,
      borderRadius: t.radius.md,
      borderWidth: 2,
      borderColor: t.color.border,
      backgroundColor: t.color.surface,
      minHeight: 44,
    },
    toggleBtnActive: { borderColor: t.color.primary, backgroundColor: t.color.primaryWash },
    toggleBtnText: { ...t.type.caption, color: t.color.textMuted, textAlign: 'center' },
    toggleBtnTextActive: { color: t.color.primary, fontWeight: '700' },
    findBtn: {
      backgroundColor: t.color.primary,
      borderRadius: t.radius.md,
      paddingVertical: t.space.lg,
      minHeight: 52,
      alignItems: 'center',
      justifyContent: 'center',
      ...t.elevation.raised,
    },
    btnPressed: { backgroundColor: t.color.primaryPressed, transform: [{ scale: 0.98 }] },
    findBtnText: { ...t.type.bodyStrong, color: t.color.onPrimary, fontWeight: '700' },
    scanAgainBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: t.space.sm,
      marginTop: t.space.lg,
      paddingVertical: t.space.md,
      minHeight: 44,
      borderRadius: t.radius.md,
      borderWidth: 1,
      borderColor: t.color.border,
    },
    scanAgainText: { ...t.type.label, color: t.color.primary, fontWeight: '600' },
  });
}
