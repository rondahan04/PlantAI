import { View, Text, StyleSheet, Pressable, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import FramedPhoto from './FramedPhoto';
import { useTheme, type Theme } from '../theme';
import { useProfileAvatar } from '../hooks/useProfileAvatar';
import { initialOf } from '../lib/profile/initial';

/*
 * The account's face, at whatever size the surface needs it.
 *
 * One component for all three placements - the 96pt circle on Settings, the
 * greeting on the dashboard, the portfolio masthead - because the fallback is
 * the part that has to agree. A circle showing initials on one screen and a
 * glyph on another reads as two different accounts.
 *
 * Draws through FramedPhoto, so the framing chosen in the editor is honoured
 * here exactly as a plant's is on its card. A circle is the least forgiving
 * frame in the app: it crops the corners off every photograph, which is why
 * being able to drag the face into it matters more here than anywhere else.
 */

export interface AvatarProps {
  size: number;
  /* Shown when there is no picture: the user's own initial is warmer than a
   * generic glyph and tells them whose account they are looking at. */
  name?: string | null;
  onPress?: () => void;
  /* Settings uses this to say the circle is a button; the decorative
   * placements leave it off and are hidden from assistive tech. */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

export default function Avatar({ size, name, onPress, accessibilityLabel, style }: AvatarProps) {
  const t = useTheme();
  const s = makeStyles(t);
  const avatar = useProfileAvatar();
  const initial = initialOf(name);

  const frame: ViewStyle = { width: size, height: size, borderRadius: size / 2 };

  const inner = avatar ? (
    <FramedPhoto
      uri={avatar.uri}
      focusY={avatar.focusY}
      zoom={avatar.zoom}
      style={[frame, s.photo]}
      /* The picture changes identity when it is replaced, so the frame must not
       * keep showing the decoded previous one. */
      recyclingKey={avatar.uri}
      transition={120}
    />
  ) : (
    <View style={[frame, s.placeholder]}>
      {initial ? (
        /*
         * fontSize AND lineHeight together, always. The type token this style
         * is built from carries a lineHeight sized for its own 18px fontSize,
         * and scaling one without the other draws a 38px glyph into a 25px line
         * box - which clips the letter top and bottom and leaves a fragment
         * that does not read as any letter at all.
         */
        <Text style={[s.initial, { fontSize: size * 0.4, lineHeight: size * 0.5 }]}>
          {initial}
        </Text>
      ) : (
        <Ionicons name="person-outline" size={size * 0.44} color={t.color.onPrimary} />
      )}
    </View>
  );

  if (!onPress) {
    return (
      <View style={style} importantForAccessibility="no-hide-descendants">
        {inner}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [style, pressed && s.pressed]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      {inner}
    </Pressable>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    photo: { backgroundColor: t.color.surfaceMuted },
    placeholder: {
      backgroundColor: t.color.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    /*
     * Built from the heading token's FACE rather than spread from it: the token
     * is a complete type ramp step - size, line height, tracking - and this is a
     * single character scaled to whatever circle it lands in, so inheriting
     * those three is how the glyph got clipped. Tracking is zeroed for the same
     * reason: letter spacing on one letter is trailing space, which pushes it
     * off the centre of the circle.
     */
    initial: {
      fontFamily: t.type.heading.fontFamily,
      fontWeight: t.type.heading.fontWeight,
      letterSpacing: 0,
      textAlign: 'center',
      color: t.color.onPrimary,
      /* Android reserves extra vertical room inside the line box for ascenders
       * the glyph may not have; centred in a circle that reads as the letter
       * sitting slightly high. */
      includeFontPadding: false,
    },
    pressed: { opacity: 0.85, transform: [{ scale: 0.97 }] },
  });
}
