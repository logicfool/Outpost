import React, { createContext, createElement, useContext, useMemo, type ReactNode } from 'react';
import { sharedViewStyles } from '../core/viewCache';
import { StyleSheet, useColorScheme } from 'react-native';
import {
  PALETTES,
  resolveTheme,
  type Palette,
  type ThemePreference,
  type ThemeMode,
} from '../core/theme';
export type { Palette } from '../core/theme';

const sharedStyles = (C: Palette) =>
  StyleSheet.create({
    flex: { flex: 1 },
    page: { flex: 1, backgroundColor: C.background },
    content: { paddingHorizontal: 16, paddingTop: 8, gap: 16, paddingBottom: 24 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    between: {
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    title: { color: C.ink, fontSize: 30, fontWeight: '800', letterSpacing: -0.8 },
    h2: { color: C.ink, fontSize: 20, fontWeight: '700', letterSpacing: -0.3 },
    h3: { color: C.ink, fontSize: 15, fontWeight: '600' },
    body: { color: C.muted, fontSize: 14, lineHeight: 21 },
    small: { color: C.subtle, fontSize: 12, lineHeight: 17 },
    eyebrow: { color: C.accent, fontSize: 11, fontWeight: '700', letterSpacing: 1.6 },
    card: {
      width: '100%',
      minWidth: 0,
      backgroundColor: C.surface,
      borderRadius: 18,
      padding: 16,
      borderWidth: 1,
      borderColor: C.border,
      gap: 12,
    },
    input: {
      borderWidth: 1,
      borderColor: C.border,
      backgroundColor: C.surface,
      color: C.ink,
      padding: 14,
      borderRadius: 14,
      fontSize: 15,
    },
    divider: { height: 1, backgroundColor: C.border },
  });
const MEDIA = 'https://media.valorant-api.com';
const TIERS: Record<string, { color: string; icon: string }> = {
  Select: {
    color: '#5A9FE2',
    icon: `${MEDIA}/contenttiers/12683d76-48d7-84a3-4e09-6985794f0445/displayicon.png`,
  },
  Deluxe: {
    color: '#00B39B',
    icon: `${MEDIA}/contenttiers/0cebb8be-46d7-c12a-d306-e9907bfc5a25/displayicon.png`,
  },
  Premium: {
    color: '#D1548D',
    icon: `${MEDIA}/contenttiers/60bca009-4182-7998-dee7-b8a2558dc369/displayicon.png`,
  },
  Exclusive: {
    color: '#F5955B',
    icon: `${MEDIA}/contenttiers/e046854e-406c-37f4-6607-19a9ba8426fc/displayicon.png`,
  },
  Ultra: {
    color: '#FAD663',
    icon: `${MEDIA}/contenttiers/411e4a55-4e59-7757-41f0-86a53f101bb5/displayicon.png`,
  },
};
export const CURRENCY_ICONS: Record<string, string> = {
  VP: `${MEDIA}/currencies/85ad13f7-3d1b-5128-9eb2-7cd8ee0b5741/displayicon.png`,
  RP: `${MEDIA}/currencies/e59aa87c-4cbf-517a-5983-6e81511be9b7/displayicon.png`,
  KC: `${MEDIA}/currencies/85ca954a-41f2-ce94-9b45-8ca3dd39a00d/displayicon.png`,
};
export function rarityColor(rarity?: string): string {
  return (rarity && TIERS[rarity]?.color) || '#8792A3';
}
export function rarityIcon(rarity?: string): string | undefined {
  return rarity ? TIERS[rarity]?.icon : undefined;
}

const themes = Object.fromEntries(
  (['navy', 'dark', 'light'] as const).map((mode) => [
    mode,
    { C: PALETTES[mode], S: sharedStyles(PALETTES[mode]), mode, isDark: mode !== 'light' },
  ]),
) as Record<
  ThemeMode,
  { C: Palette; S: ReturnType<typeof sharedStyles>; mode: ThemeMode; isDark: boolean }
>;
const ThemeContext = createContext(themes.navy);
export function ThemeProvider({
  preference,
  children,
}: {
  preference?: ThemePreference;
  children: ReactNode;
}) {
  const system = useColorScheme();
  return createElement(
    ThemeContext.Provider,
    { value: themes[resolveTheme(preference, system)] },
    children,
  );
}
export function useTheme() {
  return useContext(ThemeContext);
}
export function useThemedStyles<T>(factory: (palette: Palette) => T): T {
  const { C } = useTheme();
  return useMemo(() => sharedViewStyles(factory, C), [C, factory]);
}
