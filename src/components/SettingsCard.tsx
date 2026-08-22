import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Theme, useTheme } from '../theme';

/* Rounded card grouping SettingsRow children with a hairline divider between them. */
export default function SettingsCard({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  const s = React.useMemo(() => makeStyles(t), [t]);
  const items = React.Children.toArray(children);

  return (
    <View style={s.card}>
      {items.map((child, i) => (
        <React.Fragment key={i}>
          {i > 0 && <View style={s.divider} />}
          {child}
        </React.Fragment>
      ))}
    </View>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    card: {
      backgroundColor: t.color.surface,
      borderRadius: t.radius.lg,
      borderWidth: 1,
      borderColor: t.color.border,
      overflow: 'hidden',
      marginBottom: t.space.lg,
    },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: t.color.border, marginStart: t.space.lg + 20 + t.space.md },
  });
}
