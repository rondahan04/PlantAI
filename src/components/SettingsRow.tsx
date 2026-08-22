import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Theme, useTheme } from '../theme';

/*
 * One row in the nested Profile settings / Manage account lists - icon,
 * label, optional accent-colored value line, optional chevron. Shared so the
 * two settings screens don't each hand-roll the same row six times.
 */
export default function SettingsRow({
  icon,
  label,
  value,
  onPress,
  showChevron = true,
  danger = false,
  disabled = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value?: string;
  onPress?: () => void;
  showChevron?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  const t = useTheme();
  const s = React.useMemo(() => makeStyles(t), [t]);

  const content = (
    <View style={s.row}>
      <Ionicons name={icon} size={20} color={danger ? t.color.danger : t.color.textSecondary} style={s.icon} />
      <View style={s.textCol}>
        <Text style={[s.label, danger && s.labelDanger]}>{label}</Text>
        {value ? (
          <Text style={s.value} numberOfLines={1}>
            {value}
          </Text>
        ) : null}
      </View>
      {showChevron && onPress ? (
        <Ionicons name="chevron-forward" size={18} color={t.color.textMuted} />
      ) : null}
    </View>
  );

  if (!onPress) return content;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [pressed && s.pressed, disabled && s.disabled]}
    >
      {content}
    </Pressable>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 52,
      paddingHorizontal: t.space.lg,
      paddingVertical: t.space.sm,
    },
    pressed: { opacity: 0.6 },
    disabled: { opacity: 0.5 },
    icon: { marginEnd: t.space.md, width: 20 },
    textCol: { flex: 1 },
    label: { ...t.type.bodyStrong, color: t.color.foreground },
    labelDanger: { color: t.color.danger },
    value: { ...t.type.label, color: t.color.primary, marginTop: 2 },
  });
}
