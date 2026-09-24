import { useArtworkRevision } from './ArtworkRevision';
import { Bone, Skeleton, SkeletonGroup, resourceSkeleton, type SkeletonKind } from './Skeleton';
import { ARTWORK_WAIT_MS } from '../state/useArtworkReadiness';
import { Image } from './CachedImage';
import { isUnloadedSection } from '../core/refreshPolicy';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  type ViewStyle,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Feather, Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import type { CatalogItem, Money, Section as DataSection, StoreOffer } from '../core/types';
import { artworkCandidates } from '../core/artwork';
import { countdown, currencySymbol } from '../core/normalize';
import {
  CURRENCY_ICONS,
  rarityColor,
  rarityIcon,
  useTheme,
  useThemedStyles,
  type Palette,
} from './theme';
type IconName = React.ComponentProps<typeof Feather>['name'];
export function ListGroup({ label, children }: { label?: string; children: React.ReactNode }) {
  const { C, S } = useTheme();
  return (
    <View style={{ gap: 8 }}>
      {label ? (
        <Text style={[S.small, { paddingHorizontal: 4, fontSize: 11, letterSpacing: 0.7 }]}>
          {label.toUpperCase()}
        </Text>
      ) : null}
      <View style={{ overflow: 'hidden', borderRadius: 16, backgroundColor: C.surface }}>
        {children}
      </View>
    </View>
  );
}
export function ListRow({
  icon,
  title,
  subtitle,
  value,
  trailing,
  chevron,
  last = false,
  disabled = false,
  label,
  testID,
  onPress,
}: {
  icon?: IconName;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  value?: React.ReactNode;
  trailing?: React.ReactNode;
  chevron?: boolean;
  last?: boolean;
  disabled?: boolean;
  label?: string;
  testID?: string;
  onPress?: () => void;
}) {
  const { C, S } = useTheme();
  const content = (
    <>
      {icon ? (
        <View
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: C.raised,
          }}
        >
          <Feather name={icon} size={16} color={C.accent} />
        </View>
      ) : null}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        {typeof title === 'string' ? (
          <Text style={S.h3} numberOfLines={1}>
            {title}
          </Text>
        ) : (
          title
        )}
        {subtitle ? (
          typeof subtitle === 'string' ? (
            <Text style={S.small} numberOfLines={2}>
              {subtitle}
            </Text>
          ) : (
            subtitle
          )
        ) : null}
      </View>
      {value ? (
        typeof value === 'string' ? (
          <Text style={[S.small, { maxWidth: '38%', textAlign: 'right' }]} numberOfLines={1}>
            {value}
          </Text>
        ) : (
          value
        )
      ) : null}
      {trailing}
      {(chevron ?? !!onPress) ? <Feather name="chevron-right" size={17} color={C.subtle} /> : null}
    </>
  );
  const style = {
    minHeight: 56,
    paddingHorizontal: 14,
    paddingVertical: 11,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 11,
    borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
    opacity: disabled ? 0.5 : 1,
  };
  return onPress ? (
    <Pressable
      accessibilityRole="button"
      testID={testID}
      accessibilityLabel={label ?? (typeof title === 'string' ? title : undefined)}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [style, { opacity: disabled ? 0.5 : pressed ? 0.72 : 1 }]}
    >
      {content}
    </Pressable>
  ) : (
    <View style={style}>{content}</View>
  );
}
export function Button({
  title,
  label,
  onPress,
  secondary = false,
  disabled = false,
  icon,
}: {
  title: string;
  label?: string;
  onPress(): void;
  secondary?: boolean;
  disabled?: boolean;
  icon?: IconName;
}) {
  const { C, S, isDark } = useTheme();
  const styles = useThemedStyles(makeStyles);

  const muted = disabled && !secondary;
  const color = muted ? C.subtle : secondary ? C.ink : '#FFFFFF';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label ?? title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary ? styles.buttonSecondary : { backgroundColor: muted ? C.raised : C.accent },
        { opacity: disabled ? (muted ? 1 : 0.4) : pressed ? 0.8 : 1 },
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
  color,
}: {
  icon: IconName;
  label: string;
  onPress(): void;
  color?: string;
}) {
  const { C, S, isDark } = useTheme();
  const styles = useThemedStyles(makeStyles);
  color ??= C.ink;

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
export function Badge({ text, color }: { text: string; color?: string }) {
  const { C, S, isDark } = useTheme();
  const styles = useThemedStyles(makeStyles);
  color ??= C.mint;
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
  const { C, S, isDark } = useTheme();
  const styles = useThemedStyles(makeStyles);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ flexGrow: 0, flexShrink: 0 }}
      contentContainerStyle={styles.tabs}
    >
      {items.map((item) => {
        const selected = value === item.id;
        return (
          <Pressable
            key={item.id}
            accessibilityRole="tab"
            aria-selected={selected}
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
export function SectionHeader({
  title,
  detail,
  action,
}: {
  title: string;
  detail?: string;
  action?: React.ReactNode;
}) {
  const { S } = useTheme();
  return (
    <View style={S.between}>
      <Text style={[S.h2, { flexShrink: 1 }]}>{title}</Text>
      {action ?? (detail ? <Text style={[S.small, { flexShrink: 0 }]}>{detail}</Text> : null)}
    </View>
  );
}
export function CurrencyIcon({ symbol, size = 16 }: { symbol: string; size?: number }) {
  const { C, S, isDark } = useTheme();

  const uri = CURRENCY_ICONS[symbol];
  return uri ? (
    <Image
      source={{ uri }}
      style={{ width: size, height: size }}
      tintColor={C.ink}
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
  const { C, S, isDark } = useTheme();

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
  const revision = useArtworkRevision();
  const urls = artworkCandidates(item),
    [retry, setRetry] = useState(0);

  return (
    <ItemArtwork
      key={`${item.id}:${urls.join('|')}:${retry}:${revision}`}
      item={item}
      urls={urls}
      size={size}
      style={style}
      onRetry={() => setRetry((n) => n + 1)}
    />
  );
}
function ItemArtwork({
  item,
  urls,
  size,
  style,
  onRetry,
}: {
  item: CatalogItem;
  urls: string[];
  size: number;
  style?: ViewStyle;
  onRetry(): void;
}) {
  const { C, S } = useTheme();
  const [index, setIndex] = useState(0),
    [loaded, setLoaded] = useState(false),
    [expired, setExpired] = useState(false);
  const active = useRef(true),
    current = useRef(index);
  current.current = index;
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    if (loaded || !urls.length) return;

    const timer = setTimeout(() => {
      if (active.current) setExpired(true);
    }, ARTWORK_WAIT_MS);
    return () => clearTimeout(timer);
  }, [loaded, urls.length]);
  const uri = urls[index];
  return (
    <View
      style={[
        { width: '100%', height: size, alignItems: 'center', justifyContent: 'center' },
        style,
      ]}
    >
      {uri ? (
        <Image
          key={uri}
          source={{ uri }}
          contentFit="contain"
          style={{ width: '100%', height: '100%' }}
          accessibilityLabel={item.name}
          onLoad={() => {
            if (active.current && current.current === index) setLoaded(true);
          }}
          onError={() => {
            if (active.current && current.current === index) setIndex((n) => n + 1);
          }}
        />
      ) : urls.length ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Retry artwork for ${item.name}`}
          onPress={onRetry}
          style={{ alignItems: 'center', gap: 4 }}
        >
          <Feather name="refresh-cw" size={Math.min(28, size / 2.5)} color={C.muted} />
          <Text style={S.small}>Retry image</Text>
        </Pressable>
      ) : (
        <View pointerEvents="none">
          <Feather
            name={item.kind === 'title' ? 'type' : 'image'}
            size={Math.min(28, size / 2.5)}
            color={C.muted}
          />
        </View>
      )}
      {uri && !loaded && expired && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Retry artwork for ${item.name}`}
          onPress={onRetry}
          style={{
            position: 'absolute',
            inset: 0,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: C.surface,
          }}
        >
          <Text style={S.small}>Retry image</Text>
        </Pressable>
      )}
      {uri && !loaded && !expired && (
        <SkeletonGroup
          label={`Loading ${item.name} artwork`}
          style={{ position: 'absolute', inset: 0 }}
        >
          <Bone height={size} radius={12} />
        </SkeletonGroup>
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
  const { C, S, isDark } = useTheme();

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
  const { C, S, isDark } = useTheme();
  const styles = useThemedStyles(makeStyles);

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
  const { C, S, isDark } = useTheme();
  const styles = useThemedStyles(makeStyles);

  const [width, setWidth] = useState(0);
  return (
    <View style={styles.grid} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {offers.map((offer, index) => (
        <View
          key={`${offer.id}:${index}`}
          style={[styles.gridCell, width > 0 && { width: (width - 12) / 2 }]}
        >
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
  color,
}: {
  expiresAt: number;
  offset?: number;
  small?: boolean;
  color?: string;
}) {
  const { C, S, isDark } = useTheme();
  color ??= C.ink;

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
  const { C, S, isDark } = useTheme();
  const styles = useThemedStyles(makeStyles);
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
  loading = false,
  skeleton,
  count,
}: {
  section: DataSection<T> | undefined;
  title: string;
  children(data: T): React.ReactNode;
  loading?: boolean;
  skeleton?: SkeletonKind;
  count?: number;
}) {
  const { C, S, isDark } = useTheme();
  const styles = useThemedStyles(makeStyles);

  if (
    !value ||
    (loading && value.status === 'error') ||
    (isUnloadedSection(value) && value.status === 'error' && !value.retryAt)
  )
    return (
      <Skeleton
        kind={skeleton ?? resourceSkeleton(title)}
        count={count ?? (/history|store|collection|skins|weapons/i.test(title) ? 3 : 1)}
        label={`Loading ${title.toLowerCase()}`}
        testID={`loading-${title.toLowerCase()}`}
      />
    );
  if (isUnloadedSection(value))
    return (
      <View
        testID={`waiting-${title.toLowerCase()}`}
        style={[S.card, S.row]}
        accessibilityLiveRegion="polite"
      >
        <Feather name="clock" color={C.subtle} size={20} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={S.h3}>{title}</Text>
          <View style={[S.row, { flexWrap: 'wrap' }]}>
            <Text style={S.small}>
              {value.status === 'error' && value.retryAt
                ? 'Retrying automatically in'
                : 'Preparing first load...'}
            </Text>
            {value.status === 'error' && value.retryAt ? (
              <Timer small expiresAt={value.retryAt} />
            ) : null}
          </View>
        </View>
      </View>
    );
  if (value.status === 'error')
    return (
      <View style={[S.card, S.row, { alignItems: 'flex-start' }]} accessibilityRole="alert">
        <Feather name="alert-circle" color={C.gold} size={20} />
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <Text style={S.h3}>{title} unavailable</Text>
          <Text style={S.body}>{value.message}</Text>
          <Text style={S.small}>
            {value.code}
            {value.retryAt ? ` · Retry after ${new Date(value.retryAt).toLocaleTimeString()}` : ''}
          </Text>
        </View>
      </View>
    );
  return (
    <>
      {value.warning && (
        <Text accessibilityRole="alert" style={[S.small, { color: C.gold }]}>
          Showing saved {title.toLowerCase()}. {value.warning.message}
        </Text>
      )}
      {children(value.data)}
    </>
  );
}
export function ProgressBar({
  value,
  max = 1,
  color,
}: {
  value: number;
  max?: number;
  color?: string;
}) {
  const { C, S, isDark } = useTheme();
  const styles = useThemedStyles(makeStyles);
  color ??= C.accent;
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
  const { C, S, isDark } = useTheme();
  return (
    <View style={S.between}>
      <Text style={S.body}>{label}</Text>
      <Text selectable style={[S.h3, { fontSize: 13, maxWidth: '60%', textAlign: 'right' }]}>
        {value}
      </Text>
    </View>
  );
}

export function sheetPresentation() {
  return Platform.OS === 'ios'
    ? ({ presentationStyle: 'pageSheet', allowSwipeDismissal: true } as const)
    : {};
}

export function ModalPage({ children }: { children: React.ReactNode }) {
  const { C, S, isDark } = useTheme();

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
  const { C, S, isDark } = useTheme();
  const styles = useThemedStyles(makeStyles);

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
const makeStyles = (C: Palette) =>
  StyleSheet.create({
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
    buttonText: { fontSize: 15, fontWeight: '600', flexShrink: 1, textAlign: 'center' },
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
      minHeight: 40,
      paddingVertical: 8,
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
    gridCell: { width: '48%', minWidth: 0 },
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
