import React, { useState } from 'react';
import { Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { Theme, useTheme } from '../theme';
import { directionalIconStyle } from '../lib/rtl';
import { copy } from '../services/language';
import AuthTextField from '../components/AuthTextField';
import { requestPasswordReset } from '../services/auth';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'ForgotPassword'>;
};

export default function ForgotPasswordScreen({ navigation }: Props) {
  const t = useTheme();
  const s = React.useMemo(() => makeStyles(t), [t]);

  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSend = async () => {
    setLoading(true);
    try {
      await requestPasswordReset(email.trim());
    } catch {
      // Deliberately silent: revealing whether the email exists would leak
      // which addresses have accounts. The user sees the same confirmation
      // either way.
    } finally {
      setLoading(false);
      setSent(true);
    }
  };

  return (
    <SafeAreaView style={s.container} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <Pressable
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel={copy.auth.back}
          style={s.backBtn}
        >
          <Ionicons name="chevron-back" size={24} color={t.color.foreground} style={directionalIconStyle} />
        </Pressable>

        <Text style={s.title}>{copy.auth.resetTitle}</Text>

        {sent ? (
          <Text style={s.subtitle}>
            If an account exists for that email, a reset link is on its way. Check your inbox and
            tap the link to set a new password.
          </Text>
        ) : (
          <>
            <Text style={s.subtitle}>
              Enter your email and we'll send you a link to set a new password.
            </Text>
            <AuthTextField
              label={copy.auth.email}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              textContentType="emailAddress"
            />
            <Pressable
              style={({ pressed }) => [s.ctaBtn, pressed && s.ctaBtnPressed, (loading || !email) && s.ctaBtnDisabled]}
              onPress={handleSend}
              disabled={loading || !email}
              accessibilityRole="button"
              accessibilityLabel={copy.auth.resetA11y}
            >
              {loading ? (
                <ActivityIndicator color={t.color.onPrimary} />
              ) : (
                <Text style={s.ctaText}>{copy.auth.resetCta}</Text>
              )}
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: t.color.background },
    scroll: { padding: t.space.xl, paddingBottom: t.space['3xl'] },
    backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginStart: -t.space.sm },
    title: { ...t.type.display, color: t.color.foreground, marginTop: t.space.lg },
    subtitle: { ...t.type.body, color: t.color.textSecondary, marginTop: t.space.xs, marginBottom: t.space.xl },
    ctaBtn: {
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.color.primary,
      borderRadius: t.radius.xl,
      paddingVertical: t.space.lg,
      minHeight: 52,
      ...t.elevation.raised,
    },
    ctaBtnPressed: { backgroundColor: t.color.primaryPressed, transform: [{ scale: 0.98 }] },
    ctaBtnDisabled: { opacity: 0.6 },
    ctaText: { ...t.type.heading, color: t.color.onPrimary },
  });
}
