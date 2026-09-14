import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Feather, Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import type { CatalogItem, Money, Section as DataSection, StoreOffer } from '../core/types';
import { countdown, currencySymbol } from '../core/normalize';
import { C, CURRENCY_ICONS, S, rarityColor, rarityIcon } from './theme';
type IconName = React.ComponentProps<typeof Feather>['name'];
export function Button({
  title,
  onPress,
  secondary = false,
  disabled = false,
  icon,
}: {
  title: string;
  onPress(): void;
  secondary?: boolean;
  disabled?: boolean;
  icon?: IconName;
}) {
  const color = secondary ? C.ink : '#FFFFFF';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary ? styles.buttonSecondary : { backgroundColor: C.accent },
        { opacity: disabled ? 0.4 : pressed ? 0.8 : 1 },
      ]}
    >
      {icon && <Feather name={icon} size={16} color={color} />}
      <Text style={[styles.buttonText, { color }]}>{title}</Text>
    </Pressable>
  );
}
export function IconButton({
  icon,
  label,
  onPress,
  color = C.ink,
}: {
  icon: IconName;
  label: string;
  onPress(): void;
  color?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={10}
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, pressed && { opacity: 0.7 }]}
    >
      <Feather name={icon} size={20} color={color} />
    </Pressable>
  );
}
export function Badge({ text, color = C.mint }: { text: string; color?: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: `${color}1F` }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.badgeText, { color }]}>{text}</Text>
    </View>
  );
}
export function Tabs<T extends string>({
  items,
  value,
  onChange,
}: {
  items: readonly { id: NoInfer<T>; label: string }[];
  value: T;
  onChange(id: NoInfer<T>): void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.tabs}
    >
      {items.map((item) => {
        const selected = value === item.id;
        return (
          <Pressable
            key={item.id}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(item.id)}
            style={[styles.tab, selected && styles.tabSelected]}
          >
            <Text style={[styles.tabText, selected && styles.tabTextSelected]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
export function SectionHeader({ title, detail }: { title: string; detail?: string }) {
  return (
    <View style={S.between}>
      <Text style={S.h2}>{title}</Text>
      {detail ? <Text style={S.small}>{detail}</Text> : null}
    </View>
  );
}
export function CurrencyIcon({ symbol, size = 16 }: { symbol: string; size?: number }) {
  const uri = CURRENCY_ICONS[symbol];
  return uri ? (
    <Image
      source={{ uri }}
      style={{ width: size, height: size }}
      resizeMode="contain"
      accessibilityLabel={symbol}
    />
  ) : (
    <Text style={[S.small, { fontWeight: '700' }]}>{symbol}</Text>
  );
}
export function RarityIcon({ rarity, size = 18 }: { rarity?: string; size?: number }) {
  const uri = rarityIcon(rarity);
  return uri ? (
    <Image
      source={{ uri }}
      style={{ width: size, height: size }}
      resizeMode="contain"
      accessibilityLabel={rarity}
    />
  ) : (
    <View style={{ width: size, height: size }} />
  );
}
export function MoneyText({
  prices,
  large = false,
  strike = false,
}: {
  prices: Money[];
  large?: boolean;
  strike?: boolean;
}) {
  if (!prices.length) return <Text style={S.small}>Price unavailable</Text>;
  const size = strike ? 12 : large ? 20 : 15;
  return (
    <View style={[S.row, { gap: 10, flexWrap: 'wrap' }]}>
      {prices.map((p) => (
        <View key={p.currencyId} style={[S.row, { gap: 5 }]}>
          <CurrencyIcon symbol={currencySymbol(p.currencyId)} size={size} />
          <Text
            style={{
              color: strike ? C.subtle : C.ink,
              fontSize: size,
              fontWeight: strike ? '500' : '700',
              textDecorationLine: strike ? 'line-through' : 'none',
              fontVariant: ['tabular-nums'],
            }}
          >
            {p.amount.toLocaleString()}
          </Text>
        </View>
      ))}
    </View>
  );
}
export function ItemArt({
  item,
  size = 100,
  style,
}: {
  item: CatalogItem;
  size?: number;
  style?: ViewStyle;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [item.image]);
  return (
    <View style={[{ height: size, alignItems: 'center', justifyContent: 'center' }, style]}>
      {item.image && !failed ? (
        <Image
          source={{ uri: item.image }}
          resizeMode="contain"
          style={{ width: '92%', height: '92%' }}
          accessibilityLabel={item.name}
          onError={() => setFailed(true)}
        />
      ) : (
        <Feather
          name={item.kind === 'skin' || item.kind === 'chroma' ? 'crosshair' : 'hexagon'}
          size={Math.min(34, size / 2.5)}
          color={rarityColor(item.rarity)}
        />
      )}
    </View>
  );
}
export function WishButton({
  wished,
  name,
  onPress,
  size = 20,
}: {
  wished: boolean;
  name: string;
  onPress(): void;
  size?: number;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${wished ? 'Remove' : 'Add'} ${name} ${wished ? 'from' : 'to'} wishlist`}
      hitSlop={12}
      onPress={onPress}
    >
      <Ionicons
        name={wished ? 'heart' : 'heart-outline'}
        size={size}
        color={wished ? C.accent : C.subtle}
      />
    </Pressable>
  );
}
export function OfferCard({
  offer,
  wished,
  onWish,
  onOpen,
}: {
  offer: StoreOffer;
  wished: boolean;
  onWish(): void;
  onOpen(): void;
}) {
  const tint = rarityColor(offer.item.rarity);
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`View ${offer.item.name}`}
      style={({ pressed }) => [
        styles.offer,
        { borderColor: `${tint}40`, opacity: pressed ? 0.85 : 1 },
      ]}
    >
      <LinearGradient
        colors={[`${tint}30`, `${tint}08`, C.surface]}
        locations={[0, 0.55, 1]}
        style={styles.offerInner}
      >
        <View style={S.between}>
          {offer.discountPercent !== undefined ? (
            <View style={styles.discount}>
              <Text style={styles.discountText}>−{offer.discountPercent}%</Text>
            </View>
          ) : (
            <RarityIcon rarity={offer.item.rarity} />
          )}
          <WishButton wished={wished} name={offer.item.name} onPress={onWish} />
        </View>
        <ItemArt item={offer.item} size={92} />
        <Text numberOfLines={2} style={styles.offerName}>
          {offer.item.name}
        </Text>
        {offer.originalPrices?.length ? <MoneyText prices={offer.originalPrices} strike /> : null}
        <MoneyText prices={offer.prices} />
      </LinearGradient>
    </Pressable>
  );
}
export function OfferGrid({
  offers,
  wishlist,
  onWish,
  onOpen,
}: {
  offers: StoreOffer[];
  wishlist: string[];
  onWish(id: string): void;
  onOpen(item: CatalogItem): void;
}) {
  return (
    <View style={styles.grid}>
      {offers.map((offer, index) => (
        <View key={`${offer.id}:${index}`} style={styles.gridCell}>
          <OfferCard
            offer={offer}
            wished={wishlist.includes(offer.item.canonicalId)}
            onWish={() => onWish(offer.item.canonicalId)}
            onOpen={() => onOpen(offer.item)}
          />
        </View>
      ))}
    </View>
  );
}
export function Timer({
  expiresAt,
  offset = 0,
  small = false,
  color = C.ink,
}: {
  expiresAt: number;
  offset?: number;
  small?: boolean;
  color?: string;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <Text
      style={{
        color,
        fontSize: small ? 13 : 26,
        fontWeight: small ? '600' : '800',
        fontVariant: ['tabular-nums'],
        letterSpacing: small ? 0 : 0.5,
      }}
    >
      {countdown(expiresAt, now, offset)}
    </Text>
  );
}
export function Empty({
  title,
  detail,
  icon = 'inbox',
}: {
  title: string;
  detail?: string;
  icon?: IconName;
}) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Feather name={icon} size={22} color={C.muted} />
      </View>
      <Text style={[S.h3, { textAlign: 'center' }]}>{title}</Text>
      {detail ? <Text style={[S.body, { textAlign: 'center' }]}>{detail}</Text> : null}
    </View>
  );
}
export function Resource<T>({
  section: value,
  title,
  children,
}: {
  section: DataSection<T> | undefined;
  title: string;
  children(data: T): React.ReactNode;
}) {
  if (!value)
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={C.accent} />
      </View>
    );
  if (value.status === 'error')
    return <Empty icon="alert-circle" title={`${title} unavailable`} detail={value.message} />;
  return <>{children(value.data)}</>;
}
export function ProgressBar({
  value,
  max = 1,
  color = C.accent,
}: {
  value: number;
  max?: number;
  color?: string;
}) {
  value = max > 0 ? value / max : 0;
  return (
    <View style={styles.progress}>
      <View
        style={{
          backgroundColor: color,
          height: 6,
          width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`,
          borderRadius: 6,
        }}
      />
    </View>
  );
}
export function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={S.between}>
      <Text style={S.body}>{label}</Text>
      <Text selectable style={[S.h3, { fontSize: 13, maxWidth: '60%', textAlign: 'right' }]}>
        {value}
      </Text>
    </View>
  );
}

export function ModalPage({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaProvider>
      <SafeAreaView style={S.page} edges={['top', 'bottom', 'left', 'right']}>
        {children}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
export function ModalHeader({
  eyebrow,
  title,
  detail,
  closeLabel,
  onClose,
}: {
  eyebrow?: string;
  title: string;
  detail?: string;
  closeLabel: string;
  onClose(): void;
}) {
  return (
    <View style={styles.modalHeader}>
      <View style={{ flex: 1, gap: 2 }}>
        {eyebrow ? (
          <Text style={S.eyebrow} numberOfLines={1}>
            {eyebrow}
          </Text>
        ) : null}
        <Text style={S.h2} numberOfLines={1}>
          {title}
        </Text>
        {detail ? (
          <Text style={S.small} numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>
      <IconButton icon="x" label={closeLabel} onPress={onClose} />
    </View>
  );
}
const styles = StyleSheet.create({
  button: {
    minHeight: 50,
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  buttonSecondary: { backgroundColor: C.raised, borderWidth: 1, borderColor: C.border },
  buttonText: { fontSize: 15, fontWeight: '700' },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: C.raised,
  },
  badge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6 },
  tabs: { gap: 8, paddingRight: 4 },
  tab: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
    justifyContent: 'center',
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  tabSelected: { backgroundColor: C.ink, borderColor: C.ink },
  tabText: { fontSize: 13, color: C.muted, fontWeight: '600' },
  tabTextSelected: { color: C.background },
  offer: { borderRadius: 18, borderWidth: 1, overflow: 'hidden', backgroundColor: C.surface },
  offerInner: { padding: 12, gap: 8 },
  offerName: { color: C.ink, fontSize: 14, fontWeight: '600', lineHeight: 18, minHeight: 36 },
  discount: {
    backgroundColor: C.accent,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  discountText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  gridCell: { width: '48%', flexGrow: 1, maxWidth: '50%' },
  empty: {
    paddingVertical: 30,
    paddingHorizontal: 22,
    alignItems: 'center',
    gap: 10,
    borderRadius: 18,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  emptyIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: C.raised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loading: { paddingVertical: 28, alignItems: 'center' },
  progress: { height: 6, borderRadius: 6, backgroundColor: C.raised, overflow: 'hidden' },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
});
