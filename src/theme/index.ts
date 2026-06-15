/**
 * PlantAI design system — Organic Biophilic.
 *
 * Single source of design tokens for the whole app. Style: nature green +
 * sun accent, rounded organic corners, calm. Light + dark are designed
 * together (dark uses desaturated tonal variants, not inverted colors).
 *
 * Usage:
 *   import { useTheme } from '../theme';
 *   const t = useTheme();           // theme for current color scheme
 *   <View style={{ backgroundColor: t.color.background, padding: t.space.lg }} />
 *
 * Spacing is an 8pt rhythm (4 = half-step). Radius/typography/shadow are
 * scales — never hardcode raw values in screens.
 */
import { useColorScheme } from 'react-native';

// --- palettes (light + dark designed together) -----------------------------

const light = {
  primary: '#15803D', // nature green
  primaryPressed: '#116932',
  onPrimary: '#FFFFFF',
  secondary: '#059669',
  accent: '#D97706', // sun — reserve for the single primary CTA / highlights
  onAccent: '#FFFFFF',

  background: '#F0FDF4', // soft green-tinted canvas
  surface: '#FFFFFF', // cards / sheets
  surfaceMuted: '#F0F7F3',

  foreground: '#0F172A', // primary text (15.8:1 on background)
  textSecondary: '#475569', // secondary text (>=4.5:1)
  textMuted: '#64748B',

  border: '#E2EFE7',
  ring: '#15803D',

  success: '#15803D',
  warning: '#D97706',
  danger: '#DC2626',
  onDanger: '#FFFFFF',

  scrim: 'rgba(15, 23, 42, 0.5)',
} as const;

const dark = {
  primary: '#34D399', // lighter tonal variant for dark surfaces
  primaryPressed: '#2BBA86',
  onPrimary: '#04231A',
  secondary: '#6EE7B7',
  accent: '#FBBF24',
  onAccent: '#231603',

  background: '#0B1410', // deep green-black
  surface: '#13211B',
  surfaceMuted: '#1B2C24',

  foreground: '#ECFDF5',
  textSecondary: '#A7C4B5',
  textMuted: '#7C9888',

  border: '#24382E',
  ring: '#34D399',

  success: '#34D399',
  warning: '#FBBF24',
  danger: '#F87171',
  onDanger: '#1A0606',

  scrim: 'rgba(0, 0, 0, 0.6)',
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

/* Organic rounded corners (16-24 is the house range). */
export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  pill: 999,
} as const;

/* Type scale (Lora display / Raleway text once fonts are loaded). */
export const type = {
  display: { fontSize: 32, lineHeight: 38, fontWeight: '800' as const, letterSpacing: -0.8 },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700' as const, letterSpacing: -0.4 },
  heading: { fontSize: 18, lineHeight: 24, fontWeight: '700' as const, letterSpacing: -0.3 },
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400' as const },
  bodyStrong: { fontSize: 16, lineHeight: 24, fontWeight: '600' as const },
  label: { fontSize: 14, lineHeight: 20, fontWeight: '500' as const },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '500' as const },
} as const;

/* Elevation scale — consistent shadow tokens for cards/sheets/CTAs. */
export const elevation = {
  none: {},
  card: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  raised: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 6,
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
