/**
 * PlantAI design system - Warm Editorial.
 *
 * Single source of design tokens for the whole app. Style: cream paper canvas,
 * deep forest green as the brand voice, terracotta as the one hot accent, an
 * editorial serif for display type over a rounded geometric sans. Light + dark
 * are designed together (dark is a warm near-black paper, not an inversion).
 *
 * Usage:
 *   import { useTheme } from '../theme';
 *   const t = useTheme();           // theme for current color scheme
 *   <View style={{ backgroundColor: t.color.background, padding: t.space.lg }} />
 *
 * Spacing is an 8pt rhythm (4 = half-step). Radius/typography/shadow are
 * scales - never hardcode raw values in screens.
 */
import { useColorScheme } from 'react-native';

// --- palettes (light + dark designed together) -----------------------------

const light = {
  primary: '#1E4034', // deep forest - headings, filled brand buttons, active tab
  primaryPressed: '#163027',
  onPrimary: '#FDFBF7',
  primaryWash: '#E4EFE4', // tonal primary surface (healthy pills, active chips)
  secondary: '#3C6B54',

  /*
   * Terracotta is the single hot colour in a green system. It marks the one
   * action a screen wants you to take and nothing else - one terracotta thing
   * per screen, or it stops meaning "this one".
   */
  accent: '#D2653A',
  onAccent: '#FFFFFF',

  background: '#F7F1E7', // warm cream paper
  surface: '#FFFDF9', // cards / sheets - paper white, still warm
  surfaceMuted: '#F0E8DA',

  foreground: '#1B2B22', // primary text (13.4:1 on background)
  textSecondary: '#55655B', // secondary text (>=4.5:1 on background)
  textMuted: '#8A8073', // warm grey - metadata only, never body copy

  border: '#E8DECE',
  ring: '#1E4034',

  success: '#2F6B4F',
  warning: '#B4741F',
  warningWash: '#FBEEDA', // tonal warning surface
  danger: '#B23A20',
  onDanger: '#FFFFFF',

  /*
   * The three care kinds. One calendar shows watering, repotting and feeding on
   * the same grid, so each needs to be told apart at a glance. In this palette
   * there is no blue to spend - water takes the terracotta family (it is the
   * care action the app nags about most, so it earns the hot colour), repot
   * takes clay brown, feed takes olive. All three clear 4.5:1 against their
   * `on*` text.
   */
  water: '#C4552F',
  waterPressed: '#A94526',
  onWater: '#FFFFFF',
  waterWash: '#F8E4D9',

  repot: '#8C5A2B',
  onRepot: '#FFFFFF',
  feed: '#5F7A33',
  onFeed: '#FFFFFF',

  // Plant condition scale - badge/dot/bar accents (>=3:1 on light surfaces).
  conditionHealthy: '#2F6B4F',
  conditionMild: '#4A7C59',
  conditionModerate: '#B4741F',
  conditionSevere: '#C4552F',
  conditionCritical: '#B23A20',

  scrim: 'rgba(27, 43, 34, 0.5)',
} as const;

const dark = {
  primary: '#7FB894', // lighter tonal forest so it reads on warm near-black
  primaryPressed: '#6BA381',
  onPrimary: '#0E211A',
  primaryWash: '#1D3128',
  secondary: '#A3CFB3',

  accent: '#E88458',
  onAccent: '#2A1006',

  background: '#14120E', // warm near-black paper
  surface: '#1E1B15',
  surfaceMuted: '#2A251D',

  foreground: '#F4EDE0',
  textSecondary: '#BFB6A5',
  textMuted: '#8F8676',

  border: '#332D24',
  ring: '#7FB894',

  success: '#7FB894',
  warning: '#E0A244',
  warningWash: '#38290F',
  danger: '#E9765A',
  onDanger: '#2A0B05',

  // Care kinds - lighter tonal variants with dark text on the fill.
  water: '#E88458',
  waterPressed: '#D3714A',
  onWater: '#2A1006',
  waterWash: '#3A1F13',

  repot: '#C99257',
  onRepot: '#2A1B08',
  feed: '#A3C16A',
  onFeed: '#1B2409',

  // Plant condition scale - lighter tonal variants for dark surfaces.
  conditionHealthy: '#7FB894',
  conditionMild: '#9CCBAA',
  conditionModerate: '#E0A244',
  conditionSevere: '#E88458',
  conditionCritical: '#E9765A',

  scrim: 'rgba(0, 0, 0, 0.62)',
} as const;

// --- shared scales ---------------------------------------------------------

/* 8pt spacing rhythm (xs=4 is the half-step). */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  '2xl': 32,
  '3xl': 48,
} as const;

/* Soft editorial corners - cards live at 20-28, controls are pills. */
export const radius = {
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  '2xl': 28,
  pill: 999,
} as const;

/* Type scale - Playfair Display (display/headings) + Poppins (text).
 * fontFamily names must match the keys registered in useFonts() in App.tsx.
 * Note: with static custom fonts iOS binds weight to the family, so an inline
 * fontWeight override does not change weight - switch fontFamily for a
 * heavier/lighter cut. */
export const type = {
  display: {
    fontFamily: 'PlayfairDisplay_700Bold',
    fontSize: 34,
    lineHeight: 42,
    fontWeight: '700' as const,
    letterSpacing: -0.8,
  },
  title: {
    fontFamily: 'PlayfairDisplay_700Bold',
    fontSize: 24,
    lineHeight: 31,
    fontWeight: '700' as const,
    letterSpacing: -0.4,
  },
  heading: {
    fontFamily: 'PlayfairDisplay_600SemiBold',
    fontSize: 19,
    lineHeight: 26,
    fontWeight: '600' as const,
    letterSpacing: -0.2,
  },
  body: { fontFamily: 'Poppins_400Regular', fontSize: 15, lineHeight: 23, fontWeight: '400' as const },
  bodyStrong: { fontFamily: 'Poppins_600SemiBold', fontSize: 15, lineHeight: 23, fontWeight: '600' as const },
  label: { fontFamily: 'Poppins_500Medium', fontSize: 13.5, lineHeight: 20, fontWeight: '500' as const },
  caption: { fontFamily: 'Poppins_500Medium', fontSize: 11.5, lineHeight: 16, fontWeight: '500' as const },
  /* Small all-caps eyebrow above a display heading ("MONDAY, JUNE 24"). */
  eyebrow: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600' as const,
    letterSpacing: 1.1,
    textTransform: 'uppercase' as const,
  },
} as const;

/* Elevation scale - warm, diffuse shadows so cards float off the cream paper
 * without a grey halo. */
export const elevation = {
  none: {},
  card: {
    shadowColor: '#4A3B26',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.07,
    shadowRadius: 12,
    elevation: 2,
  },
  raised: {
    shadowColor: '#4A3B26',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.12,
    shadowRadius: 22,
    elevation: 8,
  },
} as const;

export type ThemeColors = Record<keyof typeof light, string>;

export interface Theme {
  color: ThemeColors;
  space: typeof space;
  radius: typeof radius;
  type: typeof type;
  elevation: typeof elevation;
  scheme: 'light' | 'dark';
}

const palettes: { light: ThemeColors; dark: ThemeColors } = { light, dark };

/* Build a theme for a given scheme (defaults to light). */
export function getTheme(scheme: 'light' | 'dark' = 'light'): Theme {
  return { color: palettes[scheme], space, radius, type, elevation, scheme };
}

/* Hook: theme that follows the device color scheme. */
export function useTheme(): Theme {
  const scheme = useColorScheme();
  return getTheme(scheme === 'dark' ? 'dark' : 'light');
}
