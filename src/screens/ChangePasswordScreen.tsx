import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { Theme, useTheme } from '../theme';
import { directionalIconStyle } from '../lib/rtl';
import { copy } from '../services/language';
import AuthTextField from '../components/AuthTextField';
import { changePassword } from '../services/auth';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'ChangePassword'>;
};

export default function ChangePasswordScreen({ navigation }: Props) {
  const t = useTheme();
  const s = React.useMemo(() => makeStyles(t), [t]);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      await changePassword(currentPassword, newPassword);
      navigation.goBack();
    } catch {
      setError(copy.auth.currentPasswordWrong);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={s.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.header}>
          <Pressable onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel={copy.auth.back} style={s.backBtn}>
            <Ionicons name="chevron-back" size={24} color={t.color.primary} style={directionalIconStyle} />
          </Pressable>
          <Text style={s.headerTitle}>{copy.auth.changePasswordTitle}</Text>
          <View style={s.backBtn} />
        </View>

        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          <AuthTextField
            label={copy.auth.currentPassword}
            value={currentPassword}
            onChangeText={setCurrentPassword}
            secureTextEntry
            error={error ?? undefined}
          />
          <AuthTextField label={copy.auth.newPassword} value={newPassword} onChangeText={setNewPassword} secureTextEntry />
          <Pressable
            style={({ pressed }) => [
              s.saveBtn,
              pressed && s.saveBtnPressed,
              (saving || !currentPassword || newPassword.length < 6) && s.disabled,
            ]}
            onPress={handleSave}
            disabled={saving || !currentPassword || newPassword.length < 6}
            accessibilityRole="button"
            accessibilityLabel={copy.auth.changePasswordA11y}
          >
            {saving ? <ActivityIndicator color={t.color.onPrimary} /> : <Text style={s.saveBtnText}>{copy.auth.changePasswordCta}</Text>}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: t.color.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: t.space.sm,
      paddingTop: t.space.sm,
      paddingBottom: t.space.sm,
    },
    backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { ...t.type.heading, color: t.color.foreground },
    scroll: { padding: t.space.xl, paddingBottom: t.space['3xl'] },
    saveBtn: {
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.color.primary,
      borderRadius: t.radius.xl,
      paddingVertical: t.space.lg,
      minHeight: 52,
      ...t.elevation.raised,
    },
    saveBtnPressed: { backgroundColor: t.color.primaryPressed, transform: [{ scale: 0.98 }] },
    saveBtnText: { ...t.type.heading, color: t.color.onPrimary },
    disabled: { opacity: 0.6 },
  });
}
