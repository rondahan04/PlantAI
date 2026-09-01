import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { RootStackParamList } from '../types';
import { Theme, useTheme } from '../theme';
import { copy } from '../services/language';
import AuthTextField from '../components/AuthTextField';
import { updateProfile, DuplicateUsernameError } from '../services/auth';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'EditProfileField'>;
  route: RouteProp<RootStackParamList, 'EditProfileField'>;
};

const FIELD_META = {
  full_name: {
    title: copy.settings.fullName,
    label: copy.settings.fullName,
    autoCapitalize: 'words' as const,
    required: true,
  },
  username: {
    title: copy.settings.username,
    label: copy.settings.username,
    autoCapitalize: 'none' as const,
    required: true,
  },
  bio: {
    title: copy.settings.bio,
    label: copy.settings.bio,
    autoCapitalize: 'sentences' as const,
    required: false,
  },
};

export default function EditProfileFieldScreen({ navigation, route }: Props) {
  const { field, current } = route.params;
  const meta = FIELD_META[field];

  const t = useTheme();
  const s = React.useMemo(() => makeStyles(t), [t]);

  const [value, setValue] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      await updateProfile({ [field]: value.trim() });
      navigation.goBack();
    } catch (err) {
      setError(
        field === 'username' && err instanceof DuplicateUsernameError
          ? copy.settings.usernameTaken
          : copy.settings.saveFailed
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={s.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.header}>
          <Pressable onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel={copy.settings.back} style={s.backBtn}>
            <Ionicons name="chevron-back" size={24} color={t.color.primary} />
          </Pressable>
          <Text style={s.headerTitle}>{meta.title}</Text>
          <View style={s.backBtn} />
        </View>

        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          <AuthTextField
            label={meta.label}
            value={value}
            onChangeText={setValue}
            autoCapitalize={meta.autoCapitalize}
            autoFocus
            error={error ?? undefined}
            multiline={field === 'bio'}
          />
          <Pressable
            style={({ pressed }) => [
              s.saveBtn,
              pressed && s.saveBtnPressed,
              (saving || (meta.required && !value.trim())) && s.disabled,
            ]}
            onPress={handleSave}
            disabled={saving || (meta.required && !value.trim())}
            accessibilityRole="button"
            accessibilityLabel={copy.settings.save}
          >
            {saving ? <ActivityIndicator color={t.color.onPrimary} /> : <Text style={s.saveBtnText}>{copy.settings.save}</Text>}
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
