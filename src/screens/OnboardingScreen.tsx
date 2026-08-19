import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  Pressable,
  TextInput,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  useWindowDimensions,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useCameraPermissions } from 'expo-camera';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { RootStackParamList } from '../types';
import { Theme, useTheme } from '../theme';
import { APP_LOGO } from '../brand';
import { FEATURES } from '../content/features';
import { onboarding } from '../services/onboarding';
import { MAX_NAME_LENGTH } from '../services/onboardingStore';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Onboarding'>;
};

/*
 * First-run onboarding.
 *
 * ONE screen with internal steps rather than four stack routes. The hardware
 * back gesture must step backwards *inside* onboarding, and stack routes would
 * make it pop out to whatever is underneath — which, on a first run, is nothing.
 *
 * Three beats and out: who you are (name) → what the app does (slides) → the
 * one permission the very next screen needs (camera). The greeting leads so the
 * rest of onboarding can address the user by name rather than opening on a
 * marketing pitch. Notifications are NOT
 * asked here: a permission requested before the user owns a single plant is a
 * "no" you can never re-ask for, so that prompt lives at the first watering
 * reminder, where the reason for it is on screen.
 *
 * Every step is skippable and no step can dead-end. The user reaches Home from
 * any point, with or without a name, with or without the camera.
 */

type Step = 'name' | 'slides' | 'camera';

