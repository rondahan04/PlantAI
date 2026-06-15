import React, { useRef, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Animated,
  ScrollView,
  AccessibilityInfo,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { Theme, useTheme } from '../theme';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Home'>;
};

type IconName = keyof typeof Ionicons.glyphMap;

const FEATURES: { icon: IconName; title: string; desc: string }[] = [
  { icon: 'scan-outline', title: 'Snap & Diagnose', desc: 'AI identifies what is hurting your plant instantly' },
  { icon: 'storefront-outline', title: 'Find Replacements', desc: 'Locate healthy plants at nurseries near you' },
  { icon: 'car-outline', title: 'Deliver or Pickup', desc: 'Get it today — delivered or ready to collect' },
];

export default function HomeScreen({ navigation }: Props) {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(40)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 400, useNativeDriver: true }),
    ]).start();

    // Ambient CTA pulse — respect reduced-motion (a11y: reduced-motion).
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

  return (
    <SafeAreaView style={s.container} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <Animated.View style={[s.header, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          <View style={s.logoIcon}>
            <Ionicons name="leaf" size={24} color={t.color.onPrimary} />
          </View>
          <View>
            <Text style={s.logoText}>PlantAI</Text>
            <Text style={s.logoSub}>Plant Doctor</Text>
          </View>
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

        {/* Primary CTA (the one accent action on this screen) */}
        <Animated.View style={[s.ctaWrap, { opacity: fadeAnim, transform: [{ scale: pulseAnim }] }]}>
          <Pressable
            style={({ pressed }) => [s.ctaBtn, pressed && s.ctaBtnPressed]}
            onPress={() => navigation.navigate('Camera')}
            accessibilityRole="button"
            accessibilityLabel="Diagnose my plant — open the camera"
          >
            <Ionicons name="camera" size={22} color={t.color.onPrimary} />
            <Text style={s.ctaText}>Diagnose My Plant</Text>
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
          <Text style={s.bottomNote}>Powered by Claude AI · Works with 1000+ plant species</Text>
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: t.color.background },
    scroll: { paddingBottom: t.space['2xl'], paddingHorizontal: t.space.xl },
    header: { flexDirection: 'row', alignItems: 'center', gap: t.space.md, paddingTop: t.space.lg, paddingBottom: t.space.sm },
    logoIcon: {
      width: 44,
      height: 44,
      borderRadius: t.radius.md,
      backgroundColor: t.color.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    logoText: { ...t.type.title, color: t.color.foreground },
    logoSub: { ...t.type.caption, color: t.color.secondary },

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

    ctaWrap: { marginBottom: t.space['2xl'] },
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
