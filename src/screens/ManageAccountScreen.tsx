import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { Theme, useTheme } from '../theme';
import SettingsCard from '../components/SettingsCard';
import SettingsRow from '../components/SettingsRow';
import { deleteAccount, signOut } from '../services/auth';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'ManageAccount'>;
};

export default function ManageAccountScreen({ navigation }: Props) {
  const t = useTheme();
  const s = React.useMemo(() => makeStyles(t), [t]);
  const [busy, setBusy] = useState(false);

  const handleLogout = async () => {
    setBusy(true);
    try {
      await signOut();
      navigation.navigate('Home');
    } finally {
      setBusy(false);
    }
  };

  const performDelete = async () => {
    setBusy(true);
    try {
      await deleteAccount();
      navigation.navigate('Home');
    } catch {
      Alert.alert('Delete failed', 'Something went wrong deleting your account. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = () => {
    Alert.alert(
      'Delete account?',
      'This permanently deletes your account and every plant on this device, including any saved before you signed in. There is no grace period and no undo.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: performDelete },
      ]
    );
  };

  return (
    <SafeAreaView style={s.container} edges={['top', 'bottom']}>
      <View style={s.header}>
        <Pressable onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel="Back" style={s.backBtn}>
          <Ionicons name="chevron-back" size={24} color={t.color.primary} />
        </Pressable>
        <Text style={s.headerTitle}>Manage account</Text>
        <View style={s.backBtn} />
      </View>

      <ScrollView contentContainerStyle={s.scroll}>
        <SettingsCard>
          <SettingsRow
            icon="lock-closed-outline"
            label="Change password"
            onPress={() => navigation.navigate('ChangePassword')}
            disabled={busy}
          />
          <SettingsRow icon="log-out-outline" label="Log out" onPress={handleLogout} disabled={busy} />
          <SettingsRow
            icon="trash-outline"
            label={busy ? 'Deleting…' : 'Delete account'}
            onPress={confirmDelete}
            danger
            disabled={busy}
          />
        </SettingsCard>
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
  });
}
