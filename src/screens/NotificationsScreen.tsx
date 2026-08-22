import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Switch, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { RootStackParamList } from '../types';
import { Theme, useTheme } from '../theme';
import SettingsCard from '../components/SettingsCard';
import { ensureNotificationPermission } from '../services/wateringReminder';
import { notificationPrefs } from '../services/notificationPrefs';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Notifications'>;
};

/*
 * Only two rows are real. Watering is the only reminder type this app
 * actually schedules (src/services/wateringReminder.ts) - fertilize/prune/
 * mist/repot/special-care reminders and a fixed notification time don't
 * exist, so they're not shown here rather than being switches that do
 * nothing (issue #1 follow-up, scoped down from the original mock).
 */
export default function NotificationsScreen({ navigation }: Props) {
  const t = useTheme();
  const s = React.useMemo(() => makeStyles(t), [t]);

  const [pushGranted, setPushGranted] = useState(false);
  const [wateringEnabled, setWateringEnabled] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const perm = await Notifications.getPermissionsAsync().catch(() => null);
        if (!cancelled) setPushGranted(Boolean(perm?.granted));
      })();
      setWateringEnabled(notificationPrefs.load().wateringRemindersEnabled);
      return () => {
        cancelled = true;
      };
    }, [])
  );

  const handlePushToggle = async (next: boolean) => {
    if (next) {
      const granted = await ensureNotificationPermission();
      setPushGranted(granted);
      // Declined or blocked at the OS level - only Settings can grant it now.
      if (!granted) Linking.openSettings().catch(() => {});
    } else {
      // Apps cannot revoke their own notification permission - only the OS
      // settings can. Send the user there rather than showing a toggle that
      // silently does nothing.
      Linking.openSettings().catch(() => {});
    }
  };

  const handleWateringToggle = (next: boolean) => {
    setWateringEnabled(next);
    notificationPrefs.setWateringRemindersEnabled(next);
  };

  return (
    <SafeAreaView style={s.container} edges={['top', 'bottom']}>
      <View style={s.header}>
        <Pressable onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel="Back" style={s.backBtn}>
          <Ionicons name="chevron-back" size={24} color={t.color.primary} />
        </Pressable>
        <Text style={s.headerTitle}>Notifications</Text>
        <View style={s.backBtn} />
      </View>

      <ScrollView contentContainerStyle={s.scroll}>
        <SettingsCard>
          <View style={s.row}>
            <Text style={s.rowLabel}>Push notifications</Text>
            <Switch
              value={pushGranted}
              onValueChange={handlePushToggle}
              trackColor={{ false: t.color.border, true: t.color.primary }}
              thumbColor={t.color.onPrimary}
            />
          </View>
        </SettingsCard>

        <SettingsCard>
          <View style={s.row}>
            <Text style={s.rowLabel}>Watering reminder</Text>
            <Switch
              value={wateringEnabled}
              onValueChange={handleWateringToggle}
              trackColor={{ false: t.color.border, true: t.color.primary }}
              thumbColor={t.color.onPrimary}
            />
          </View>
        </SettingsCard>

        {!pushGranted && (
          <Text style={s.note}>
            Push notifications are off at the system level. Turn them on in iOS Settings to get
            watering reminders.
          </Text>
        )}
      </ScrollView>
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
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: 52,
      paddingHorizontal: t.space.lg,
    },
    rowLabel: { ...t.type.bodyStrong, color: t.color.foreground },
    note: { ...t.type.caption, color: t.color.textMuted, marginTop: t.space.sm },
  });
}
