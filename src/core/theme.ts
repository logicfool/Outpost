export type ThemePreference = 'navy' | 'dark' | 'light' | 'system';
export type ThemeMode = Exclude<ThemePreference, 'system'>;
export interface Palette {
  background: string;
  surface: string;
  raised: string;
  border: string;
  ink: string;
  muted: string;
  subtle: string;
  accent: string;
  mint: string;
  violet: string;
  gold: string;
  blue: string;
}
export const PALETTES: Record<ThemeMode, Palette> = {
  navy: {
    background: '#0B1018',
    surface: '#131A25',
    raised: '#1B2431',
    border: '#2D394A',
    ink: '#ECE8E1',
    muted: '#B7BFCC',
    subtle: '#91A0B5',
    accent: '#D93248',
    mint: '#4FD1A5',
    violet: '#B49BFA',
    gold: '#F5C451',
    blue: '#7CC4FF',
  },
  dark: {
    background: '#070707',
    surface: '#151515',
    raised: '#222222',
    border: '#373737',
    ink: '#F5F5F5',
    muted: '#C5C5C8',
    subtle: '#A2A2AA',
    accent: '#D93248',
    mint: '#5ED6A8',
    violet: '#C4A7FF',
    gold: '#F2C767',
    blue: '#91CCFF',
  },
  light: {
    background: '#F5F6F8',
    surface: '#FFFFFF',
    raised: '#E9ECF1',
    border: '#CDD2DA',
    ink: '#171B23',
    muted: '#404956',
    subtle: '#586170',
    accent: '#BE2138',
    mint: '#087047',
    violet: '#6942AA',
    gold: '#815D0B',
    blue: '#205F99',
  },
};
export function themePreference(value: unknown): ThemePreference {
  return ['navy', 'dark', 'light', 'system'].includes(String(value))
    ? (value as ThemePreference)
    : 'navy';
}
export function resolveTheme(preference: unknown, system?: string | null): ThemeMode {
  const p = themePreference(preference);
  return p === 'system' ? (system === 'light' ? 'light' : 'dark') : p;
}
