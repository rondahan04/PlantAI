import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { RootStackParamList } from '../types';
import { Theme, useTheme } from '../theme';
import SettingsCard from '../components/SettingsCard';
import SettingsRow from '../components/SettingsRow';
import { copy, getLanguage } from '../services/language';
import { getProfile, Profile } from '../services/auth';
import { supabase } from '../services/supabase';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Settings'>;
};

export default function SettingsScreen({ navigation }: Props) {
  const t = useTheme();
  const s = React.useMemo(() => makeStyles(t), [t]);

  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  // Re-read on every focus, not just mount - returning from EditProfileField/
  // ManageAccount (rename, logout, delete) must reflect immediately, and this
  // screen has no other way to learn a push-screen changed something.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const { data } = await supabase.auth.getSession();
        if (cancelled) return;
        setEmail(data.session?.user.email ?? null);
        setProfile(data.session ? await getProfile() : null);
        if (!cancelled) setLoading(false);
      })();
      return () => {
        cancelled = true;
      };
    }, [])
  );

  if (loading) {
    return (
      <SafeAreaView style={[s.container, s.centered]} edges={['top', 'bottom']}>
        <ActivityIndicator color={t.color.primary} />
      </SafeAreaView>
    );
  }

  if (!email || !profile) {
    return (
      <SafeAreaView style={s.container} edges={['top', 'bottom']}>
        <View style={s.header}>
          <Pressable onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel={copy.settings.back} style={s.backBtn}>
            <Ionicons name="chevron-back" size={24} color={t.color.primary} />
          </Pressable>
          <Text style={s.headerTitle}>{copy.settings.profileSettings}</Text>
          <View style={s.backBtn} />
        </View>
        <View style={s.loggedOutBody}>
          <Text style={s.loggedOutText}>
            Create an account to save your profile and manage your details. Diagnosis works fine
            without one.
          </Text>
          <Pressable
            style={({ pressed }) => [s.ctaBtn, pressed && s.ctaBtnPressed]}
            onPress={() => navigation.navigate('Login')}
            accessibilityRole="button"
            accessibilityLabel={copy.settings.loginPromptA11y}
          >
            <Text style={s.ctaText}>{copy.settings.loginPrompt}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container} edges={['top', 'bottom']}>
      <View style={s.header}>
        <Pressable onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel={copy.settings.back} style={s.backBtn}>
          <Ionicons name="chevron-back" size={24} color={t.color.primary} />
        </Pressable>
        <Text style={s.headerTitle}>{copy.settings.profileSettings}</Text>
        <View style={s.backBtn} />
      </View>

      <ScrollView contentContainerStyle={s.scroll}>
        <View style={s.avatarWrap}>
          <View style={s.avatarCircle}>
            <Ionicons name="person-add-outline" size={32} color={t.color.onPrimary} />
          </View>
        </View>

        <SettingsCard>
          <SettingsRow
            icon="person-outline"
            label={copy.settings.fullName}
            onPress={() =>
              navigation.navigate('EditProfileField', { field: 'full_name', current: profile.full_name ?? '' })
            }
          />
          <SettingsRow
            icon="person-outline"
            label={copy.settings.username}
            value={profile.username}
            onPress={() => navigation.navigate('EditProfileField', { field: 'username', current: profile.username })}
          />
          <SettingsRow icon="mail-outline" label={copy.settings.emailAddress} value={email} showChevron={false} />
          <SettingsRow
            icon="chatbubble-ellipses-outline"
            label={copy.settings.bio}
            value={profile.bio ?? undefined}
            onPress={() => navigation.navigate('EditProfileField', { field: 'bio', current: profile.bio ?? '' })}
          />
        </SettingsCard>

        <SettingsCard>
          <SettingsRow
            icon="notifications-outline"
            label={copy.settings.notifications}
            onPress={() => navigation.navigate('Notifications')}
          />
          <SettingsRow
            icon="language-outline"
            label={copy.language.title}
            /* The current language named in itself, so the row is legible to
             * whichever language the reader actually speaks. */
            value={getLanguage() === 'he' ? copy.language.hebrew : copy.language.english}
            onPress={() => navigation.navigate('Language')}
          />
        </SettingsCard>

        <SettingsCard>
          <SettingsRow
            icon="settings-outline"
            label={copy.settings.manageAccount}
            onPress={() => navigation.navigate('ManageAccount')}
          />
        </SettingsCard>
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: t.color.background },
    centered: { alignItems: 'center', justifyContent: 'center' },
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

    loggedOutBody: { flex: 1, padding: t.space.xl, justifyContent: 'center' },
    loggedOutText: { ...t.type.body, color: t.color.textSecondary, textAlign: 'center', marginBottom: t.space.xl },

    avatarWrap: { alignItems: 'center', marginBottom: t.space.xl },
    avatarCircle: {
      width: 96,
      height: 96,
      borderRadius: t.radius.pill,
      backgroundColor: t.color.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },

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
    ctaText: { ...t.type.heading, color: t.color.onPrimary },
  });
}
