import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Animated,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Location from 'expo-location';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { RootStackParamList, DeliveryMode } from '../types';
import { loadNearbyNurseries } from '../services/nurseryService';
import { colors } from '../constants/colors';

// Tel Aviv center — used as fallback when location permission is denied
const FALLBACK_LAT = 32.0853;
const FALLBACK_LNG = 34.7818;

const { width } = Dimensions.get('window');

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Diagnosis'>;
  route: RouteProp<RootStackParamList, 'Diagnosis'>;
};

const CONDITION_CONFIG = {
  healthy: { color: '#52B788', emoji: '✅', label: 'Healthy' },
  mild: { color: '#95D5B2', emoji: '🟡', label: 'Mild Issue' },
  moderate: { color: '#F4A261', emoji: '⚠️', label: 'Needs Attention' },
  severe: { color: '#E76F51', emoji: '🚨', label: 'Severe Damage' },
  critical: { color: '#E63946', emoji: '💀', label: 'Critical' },
};

export default function DiagnosisScreen({ navigation, route }: Props) {
  const { imageUri, diagnosis } = route.params;
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>('delivery');
  const [findingNurseries, setFindingNurseries] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 600, useNativeDriver: true }),
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
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        lat = loc.coords.latitude;
        lng = loc.coords.longitude;
      }
    } catch {
      // Permission denied or GPS unavailable — Tel Aviv fallback used
    } finally {
      setFindingNurseries(false);
    }

    const nurseries = loadNearbyNurseries(diagnosis.plantName, lat, lng);
    navigation.navigate('Nurseries', {
      plantName: diagnosis.plantName,
      nurseries,
      mode: deliveryMode,
    });
  };

  return (
    <LinearGradient colors={['#0A1628', '#0F2140', '#0A1628']} style={styles.container}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity style={styles.backBtn} onPress={() => navigation.navigate('Home')}>
              <Text style={styles.backText}>← Back</Text>
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Diagnosis</Text>
            <View style={{ width: 60 }} />
          </View>

          {/* Plant Image + Condition Badge */}
          <Animated.View style={{ opacity: fadeAnim }}>
            <View style={styles.imageWrap}>
              <Image source={{ uri: imageUri }} style={styles.plantImage} />
              <LinearGradient
                colors={['transparent', 'rgba(10,22,40,0.9)']}
                style={styles.imageGradient}
              />
              <View style={[styles.conditionBadge, { backgroundColor: condition.color + '25' }]}>
                <Text style={styles.conditionBadgeEmoji}>{condition.emoji}</Text>
                <Text style={[styles.conditionBadgeText, { color: condition.color }]}>
                  {diagnosis.conditionLabel}
                </Text>
              </View>
            </View>
          </Animated.View>

          {/* Plant Name + Confidence */}
          <Animated.View
            style={[styles.plantInfo, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}
          >
            <Text style={styles.plantName}>{diagnosis.plantName}</Text>
            <View style={styles.confidenceRow}>
              <View style={styles.confidenceBar}>
                <View
                  style={[
                    styles.confidenceFill,
                    {
                      width: `${diagnosis.confidence}%`,
                      backgroundColor: condition.color,
                    },
                  ]}
                />
              </View>
              <Text style={[styles.confidenceText, { color: condition.color }]}>
                {diagnosis.confidence}% confidence
              </Text>
            </View>
          </Animated.View>

          {/* Description */}
          <Animated.View
            style={[styles.descCard, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}
          >
            <LinearGradient
              colors={['rgba(45,106,79,0.15)', 'rgba(26,51,88,0.6)']}
              style={styles.descGradient}
            >
              <Text style={styles.descText}>{diagnosis.description}</Text>
            </LinearGradient>
          </Animated.View>

          {/* Issues */}
          {diagnosis.issues.length > 0 && (
            <Animated.View style={[styles.section, { opacity: fadeAnim }]}>
              <Text style={styles.sectionTitle}>🔍 Issues Detected</Text>
              {diagnosis.issues.map((issue, i) => (
                <View key={i} style={styles.issueRow}>
                  <View style={[styles.issueDot, { backgroundColor: condition.color }]} />
                  <Text style={styles.issueText}>{issue}</Text>
                </View>
              ))}
            </Animated.View>
          )}

          {/* Treatments */}
          {diagnosis.canBeSaved && diagnosis.treatments.length > 0 && (
            <Animated.View style={[styles.section, { opacity: fadeAnim }]}>
              <Text style={styles.sectionTitle}>💊 Treatment Plan</Text>
              {diagnosis.treatments.map((t, i) => (
                <View key={i} style={styles.treatmentCard}>
                  <LinearGradient
                    colors={
                      t.urgent
                        ? ['rgba(230,57,70,0.1)', 'rgba(26,51,88,0.8)']
                        : ['rgba(82,183,136,0.1)', 'rgba(26,51,88,0.8)']
                    }
                    style={styles.treatmentGradient}
                  >
                    {t.urgent && (
                      <View style={styles.urgentBadge}>
                        <Text style={styles.urgentText}>URGENT</Text>
                      </View>
                    )}
                    <Text style={styles.treatmentTitle}>{t.title}</Text>
                    <Text style={styles.treatmentDesc}>{t.description}</Text>
                  </LinearGradient>
                </View>
              ))}
            </Animated.View>
          )}

          {/* Replace Section */}
          <Animated.View style={[styles.replaceSection, { opacity: fadeAnim }]}>
            <LinearGradient
              colors={['rgba(26,51,88,0.9)', 'rgba(15,33,64,0.95)']}
              style={styles.replaceCard}
            >
              {diagnosis.canBeSaved ? (
                <Text style={styles.replaceSectionTitle}>
                  🌿 Or Replace with a Healthy One
                </Text>
              ) : (
                <Text style={styles.replaceSectionTitle}>
                  🪴 Find a Healthy Replacement
                </Text>
              )}

              {!diagnosis.canBeSaved && (
                <Text style={styles.replaceDesc}>
                  This plant is too damaged to save. Find an identical, healthy{' '}
                  {diagnosis.plantName} at nurseries near you.
                </Text>
              )}

              {/* Delivery Toggle */}
              <View style={styles.toggleRow}>
                <TouchableOpacity
                  style={[
                    styles.toggleBtn,
                    deliveryMode === 'delivery' && styles.toggleBtnActive,
                  ]}
                  onPress={() => setDeliveryMode('delivery')}
                >
                  <Text style={styles.toggleBtnIcon}>🚚</Text>
                  <Text
                    style={[
                      styles.toggleBtnText,
                      deliveryMode === 'delivery' && styles.toggleBtnTextActive,
                    ]}
                  >
                    Get it delivered today
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.toggleBtn,
                    deliveryMode === 'pickup' && styles.toggleBtnActive,
                  ]}
                  onPress={() => setDeliveryMode('pickup')}
                >
                  <Text style={styles.toggleBtnIcon}>🏪</Text>
                  <Text
                    style={[
                      styles.toggleBtnText,
                      deliveryMode === 'pickup' && styles.toggleBtnTextActive,
                    ]}
                  >
                    Pick it up
                  </Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={styles.findBtn}
                onPress={handleFindReplacement}
                disabled={findingNurseries}
              >
                <LinearGradient
                  colors={['#2D6A4F', '#40916C']}
                  style={styles.findBtnGradient}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                >
                  {findingNurseries ? (
                    <ActivityIndicator color={colors.white} />
                  ) : (
                    <Text style={styles.findBtnText}>
                      {deliveryMode === 'delivery'
                        ? '🚚 Find Delivery Options'
                        : '🏪 Find Nearby Nurseries'}
                    </Text>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            </LinearGradient>
          </Animated.View>

          {/* Scan again */}
          <TouchableOpacity
            style={styles.scanAgainBtn}
            onPress={() => navigation.navigate('Camera')}
          >
            <Text style={styles.scanAgainText}>📷 Scan Another Plant</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1 },
  scroll: { paddingBottom: 40 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  backBtn: { padding: 4 },
  backText: { color: colors.secondary, fontSize: 15, fontWeight: '600' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: colors.white },
  imageWrap: {
    marginHorizontal: 20,
    borderRadius: 20,
    overflow: 'hidden',
    height: 240,
    marginBottom: 0,
  },
  plantImage: { width: '100%', height: '100%' },
  imageGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 100,
  },
  conditionBadge: {
    position: 'absolute',
    bottom: 14,
    left: 14,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  conditionBadgeEmoji: { fontSize: 16 },
  conditionBadgeText: { fontSize: 14, fontWeight: '700' },
  plantInfo: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 8,
  },
  plantName: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.white,
    marginBottom: 10,
    letterSpacing: -0.5,
  },
  confidenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  confidenceBar: {
    flex: 1,
    height: 6,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  confidenceFill: {
    height: '100%',
    borderRadius: 3,
  },
  confidenceText: {
    fontSize: 13,
    fontWeight: '600',
  },
  descCard: {
    marginHorizontal: 20,
    marginTop: 12,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(82,183,136,0.15)',
  },
  descGradient: { padding: 16 },
  descText: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 21,
  },
  section: {
    marginHorizontal: 20,
    marginTop: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.white,
    marginBottom: 12,
  },
  issueRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
    gap: 10,
  },
  issueDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 6,
  },
  issueText: {
    flex: 1,
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  treatmentCard: {
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(82,183,136,0.15)',
  },
  treatmentGradient: { padding: 14 },
  urgentBadge: {
    backgroundColor: 'rgba(230,57,70,0.2)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginBottom: 8,
  },
  urgentText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#E63946',
    letterSpacing: 1,
  },
  treatmentTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.white,
    marginBottom: 6,
  },
  treatmentDesc: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 19,
  },
  replaceSection: {
    marginHorizontal: 20,
    marginTop: 24,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(82,183,136,0.2)',
  },
  replaceCard: { padding: 20 },
  replaceSectionTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.white,
    marginBottom: 8,
  },
  replaceDesc: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: 16,
  },
  toggleRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
    marginTop: 8,
  },
  toggleBtn: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: 'rgba(82,183,136,0.2)',
    backgroundColor: 'rgba(255,255,255,0.03)',
    gap: 6,
  },
  toggleBtnActive: {
    borderColor: colors.secondary,
    backgroundColor: 'rgba(82,183,136,0.12)',
  },
  toggleBtnIcon: { fontSize: 22 },
  toggleBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
    textAlign: 'center',
  },
  toggleBtnTextActive: { color: colors.secondary },
  findBtn: {
    borderRadius: 14,
    overflow: 'hidden',
    elevation: 4,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
  },
  findBtnGradient: {
    paddingVertical: 15,
    alignItems: 'center',
  },
  findBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.white,
  },
  scanAgainBtn: {
    marginHorizontal: 20,
    marginTop: 16,
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(82,183,136,0.3)',
  },
  scanAgainText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.secondary,
  },
});
