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
import { plantLibrary } from '../services/plantLibrary';
import { triageSections } from '../lib/triage';
import { APP_LOGO } from '../brand';
import { FEATURES } from '../content/features';
import { onboarding } from '../services/onboarding';
import PlantCard from '../components/PlantCard';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Home'>;
};

export default function HomeScreen({ navigation }: Props) {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);

  /*
   * Adaptive Home (D8/H2): marketing copy on first run, library once a plant
   * is saved.
   *
   * The lazy useState initializer is the whole reason the store is
   * synchronous. Reading in an effect would render the first-run layout for a
   * frame and then swap it, so a returning user would see marketing content
   * flash before their own plants. This runs during the first render instead,
   * so the correct layout is the only one ever painted.
   */
  const [library, setLibrary] = useState(() => plantLibrary.load());

  /*
   * The name from onboarding, read synchronously for the same reason the
   * library is: the header would otherwise render "Plant Doctor" and then swap
   * to the greeting a frame later. Read once — it cannot change while the app
   * is running, since onboarding only precedes Home.
   */
  const [profileName] = useState(() => onboarding.load()?.name);

  // A plant saved on the Diagnosis screen has to appear on the way back.
  useFocusEffect(
    useCallback(() => {
      setLibrary(plantLibrary.load());
    }, [])
  );

  const sections = useMemo(() => triageSections(library.plants), [library]);
  const hasPlants = library.plants.length > 0;

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

  /*
   * Returning-user layout. The design review's "do not touch Home" rule was
   * about not degrading the first-run screen, which is why that branch below
   * is untouched — this is a second layout holding the same tokens on purpose
   * rather than by inheritance.
   */
  if (hasPlants || library.ok === false) {
    return (
      <SafeAreaView style={s.container} edges={['top', 'bottom']}>
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
                <View>
                  <Text style={s.logoText}>PlantAI</Text>
                  <Text style={s.logoSub}>
                    {profileName ? `${profileName}'s plants` : 'Plant Doctor'}
                  </Text>
                </View>
              </View>

              {/*
                A damaged library must never be reported as an empty one —
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

              <Text style={s.libTitle}>My Plants</Text>
            </>
          }
          renderSectionHeader={({ section }) => (
            <Text style={s.sectionHeader}>{section.title}</Text>
          )}
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
              accessibilityLabel="Diagnose another plant — open the camera"
            >
              <Ionicons name="camera" size={22} color={t.color.onPrimary} />
              <Text style={s.ctaText}>Diagnose Another Plant</Text>
            </Pressable>
          }
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <Animated.View style={[s.header, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          <Image source={APP_LOGO} style={s.logoIcon} accessibilityIgnoresInvertColors />
          <View>
            <Text style={s.logoText}>PlantAI</Text>
            <Text style={s.logoSub}>{profileName ? `Hello, ${profileName}` : 'Plant Doctor'}</Text>
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
    libScroll: { paddingBottom: t.space['2xl'], paddingHorizontal: t.space.xl },
    libTitle: { ...t.type.title, color: t.color.foreground, marginTop: t.space.lg, marginBottom: t.space.sm },
    // Sections carry the grouping, so headers stay quiet — the condition
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
    warnCard: {
      flexDirection: 'row',
      backgroundColor: t.color.warningWash,
      borderRadius: t.radius.lg,
      padding: t.space.md,
      marginTop: t.space.md,
    },
    warnBody: { flex: 1, marginLeft: t.space.sm },
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
