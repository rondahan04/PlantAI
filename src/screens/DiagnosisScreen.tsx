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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { RootStackParamList, DeliveryMode } from '../types';
import { loadNearbyNurseries } from '../services/nurseryService';
import { Theme, useTheme } from '../theme';

// Tel Aviv center — used as fallback when location permission is denied
const FALLBACK_LAT = 32.0853;
const FALLBACK_LNG = 34.7818;

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Diagnosis'>;
  route: RouteProp<RootStackParamList, 'Diagnosis'>;
};

type IconName = keyof typeof Ionicons.glyphMap;

// Condition scale: icon + accent color (used for badge/dot/bar, never as
// low-contrast body text). Colors meet >=3:1 against light surfaces.
const CONDITION_CONFIG: Record<string, { color: string; icon: IconName }> = {
  healthy: { color: '#15803D', icon: 'checkmark-circle' },
  mild: { color: '#0F766E', icon: 'alert-circle-outline' },
  moderate: { color: '#B45309', icon: 'warning-outline' },
  severe: { color: '#C2410C', icon: 'warning' },
  critical: { color: '#DC2626', icon: 'skull-outline' },
};

export default function DiagnosisScreen({ navigation, route }: Props) {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
  const { imageUri, diagnosis } = route.params;
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>('delivery');
  const [findingNurseries, setFindingNurseries] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(24)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 400, useNativeDriver: true }),
    ]).start();
  }, []);

  const condition = CONDITION_CONFIG[diagnosis.condition] || CONDITION_CONFIG.moderate;

  const handleFindReplacement = async () => {
    setFindingNurseries(true);
    let lat = FALLBACK_LAT;
    let lng = FALLBACK_LNG;
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        lat = loc.coords.latitude;
        lng = loc.coords.longitude;
      }
    } catch {
      // Permission denied or GPS unavailable — Tel Aviv fallback used
    } finally {
      setFindingNurseries(false);
    }
    const nurseries = loadNearbyNurseries(diagnosis.plantName, lat, lng);
    navigation.navigate('Nurseries', { plantName: diagnosis.plantName, nurseries, mode: deliveryMode });
  };

  return (
    <SafeAreaView style={s.container} edges={['top', 'bottom']}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>
        {/* Header */}
        <View style={s.header}>
          <Pressable style={s.backBtn} onPress={() => navigation.navigate('Home')} accessibilityRole="button" accessibilityLabel="Back to home">
            <Ionicons name="chevron-back" size={22} color={t.color.primary} />
            <Text style={s.backText}>Back</Text>
          </Pressable>
          <Text style={s.headerTitle}>Diagnosis</Text>
          <View style={{ width: 60 }} />
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

        {/* Plant Name + Confidence */}
        <Animated.View style={[s.plantInfo, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          <Text style={s.plantName}>{diagnosis.plantName}</Text>
          <View style={s.confidenceRow}>
            <View style={s.confidenceBar}>
              <View style={[s.confidenceFill, { width: `${diagnosis.confidence}%`, backgroundColor: condition.color }]} />
            </View>
            <Text style={s.confidenceText}>{diagnosis.confidence}% confidence</Text>
          </View>
        </Animated.View>

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
    backBtn: { flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingRight: t.space.sm },
    backText: { ...t.type.label, color: t.color.primary },
    headerTitle: { ...t.type.heading, color: t.color.foreground },
    imageWrap: { borderRadius: t.radius.xl, overflow: 'hidden', height: 240, ...t.elevation.card },
    plantImage: { width: '100%', height: '100%' },
    conditionBadge: {
      position: 'absolute',
      bottom: t.space.md,
      left: t.space.md,
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
    plantName: { ...t.type.title, fontSize: 26, lineHeight: 32, color: t.color.foreground, marginBottom: t.space.sm },
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
    descText: { ...t.type.body, fontSize: 14, lineHeight: 21, color: t.color.textSecondary },
    section: { marginTop: t.space.xl },
    sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: t.space.sm, marginBottom: t.space.md },
    sectionTitle: { ...t.type.heading, fontSize: 16, color: t.color.foreground },
    issueRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: t.space.sm, gap: t.space.md },
    issueDot: { width: 8, height: 8, borderRadius: 4, marginTop: 7 },
    issueText: { flex: 1, ...t.type.body, fontSize: 14, lineHeight: 20, color: t.color.textSecondary },
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
    treatmentTitle: { ...t.type.bodyStrong, fontSize: 15, color: t.color.foreground, marginBottom: t.space.xs },
    treatmentDesc: { ...t.type.label, fontWeight: '400', fontSize: 13, lineHeight: 19, color: t.color.textSecondary },
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
    toggleBtnActive: { borderColor: t.color.primary, backgroundColor: '#E7F6EC' },
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
