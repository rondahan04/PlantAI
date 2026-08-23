import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Theme, useTheme } from '../theme';

type Props = {
  count: number;
  onImport: () => Promise<{ imported: string[]; failed: string[] }>;
  onDismiss: () => void;
};

/*
 * Home banner (not a modal - approved during brainstorming): renders above
 * the library, never blocks it. Declining does not persist anywhere, so it
 * reappears next login by design (spec: "declining leaves local storage
 * untouched" - there is deliberately no flag to make it stop asking).
 */
export default function ImportBanner({ count, onImport, onDismiss }: Props) {
  const t = useTheme();
  const s = makeStyles(t);
  const [busy, setBusy] = useState(false);
  const [failedCount, setFailedCount] = useState<number | null>(null);

  const handleImport = async () => {
    setBusy(true);
    try {
      const result = await onImport();
      setFailedCount(result.failed.length);
      if (result.failed.length === 0) onDismiss();
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={s.card}>
      <Ionicons name="cloud-upload-outline" size={20} color={t.color.primary} />
      <View style={s.body}>
        <Text style={s.title}>Import your {count} saved plants?</Text>
        <Text style={s.sub}>
          {failedCount === null
            ? 'They will follow you to any device you log into.'
            : `${count - failedCount} imported, ${failedCount} couldn't - tap to retry.`}
        </Text>
      </View>
      {busy ? (
        <ActivityIndicator color={t.color.primary} />
      ) : (
        <View style={s.actions}>
          <Pressable onPress={handleImport} accessibilityRole="button" accessibilityLabel="Import saved plants" hitSlop={8}>
            <Text style={s.importText}>Import</Text>
          </Pressable>
          <Pressable onPress={onDismiss} accessibilityRole="button" accessibilityLabel="Not now" hitSlop={8}>
            <Ionicons name="close" size={18} color={t.color.textMuted} />
          </Pressable>
        </View>
      )}
    </View>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space.sm,
      backgroundColor: t.color.surface,
      borderRadius: t.radius.lg,
      borderWidth: 1,
      borderColor: t.color.border,
      padding: t.space.md,
      marginTop: t.space.md,
    },
    body: { flex: 1 },
    title: { ...t.type.bodyStrong, color: t.color.foreground },
    sub: { ...t.type.caption, color: t.color.textSecondary, marginTop: 2 },
    actions: { flexDirection: 'row', alignItems: 'center', gap: t.space.md },
    importText: { ...t.type.bodyStrong, color: t.color.primary },
  });
}