export default function OnboardingScreen({ navigation }: Props) {
  const t = useTheme();
  const { width } = useWindowDimensions();
  const s = useMemo(() => makeStyles(t), [t]);

  const [step, setStep] = useState<Step>('name');
  const [slide, setSlide] = useState(0);
  const [name, setName] = useState('');
  const [asking, setAsking] = useState(false);

  const pager = useRef<FlatList>(null);
  const [permission, requestPermission] = useCameraPermissions();

  /*
   * Leave onboarding. `replace`, not `navigate`: onboarding must not sit under
   * Home in the stack where a back gesture could return to it.
   *
   * A failed write is deliberately NOT blocking. There is no action the user
   * could take, and refusing to let them into the app over a storage error
   * would turn a repeated intro into no app at all. The cost of the failure is
   * that onboarding replays next launch.
   */
  const finish = useCallback(
    (withName?: string) => {
      onboarding.complete(withName);
      navigation.replace('Home');
    },
    [navigation]
  );

  const goToSlide = useCallback(
    (index: number) => {
      pager.current?.scrollToOffset({ offset: index * width, animated: true });
      setSlide(index);
    },
    [width]
  );

  /*
   * Track the page from the scroll offset rather than from the button, so the
   * dots stay honest when the user swipes instead of tapping.
   */
  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const index = Math.round(e.nativeEvent.contentOffset.x / width);
      if (index !== slide) setSlide(index);
    },
    [slide, width]
  );

  /*
   * Straight to Home when the camera is already granted — a user who reinstalls
   * and re-allows should never be asked to allow what they already allowed.
   */
  const afterSlides = useCallback(() => {
    if (permission?.granted) finish(name);
    else setStep('camera');
  }, [permission, finish, name]);

  const allowCamera = useCallback(async () => {
    setAsking(true);
    try {
      // The result is not branched on: denial is not a dead end. CameraScreen
      // has its own permission state and re-asks there, with the viewfinder
      // it needs the camera for visible behind the ask.
      await requestPermission();
    } finally {
      setAsking(false);
      finish(name);
    }
  }, [requestPermission, finish, name]);

  return (
    <SafeAreaView style={s.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={s.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header: identity on every step, plus the escape hatch. */}
        <View style={s.header}>
          <View style={s.brand}>
            <Image source={APP_LOGO} style={s.logoIcon} accessibilityIgnoresInvertColors />
            <Text style={s.brandText}>PlantAI</Text>
          </View>
          <Pressable
            onPress={() => finish(name)}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Skip onboarding and go to the app"
          >
            <Text style={s.skip}>Skip</Text>
          </Pressable>
        </View>

        {step === 'slides' && (
          <>
            <FlatList
              ref={pager}
              data={FEATURES}
              keyExtractor={(f) => f.title}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onScroll={onScroll}
              scrollEventThrottle={16}
              /* Fixed page width — the pager must not guess at layout time. */
              getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
              renderItem={({ item }) => (
                <View style={[s.slide, { width }]}>
                  <View style={s.slideIcon}>
                    <Ionicons name={item.icon} size={48} color={t.color.primary} />
                  </View>
                  <Text style={s.slideTitle}>{item.title}</Text>
                  <Text style={s.slideBlurb}>{item.blurb}</Text>
                </View>
              )}
            />

            <View style={s.dots} accessibilityRole="tablist">
              {FEATURES.map((f, i) => (
                <View
                  key={f.title}
                  style={[s.dot, i === slide && s.dotActive]}
                  accessibilityRole="tab"
                  accessibilityLabel={`Step ${i + 1} of ${FEATURES.length}`}
                  accessibilityState={{ selected: i === slide }}
                />
              ))}
            </View>

            <View style={s.footer}>
              <PrimaryButton
                t={t}
                s={s}
                label={slide === FEATURES.length - 1 ? 'Get Started' : 'Next'}
                onPress={() => (slide === FEATURES.length - 1 ? afterSlides() : goToSlide(slide + 1))}
              />
            </View>
          </>
        )}

        {step === 'name' && (
          <>
            <View style={s.step}>
              <View style={s.slideIcon}>
                <Ionicons name="happy-outline" size={48} color={t.color.primary} />
              </View>
              <Text style={s.slideTitle}>Hello,{'\n'}what should we call you?</Text>
              <Text style={s.slideBlurb}>
                Only used to greet you in the app. It stays on this device — there is no account
                and nothing is sent anywhere.
              </Text>

              <TextInput
                style={s.input}
                value={name}
                onChangeText={setName}
                placeholder="Your name"
                placeholderTextColor={t.color.textMuted}
                maxLength={MAX_NAME_LENGTH}
                autoFocus
                autoCapitalize="words"
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={() => setStep('slides')}
                accessibilityLabel="Your name, optional"
              />
            </View>

            <View style={s.footer}>
              <PrimaryButton t={t} s={s} label="Continue" onPress={() => setStep('slides')} />
              <Pressable
                /* Discards anything half-typed — "not now" means no name, not
                   whatever was left in the field. */
                onPress={() => {
                  setName('');
                  setStep('slides');
                }}
                style={s.ghostBtn}
                accessibilityRole="button"
                accessibilityLabel="Continue without giving a name"
              >
                <Text style={s.ghostText}>Not now</Text>
              </Pressable>
            </View>
          </>
        )}

        {step === 'camera' && (
          <>
            <View style={s.step}>
              <View style={s.slideIcon}>
                <Ionicons name="camera-outline" size={48} color={t.color.primary} />
              </View>
              <Text style={s.slideTitle}>
                {name ? `One thing, ${name}` : 'One last thing'}
              </Text>
              <Text style={s.slideBlurb}>
                A diagnosis starts with a photo of your plant, so PlantAI needs the camera. Photos
                are used for the diagnosis and stay with the plant in your library.
              </Text>
            </View>

            <View style={s.footer}>
              <PrimaryButton
                t={t}
                s={s}
                label={asking ? 'Waiting…' : 'Allow camera'}
                onPress={allowCamera}
                disabled={asking}
              />
              <Pressable
                onPress={() => finish(name)}
                style={s.ghostBtn}
                accessibilityRole="button"
                accessibilityLabel="Continue without camera access for now"
              >
                <Text style={s.ghostText}>Not now</Text>
              </Pressable>
            </View>
          </>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function PrimaryButton({
  t,
  s,
  label,
  onPress,
  disabled,
}: {
  t: Theme;
  s: ReturnType<typeof makeStyles>;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      style={({ pressed }) => [s.cta, pressed && s.ctaPressed, disabled && s.ctaDisabled]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
    >
      <Text style={s.ctaText}>{label}</Text>
      <Ionicons name="arrow-forward" size={20} color={t.color.onPrimary} />
    </Pressable>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    flex: { flex: 1 },
    container: { flex: 1, backgroundColor: t.color.background },

    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: t.space.xl,
      paddingTop: t.space.lg,
    },
    brand: { flexDirection: 'row', alignItems: 'center', gap: t.space.sm },
    /* The logo carries its own ground — a clipping frame, not a tile. */
    logoIcon: { width: 32, height: 32, borderRadius: t.radius.sm, overflow: 'hidden' },
    brandText: { ...t.type.heading, color: t.color.foreground },
    skip: { ...t.type.label, color: t.color.textSecondary },

    /* Pages are laid out at the measured window width, set inline. */
    slide: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: t.space.xl,
    },
    step: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: t.space.xl,
    },
    slideIcon: {
      width: 96,
      height: 96,
      borderRadius: t.radius.pill,
      backgroundColor: t.color.primaryWash,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: t.space.xl,
    },
    slideTitle: {
      ...t.type.display,
      color: t.color.foreground,
      textAlign: 'center',
      marginBottom: t.space.md,
    },
    slideBlurb: {
      ...t.type.body,
      color: t.color.textSecondary,
      textAlign: 'center',
      maxWidth: 340,
    },

    input: {
      ...t.type.body,
      color: t.color.foreground,
      backgroundColor: t.color.surface,
      borderWidth: 1,
      borderColor: t.color.border,
      borderRadius: t.radius.lg,
      paddingHorizontal: t.space.lg,
      paddingVertical: t.space.md,
      marginTop: t.space.xl,
      width: '100%',
      maxWidth: 340,
      textAlign: 'center',
    },

    dots: { flexDirection: 'row', justifyContent: 'center', gap: t.space.sm, paddingVertical: t.space.lg },
    dot: { width: 8, height: 8, borderRadius: t.radius.pill, backgroundColor: t.color.border },
    dotActive: { width: 24, backgroundColor: t.color.primary },

    footer: { paddingHorizontal: t.space.xl, paddingBottom: t.space.xl, gap: t.space.sm },
    cta: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: t.space.sm,
      backgroundColor: t.color.primary,
      borderRadius: t.radius.pill,
      paddingVertical: t.space.lg,
      ...t.elevation.card,
    },
    ctaPressed: { backgroundColor: t.color.primaryPressed },
    ctaDisabled: { opacity: 0.6 },
    ctaText: { ...t.type.bodyStrong, color: t.color.onPrimary },

    ghostBtn: { alignItems: 'center', paddingVertical: t.space.md },
    ghostText: { ...t.type.label, color: t.color.textSecondary },
  });
}
