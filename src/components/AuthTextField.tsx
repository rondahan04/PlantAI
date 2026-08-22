import React from 'react';
import { View, Text, TextInput, StyleSheet, TextInputProps } from 'react-native';
import { Theme, useTheme } from '../theme';

/*
 * Shared labeled input for Login/Signup/ForgotPassword/ResetPasswordConfirm/
 * Settings - the five auth/profile screens all need the same label + input +
 * inline-error shape, so it lives once here instead of five times.
 */
export default function AuthTextField({
  label,
  error,
  ...inputProps
}: TextInputProps & { label: string; error?: string }) {
  const t = useTheme();
  const s = React.useMemo(() => makeStyles(t), [t]);

  return (
    <View style={s.wrap}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        style={[s.input, error && s.inputError]}
        placeholderTextColor={t.color.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel={label}
        {...inputProps}
      />
      {error ? <Text style={s.errorText}>{error}</Text> : null}
    </View>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    wrap: { marginBottom: t.space.lg },
    label: { ...t.type.label, color: t.color.textSecondary, marginBottom: t.space.xs },
    input: {
      ...t.type.body,
      color: t.color.foreground,
      backgroundColor: t.color.surface,
      borderWidth: 1,
      borderColor: t.color.border,
      borderRadius: t.radius.lg,
      paddingHorizontal: t.space.md,
      minHeight: 48,
      writingDirection: 'auto',
    },
    inputError: { borderColor: t.color.danger },
    errorText: { ...t.type.caption, color: t.color.danger, marginTop: t.space.xs },
  });
}
