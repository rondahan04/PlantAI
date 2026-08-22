import React, { useState } from 'react';
import { Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { Theme, useTheme } from '../theme';
import AuthTextField from '../components/AuthTextField';
import { confirmPasswordReset, AuthServiceError } from '../services/auth';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'ResetPasswordConfirm'>;
};

/*
 * Reached only via the plantai://reset-password deep link from the reset
 * email (app.json "scheme": "plantai") - supabase-js parses the recovery
 * token out of the link and establishes a session before this screen mounts,
 * so updateUser() below just needs the new password.
 */
export default function ResetPasswordConfirmScreen({ navigation }: Props) {
  const t = useTheme();
  const s = React.useMemo(() => makeStyles(t), [t]);

  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const handleConfirm = async () => {
    setError(null);
    setLoading(true);
    try {
      await confirmPasswordReset(password);
      setDone(true);
    } catch (err) {
      setError(
        err instanceof AuthServiceError
          ? 'That reset link has expired or was already used. Request a new one.'
          : 'Something went wrong. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={s.container} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <Text style={s.title}>Set new password</Text>

        {done ? (
          <>
            <Text style={s.subtitle}>Your password has been updated.</Text>
            <Pressable
              style={({ pressed }) => [s.ctaBtn, pressed && s.ctaBtnPressed]}
              onPress={() => navigation.replace('Login')}
              accessibilityRole="button"
              accessibilityLabel="Go to login"
            >
              <Text style={s.ctaText}>Log In</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={s.subtitle}>Choose a new password for your account.</Text>
            <AuthTextField
              label="New password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              textContentType="newPassword"
              error={error ?? undefined}
            />
            <Pressable
              style={({ pressed }) => [
                s.ctaBtn,
                pressed && s.ctaBtnPressed,
                (loading || password.length < 6) && s.ctaBtnDisabled,
              ]}
              onPress={handleConfirm}
              disabled={loading || password.length < 6}
              accessibilityRole="button"
              accessibilityLabel="Set new password"
            >
              {loading ? (
                <ActivityIndicator color={t.color.onPrimary} />
              ) : (
                <Text style={s.ctaText}>Set Password</Text>
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
