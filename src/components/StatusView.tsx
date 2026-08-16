/**
 * The one way this app tells the user something did not work.
 *
 * Before this existed the app spoke three error dialects in a single session: a
 * designed in-screen state on the nurseries list, a native `Alert` dumping raw
 * provider JSON from the camera, and a third hand-written alert for "not a
 * plant". Two of those in a row teach a user the app is unreliable.
 *
 * Rules this component encodes:
 *   - Never render an exception. Callers map failures to human sentences.
 *   - Always offer a way forward. An error with no action is a dead end.
 *   - Say what is *not* broken when we know it ("your photo is fine").
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Theme, useTheme } from '../theme';

type IconName = keyof typeof Ionicons.glyphMap;

export interface StatusAction {
  label: string;
  onPress: () => void;
  icon?: IconName;
}

export interface StatusViewProps {
  icon: IconName;
  title: string;
  body?: string;
  primaryAction?: StatusAction;
  secondaryAction?: StatusAction;
  /** 'error' tints the icon; 'neutral' (default) suits empty states. */
  tone?: 'neutral' | 'error';
}

export default function StatusView({
  icon,
  title,
  body,
  primaryAction,
  secondaryAction,
  tone = 'neutral',
}: StatusViewProps) {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
  const iconColor = tone === 'error' ? t.color.danger : t.color.textMuted;

  return (
    <View style={s.wrap} accessibilityRole="summary" accessibilityLabel={`${title}. ${body ?? ''}`}>
      <View style={s.iconWrap}>
        <Ionicons name={icon} size={40} color={iconColor} />
      </View>

      <Text style={s.title}>{title}</Text>
      {!!body && <Text style={s.body}>{body}</Text>}

      {!!primaryAction && (
        <Pressable
          style={({ pressed }) => [s.primaryBtn, pressed && s.primaryBtnPressed]}
          onPress={primaryAction.onPress}
          accessibilityRole="button"
          accessibilityLabel={primaryAction.label}
        >
          {!!primaryAction.icon && (
            <Ionicons name={primaryAction.icon} size={18} color={t.color.onPrimary} />
          )}
          <Text style={s.primaryText}>{primaryAction.label}</Text>
        </Pressable>
      )}

      {!!secondaryAction && (
        <Pressable
          style={s.secondaryBtn}
          onPress={secondaryAction.onPress}
          accessibilityRole="button"
          accessibilityLabel={secondaryAction.label}
        >
          <Text style={s.secondaryText}>{secondaryAction.label}</Text>
        </Pressable>
      )}
    </View>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    wrap: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: t.space.xl,
      paddingBottom: t.space['3xl'],
    },
    iconWrap: {
      width: 88,
      height: 88,
      borderRadius: t.radius.pill,
      backgroundColor: t.color.surfaceMuted,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: t.space.xl,
    },
    title: {
      ...t.type.title,
      color: t.color.foreground,
      textAlign: 'center',
      marginBottom: t.space.md,
    },
    body: {
      ...t.type.body,
      color: t.color.textSecondary,
      textAlign: 'center',
      maxWidth: 300,
      marginBottom: t.space.xl,
    },
    primaryBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: t.space.sm,
      backgroundColor: t.color.primary,
      borderRadius: t.radius.xl,
      paddingHorizontal: t.space.xl,
      minHeight: 52,
      minWidth: 200,
      ...t.elevation.raised,
    },
    primaryBtnPressed: { backgroundColor: t.color.primaryPressed, transform: [{ scale: 0.98 }] },
    primaryText: { ...t.type.bodyStrong, color: t.color.onPrimary },
    // 44pt minimum touch target, per the app's accessibility bar.
    secondaryBtn: {
      minHeight: 44,
      justifyContent: 'center',
      paddingHorizontal: t.space.lg,
      marginTop: t.space.md,
    },
    secondaryText: { ...t.type.label, color: t.color.primary },
  });
}
