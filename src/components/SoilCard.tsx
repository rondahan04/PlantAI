import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { Theme, useTheme } from '../theme';
import { SOIL_MEDIA, soilMediumById, type SoilMediumId } from '../lib/soilMedia';
import { copy } from '../services/language';
import SoilMediumIcon, { withAlpha } from './SoilMediumIcon';

/*
 * The growing-medium picker.
 *
 * ONE component, mounted in two places on purpose: the add-plant flow and the
 * plant detail screen. Both are the same question about the same pot, and a
 * user who picks LECA while adding a plant and then meets a different-looking
 * list with a different order when they go back to edit it will stop trusting
 * either screen to be recording what they said. Two hand-rolled pickers would
 * also drift the moment a ninth medium is added to SOIL_MEDIA.
 *
 * Horizontal rather than a dropdown or a modal because the drawings are the
 * point (see SoilMediumIcon): a user who does not know the difference between
 * pon and aroid mix learns more from eight textures side by side than from a
 * list of eight words, and a modal would hide the comparison behind a tap. The
 * cost is that media past the fourth need a scroll, which is why the selected
 * medium's description is restated in full underneath rather than living only
 * inside the option that may be off-screen.
 */

export interface SoilCardProps {
  value: SoilMediumId | undefined;
  onChange: (id: SoilMediumId) => void;
  title?: string;
}

export default function SoilCard({ value, onChange, title = copy.soilCard.title }: SoilCardProps) {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
  const selected = soilMediumById(value);

  return (
    <View style={s.card}>
      <Text style={s.title}>{title}</Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.row}
        /* One group with one name, so a screen reader announces "Growing
         * medium, radio group" once and then reads the eight options, instead
         * of eight orphan radios with no idea what they answer. */
        accessibilityRole="radiogroup"
        accessibilityLabel={title}
      >
        {SOIL_MEDIA.map((medium) => {
          const isSelected = medium.id === value;
          const tint = t.color[medium.tint];
          return (
            <Pressable
              key={medium.id}
              onPress={() => onChange(medium.id)}
              style={({ pressed }) => [
                s.option,
                /* The border is always drawn, transparent when unselected, so
                 * choosing an option does not nudge the whole row sideways. */
                {
                  backgroundColor: isSelected ? withAlpha(tint, 0.1) : 'transparent',
                  borderColor: isSelected ? withAlpha(tint, 0.4) : 'transparent',
                },
                pressed && s.optionPressed,
              ]}
              accessibilityRole="radio"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={copy.soilCard.optionA11y(copy.soilMedia[medium.id].label, copy.soilMedia[medium.id].description)}
            >
              <SoilMediumIcon id={medium.id} selected={isSelected} />
              <Text
                style={[s.label, { color: isSelected ? tint : t.color.textSecondary }]}
                numberOfLines={2}
              >
                {copy.soilMedia[medium.id].label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/*
        Fixed height whether or not anything is chosen: this card sits in the
        middle of a form, and a line of text appearing on first tap would shove
        every field below it down under the user's thumb.
      */}
      <Text
        style={[s.description, !selected && s.descriptionEmpty]}
        numberOfLines={2}
        /* The description is already read out as part of each option's label,
         * so repeating it here would make every selection announce twice. */
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {selected ? copy.soilMedia[selected.id].description : copy.soilCard.empty}
      </Text>
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
      paddingVertical: t.space.md,
      marginBottom: t.space.lg,
    },
    title: {
      ...t.type.label,
      color: t.color.textMuted,
      paddingHorizontal: t.space.lg,
      marginBottom: t.space.sm,
    },
    row: { paddingHorizontal: t.space.md, gap: t.space.xs },
    option: {
      width: 84,
      alignItems: 'center',
      paddingVertical: t.space.sm,
      paddingHorizontal: t.space.xs,
      borderRadius: t.radius.lg,
      borderWidth: 1,
    },
    optionPressed: { opacity: 0.7 },
    label: {
      ...t.type.caption,
      textAlign: 'center',
      marginTop: t.space.sm,
      /* Two caption lines, always. "Sphagnum moss" wraps and "LECA" does not,
       * and without a fixed box the discs would sit at eight different
       * heights. */
      height: t.type.caption.lineHeight * 2,
    },
    description: {
      ...t.type.caption,
      color: t.color.textSecondary,
      paddingHorizontal: t.space.lg,
      marginTop: t.space.sm,
      minHeight: t.type.caption.lineHeight,
    },
    descriptionEmpty: { color: t.color.textMuted },
  });
}
