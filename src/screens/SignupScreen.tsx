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
import { directionalIconStyle } from '../lib/rtl';
import { copy } from '../services/language';
import AuthTextField from '../components/AuthTextField';
import { signUp, DuplicateUsernameError, DuplicateEmailError, AuthServiceError } from '../services/auth';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Signup'>;
};

export default function SignupScreen({ navigation }: Props) {
  const t = useTheme();
  const s = React.useMemo(() => makeStyles(t), [t]);

  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSignup = async () => {
    setUsernameError(null);
    setEmailError(null);
    setFormError(null);
    setLoading(true);
    try {
      await signUp({
        email: email.trim(),
        password,
        username: username.trim(),
        fullName: fullName.trim(),
      });
      navigation.replace('Home');
    } catch (err) {
      if (err instanceof DuplicateUsernameError) {
        setUsernameError(copy.auth.usernameTaken);
      } else if (err instanceof DuplicateEmailError) {
        setEmailError(copy.auth.emailTaken);
      } else if (err instanceof AuthServiceError) {
        setFormError(err.detail.length < 120 ? err.detail : copy.auth.signupFailed);
      } else {
        setFormError(copy.auth.generic);
      }
    } finally {
      setLoading(false);
    }
  };

  const canSubmit = fullName && username && email && password.length >= 6;

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
            <Ionicons name="chevron-back" size={24} color={t.color.foreground} style={directionalIconStyle} />
          </Pressable>

          <Text style={s.title}>{copy.auth.signupTitle}</Text>
          <Text style={s.subtitle}>{copy.auth.signupSubtitle}</Text>

          <AuthTextField label={copy.auth.fullName} value={fullName} onChangeText={setFullName} autoCapitalize="words" />
          <AuthTextField
            label={copy.auth.username}
            value={username}
            onChangeText={setUsername}
            error={usernameError ?? undefined}
          />
          <AuthTextField
            label={copy.auth.email}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            textContentType="emailAddress"
            error={emailError ?? undefined}
          />
          <AuthTextField
            label={copy.auth.password}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            textContentType="newPassword"
          />

          {formError ? <Text style={s.formError}>{formError}</Text> : null}

          <Pressable
            style={({ pressed }) => [s.ctaBtn, pressed && s.ctaBtnPressed, (loading || !canSubmit) && s.ctaBtnDisabled]}
            onPress={handleSignup}
            disabled={loading || !canSubmit}
            accessibilityRole="button"
            accessibilityLabel={copy.auth.signupA11y}
          >
            {loading ? (
              <ActivityIndicator color={t.color.onPrimary} />
            ) : (
              <Text style={s.ctaText}>{copy.auth.signupCta}</Text>
            )}
          </Pressable>

          <Pressable
            onPress={() => navigation.navigate('Login')}
            accessibilityRole="button"
            style={s.linkBtn}
          >
            <Text style={s.linkText}>
              Already have an account? <Text style={s.linkTextStrong}>{copy.auth.loginLink}</Text>
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
