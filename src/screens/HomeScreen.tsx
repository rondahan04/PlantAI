import React, { useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  ScrollView,
  Dimensions,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { colors } from '../constants/colors';

const { width, height } = Dimensions.get('window');

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Home'>;
};

const FEATURES = [
  {
    icon: '📸',
    title: 'Snap & Diagnose',
    desc: 'AI identifies what\'s killing your plant instantly',
  },
  {
    icon: '🏪',
    title: 'Find Replacements',
    desc: 'Locate healthy plants at nurseries near you',
  },
  {
    icon: '🚚',
    title: 'Deliver or Pickup',
    desc: 'Get it today — delivered or ready to collect',
  },
];

export default function HomeScreen({ navigation }: Props) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(40)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const floatAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 800,
        useNativeDriver: true,
      }),
    ]).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.05,
          duration: 1500,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1500,
          useNativeDriver: true,
        }),
      ])
    ).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(floatAnim, {
          toValue: -8,
          duration: 2000,
          useNativeDriver: true,
        }),
        Animated.timing(floatAnim, {
          toValue: 0,
          duration: 2000,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, []);

  return (
    <LinearGradient colors={['#0A1628', '#0F2140', '#0A1628']} style={styles.container}>
      <SafeAreaView style={styles.safe}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <Animated.View
            style={[
              styles.header,
              { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
            ]}
          >
            <View style={styles.logoRow}>
              <LinearGradient
                colors={['#2D6A4F', '#40916C']}
                style={styles.logoIcon}
              >
                <Text style={styles.logoEmoji}>🌿</Text>
              </LinearGradient>
              <View>
                <Text style={styles.logoText}>PlantAI</Text>
                <Text style={styles.logoSub}>Plant Doctor</Text>
              </View>
            </View>
          </Animated.View>

          {/* Hero */}
          <Animated.View
            style={[
              styles.hero,
              { opacity: fadeAnim, transform: [{ translateY: floatAnim }] },
            ]}
          >
            <LinearGradient
              colors={['rgba(45,106,79,0.2)', 'rgba(64,145,108,0.1)']}
              style={styles.heroCard}
            >
              <Text style={styles.heroEmoji}>🌱</Text>
              <Text style={styles.heroTitle}>Is Your Plant{'\n'}in Trouble?</Text>
              <Text style={styles.heroSub}>
                Snap a photo. Get a diagnosis in seconds.{'\n'}
                Find a healthy replacement if needed.
              </Text>
            </LinearGradient>
          </Animated.View>

          {/* CTA Button */}
          <Animated.View
            style={[
              styles.ctaWrap,
              {
                opacity: fadeAnim,
                transform: [{ scale: pulseAnim }],
              },
            ]}
          >
            <TouchableOpacity
              style={styles.ctaBtn}
              onPress={() => navigation.navigate('Camera')}
              activeOpacity={0.85}
            >
              <LinearGradient
                colors={['#2D6A4F', '#40916C']}
                style={styles.ctaGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
              >
                <Text style={styles.ctaIcon}>📷</Text>
                <Text style={styles.ctaText}>Diagnose My Plant</Text>
              </LinearGradient>
            </TouchableOpacity>
          </Animated.View>

          {/* Features */}
          <Animated.View
            style={[
              styles.features,
              { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
            ]}
          >
            <Text style={styles.featuresTitle}>How It Works</Text>
            {FEATURES.map((f, i) => (
              <View key={i} style={styles.featureCard}>
                <LinearGradient
                  colors={['rgba(45,106,79,0.15)', 'rgba(26,51,88,0.8)']}
                  style={styles.featureGradient}
                >
                  <View style={styles.featureIconWrap}>
                    <Text style={styles.featureIcon}>{f.icon}</Text>
                  </View>
                  <View style={styles.featureText}>
                    <Text style={styles.featureTitle}>{f.title}</Text>
                    <Text style={styles.featureDesc}>{f.desc}</Text>
                  </View>
                  <View style={styles.featureStep}>
                    <Text style={styles.featureStepText}>{i + 1}</Text>
                  </View>
                </LinearGradient>
              </View>
            ))}
          </Animated.View>

          {/* Bottom note */}
          <Animated.View style={{ opacity: fadeAnim, marginBottom: 20 }}>
            <Text style={styles.bottomNote}>
              Powered by Claude AI · Works with 1000+ plant species
            </Text>
          </Animated.View>
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
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 8,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  logoIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoEmoji: { fontSize: 24 },
  logoText: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.white,
    letterSpacing: -0.5,
  },
  logoSub: {
    fontSize: 12,
    color: colors.secondary,
    fontWeight: '500',
  },
  hero: {
    marginHorizontal: 24,
    marginTop: 24,
    marginBottom: 28,
  },
  heroCard: {
    borderRadius: 24,
    padding: 28,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(82, 183, 136, 0.2)',
  },
  heroEmoji: { fontSize: 64, marginBottom: 16 },
  heroTitle: {
    fontSize: 32,
    fontWeight: '800',
    color: colors.white,
    textAlign: 'center',
    lineHeight: 38,
    marginBottom: 12,
    letterSpacing: -1,
  },
  heroSub: {
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  ctaWrap: {
    paddingHorizontal: 24,
    marginBottom: 36,
  },
  ctaBtn: {
    borderRadius: 18,
    overflow: 'hidden',
    elevation: 8,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
  },
  ctaGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
    gap: 10,
  },
  ctaIcon: { fontSize: 22 },
  ctaText: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.white,
    letterSpacing: -0.3,
  },
  features: {
    paddingHorizontal: 24,
    marginBottom: 8,
  },
  featuresTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.white,
    marginBottom: 16,
    letterSpacing: -0.3,
  },
  featureCard: {
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(82, 183, 136, 0.15)',
  },
  featureGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 14,
  },
  featureIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(45,106,79,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureIcon: { fontSize: 22 },
  featureText: { flex: 1 },
  featureTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.white,
    marginBottom: 2,
  },
  featureDesc: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  featureStep: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(45,106,79,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(82,183,136,0.3)',
  },
  featureStepText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.secondary,
  },
  bottomNote: {
    textAlign: 'center',
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 8,
  },
});
