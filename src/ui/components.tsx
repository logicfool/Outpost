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
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import type { CatalogItem, Money, Section as DataSection, StoreOffer } from '../core/types';
import { countdown } from '../core/normalize';
import { C, S, rarityColor } from './theme';
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
  icon?: React.ComponentProps<typeof Feather>['name'];
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: secondary ? C.raised : C.accent,
          opacity: disabled ? 0.45 : pressed ? 0.8 : 1,
        },
      ]}
    >
      {icon && <Feather name={icon} size={17} color={C.ink} />}
      <Text style={styles.buttonText}>{title}</Text>
    </Pressable>
  );
}
export function IconButton({
  icon,
  label,
  onPress,
  color = C.muted,
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  label: string;
  onPress(): void;
  color?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={styles.iconButton}
    >
      <Feather name={icon} size={21} color={color} />
    </Pressable>
  );
}
export function Badge({ text, color = C.mint }: { text: string; color?: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: `${color}15` }]}>
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
  items: { id: T; label: string }[];
  value: T;
  onChange(id: T): void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.tabs}
    >
      {items.map((item) => (
        <Pressable
          key={item.id}
          accessibilityRole="tab"
          accessibilityState={{ selected: value === item.id }}
          onPress={() => onChange(item.id)}
          style={[styles.tab, value === item.id && styles.tabSelected]}
        >
          <Text style={[styles.tabText, value === item.id && { color: C.ink }]}>{item.label}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}
export function MoneyText({ prices, large = false }: { prices: Money[]; large?: boolean }) {
  return (
    <Text style={{ color: C.ink, fontSize: large ? 23 : 15, fontWeight: '800' }}>
      {prices.length
        ? prices.map((p) => `${p.amount.toLocaleString()} ${p.symbol}`).join(' + ')
        : 'Price unavailable'}
    </Text>
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
          style={{ width: '95%', height: '95%' }}
          accessibilityLabel={item.name}
          onError={() => setFailed(true)}
        />
      ) : (
        <View style={{ alignItems: 'center', gap: 7 }}>
          <Feather
            name={item.kind === 'skin' || item.kind === 'chroma' ? 'crosshair' : 'hexagon'}
            size={Math.min(36, size / 2)}
            color={rarityColor(item.rarity)}
          />
          <Text style={[S.small, { fontSize: 9, letterSpacing: 2 }]}>
            {item.weapon?.toUpperCase() ?? item.kind.toUpperCase()}
          </Text>
        </View>
      )}
    </View>
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
    <View style={styles.offer}>
      <LinearGradient colors={[`${tint}18`, C.surface]} style={styles.offerInner}>
        <View style={S.between}>
          <Text style={[S.eyebrow, { color: tint, fontSize: 8, letterSpacing: 1.2 }]}>
            {offer.discountPercent !== undefined
              ? `−${offer.discountPercent}%`
              : (offer.item.rarity?.toUpperCase() ?? 'COLLECTION')}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${wished ? 'Remove' : 'Add'} ${offer.item.name} ${wished ? 'from' : 'to'} wishlist`}
            hitSlop={8}
            onPress={onWish}
          >
            <Feather name="heart" size={18} color={wished ? C.accent : C.subtle} />
          </Pressable>
        </View>
        <Pressable
          onPress={onOpen}
          accessibilityRole="button"
          accessibilityLabel={`View ${offer.item.name}`}
        >
          <ItemArt item={offer.item} size={100} />
          <Text numberOfLines={2} style={[S.h3, { minHeight: 39, fontSize: 14 }]}>
            {offer.item.name}
          </Text>
          {offer.originalPrices?.length ? (
            <Text style={[S.small, { textDecorationLine: 'line-through', marginBottom: 4 }]}>
              {offer.originalPrices.map((p) => `${p.amount} ${p.symbol}`).join(' + ')}
            </Text>
          ) : null}
          <MoneyText prices={offer.prices} />
        </Pressable>
      </LinearGradient>
    </View>
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
}: {
  expiresAt: number;
  offset?: number;
  small?: boolean;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <Text
      style={{
        color: C.mint,
        fontSize: small ? 13 : 25,
        fontWeight: '700',
        fontVariant: ['tabular-nums'],
        letterSpacing: small ? 0 : 1,
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
  detail: string;
  icon?: React.ComponentProps<typeof Feather>['name'];
}) {
  return (
    <View style={styles.empty}>
      <Feather name={icon} size={28} color={C.subtle} />
      <Text style={[S.h3, { textAlign: 'center' }]}>{title}</Text>
      <Text style={[S.body, { textAlign: 'center' }]}>{detail}</Text>
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
      <View style={styles.empty}>
        <ActivityIndicator color={C.accent} />
        <Text style={S.body}>No snapshot loaded yet. Refresh or reconnect your account.</Text>
      </View>
    );
  if (value.status === 'error')
    return <Empty icon="alert-circle" title={`${title} unavailable`} detail={value.message} />;
  return <>{children(value.data)}</>;
}
export function ProgressBar({
  value,
  max = 1,
  color = C.mint,
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
          height: 5,
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
const styles = StyleSheet.create({
  button: {
    minHeight: 49,
    borderRadius: 13,
    paddingHorizontal: 17,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 9,
  },
  buttonText: { color: C.ink, fontSize: 14, fontWeight: '700' },
  iconButton: {
    width: 43,
    height: 43,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 13,
    backgroundColor: C.surface,
  },
  badge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  dot: { width: 5, height: 5, borderRadius: 3 },
  badgeText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },
  tabs: { gap: 8, paddingVertical: 1 },
  tab: {
    minHeight: 40,
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
  },
  tabSelected: { backgroundColor: C.raised, borderColor: C.subtle },
  tabText: { fontSize: 12, color: C.subtle, fontWeight: '600' },
  offer: { borderRadius: 17, borderColor: C.border, borderWidth: 1, overflow: 'hidden' },
  offerInner: { padding: 13, paddingBottom: 18 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  gridCell: { width: '48%', flexGrow: 1, maxWidth: '50%' },
  empty: {
    padding: 25,
    alignItems: 'center',
    gap: 12,
    borderRadius: 18,
    backgroundColor: C.surface,
  },
  progress: { height: 5, borderRadius: 6, backgroundColor: C.border, overflow: 'hidden' },
});
