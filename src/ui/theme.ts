import { StyleSheet } from 'react-native';
export const C = {
  background: '#050505',
  surface: '#151515',
  raised: '#202020',
  border: '#2B2B2B',
  ink: '#F7F7F7',
  muted: '#A5A5A8',
  subtle: '#707074',
  accent: '#FF5D6C',
  mint: '#72E7B3',
  violet: '#B29BFF',
  gold: '#F2C86B',
  blue: '#8DC7FF',
};
export const S = StyleSheet.create({
  flex: { flex: 1 },
  page: { flex: 1, backgroundColor: C.background },
  content: { padding: 22, gap: 20, paddingBottom: 42 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { color: C.ink, fontSize: 36, fontWeight: '900', letterSpacing: -1.4 },
  h2: { color: C.ink, fontSize: 22, fontWeight: '800', letterSpacing: -0.5 },
  h3: { color: C.ink, fontSize: 16, fontWeight: '700' },
  body: { color: C.muted, fontSize: 14, lineHeight: 22 },
  small: { color: C.subtle, fontSize: 12, lineHeight: 18 },
  eyebrow: { color: C.accent, fontSize: 10, fontWeight: '900', letterSpacing: 2.2 },
  card: {
    backgroundColor: C.surface,
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: '#222',
    gap: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
    color: C.ink,
    padding: 15,
    borderRadius: 16,
    fontSize: 15,
  },
  divider: { height: 1, backgroundColor: '#242424' },
});
export function rarityColor(rarity?: string): string {
  return rarity === 'Exclusive'
    ? C.gold
    : rarity === 'Ultra'
      ? C.violet
      : rarity === 'Deluxe'
        ? C.mint
        : C.blue;
}
