import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { Theme, useTheme } from '../theme';
import { copy } from '../services/language';
import AuthTextField from '../components/AuthTextField';
import { signIn, AuthServiceError } from '../services/auth';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Login'>;
};

export default function LoginScreen({ navigation }: Props) {
  const t = useTheme();
  const s = React.useMemo(() => makeStyles(t), [t]);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setError(null);
    setLoading(true);
    try {
      await signIn(email.trim(), password);
      navigation.replace('Home');
    } catch (err) {
      // Auth is opt-in and provider text never reaches the user - a wrong
      // password and a service outage should read identically here.
      setError(
        err instanceof AuthServiceError
          ? copy.auth.wrongCredentials
          : copy.auth.generic
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={s.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          <Pressable
            onPress={() => navigation.goBack()}
            accessibilityRole="button"
            accessibilityLabel={copy.auth.back}
            style={s.backBtn}
          >
            <Ionicons name="chevron-back" size={24} color={t.color.foreground} />
          </Pressable>

          <Text style={s.title}>{copy.auth.loginTitle}</Text>
          <Text style={s.subtitle}>{copy.auth.loginSubtitle}</Text>

          <AuthTextField
            label={copy.auth.email}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            textContentType="emailAddress"
          />
          <AuthTextField
            label={copy.auth.password}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            textContentType="password"
          />

          {error ? <Text style={s.formError}>{error}</Text> : null}

          <Pressable
            style={({ pressed }) => [s.ctaBtn, pressed && s.ctaBtnPressed, loading && s.ctaBtnDisabled]}
            onPress={handleLogin}
            disabled={loading || !email || !password}
            accessibilityRole="button"
            accessibilityLabel={copy.auth.loginA11y}
          >
            {loading ? (
              <ActivityIndicator color={t.color.onPrimary} />
            ) : (
              <Text style={s.ctaText}>{copy.auth.loginCta}</Text>
            )}
          </Pressable>

          <Pressable
            onPress={() => navigation.navigate('ForgotPassword')}
            accessibilityRole="button"
            style={s.linkBtn}
          >
            <Text style={s.linkText}>{copy.auth.forgotPassword}</Text>
          </Pressable>

          <Pressable
            onPress={() => navigation.navigate('Signup')}
            accessibilityRole="button"
            style={s.linkBtn}
          >
            <Text style={s.linkText}>
              No account? <Text style={s.linkTextStrong}>{copy.auth.signupLink}</Text>
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
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
    formError: { ...t.type.label, color: t.color.danger, marginBottom: t.space.md },
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
    linkBtn: { marginTop: t.space.lg, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
    linkText: { ...t.type.label, color: t.color.textSecondary },
    linkTextStrong: { color: t.color.primary, fontWeight: '700' },
  });
}
