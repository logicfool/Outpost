import { isGauntlet, gauntletOwnResult } from '../core/gauntlet';
import { GauntletReportTeams } from './GauntletView';
import { GameDataPanel } from './GameDataPanel';
import { bundleContents, bundleArtwork } from '../core/bundles';
import { ArtworkImage } from './ArtworkImage';
import { hydrateMatchSummary, hydrateMatchDetail } from '../core/maps';
import { usePullRefresh } from '../state/usePullRefresh';
import { useLivePolling } from '../state/useLivePolling';
import { BackupPanel } from './BackupPanel';
import { Skeleton, MATCH_ROW_MIN_HEIGHT } from './Skeleton';
import { ArtworkBoundary } from './ArtworkBoundary';
import type { PreviewIssue } from '../state/useMatchPreviews';
import { CollectionHub } from './CollectionHub';
import { MissionsView } from './MissionsPanel';
import {
  MatchFilterBar,
  applyMatchFilter,
  activeFilterCount,
  matchFilterOptions,
  reconcileFilter,
  EMPTY_FILTER,
  type MatchFilter,
} from './MatchFilters';
import { RoundOverview, DuelMatrix } from './MatchVisuals';
import { PurchaseControls, PurchaseHistory } from './PurchaseControls';
import { useNavInset } from './NavInsets';
import { useScrollHeader } from './ScrollHeader';
import { SessionStatus } from './SessionStatus';
import { useMatchPreviews } from '../state/useMatchPreviews';
import { ChatSettings } from './ChatSettings';
import { Image } from './CachedImage';
import { DiagnosticsPanel } from './DiagnosticsPanel';
import type { Navigate } from './explorerTypes';
import { playerLabel } from '../core/playerNames';
import { PlayerCover } from './profileViews';
import { groupRankedRewind, rewindEntryLabel } from '../core/rankedRewind';
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ActionSheetIOS,
  Alert,
  Animated,
  FlatList,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { SkinVideo } from './SkinVideo';
import type { AppModel } from '../state/useApp';
import type {
  CatalogItem,
  CatalogMedia,
  MatchDetail,
  MatchPlayer,
  MatchSummary,
  Ranked,
  RoundOutcome,
  Store,
  StoreOffer,
} from '../core/types';
import { MAX_ACCOUNTS, XP_PER_LEVEL } from '../core/types';
import { safeError } from '../core/validation';
import { catalogItem, hydrateItem } from '../core/catalog';
import { queueName, walletOverview } from '../core/normalize';
import {
  Badge,
  Button,
  CurrencyIcon,
  Empty,
  InfoRow,
  ItemArt,
  ListGroup,
  ListRow,
  ModalHeader,
  ModalPage,
  MoneyText,
  OfferGrid,
  ProgressBar,
  RarityIcon,
  Resource,
  SectionHeader,
  Tabs,
  Timer,
  WishButton,
  sheetPresentation,
} from './components';
import { rarityColor, useTheme, useThemedStyles, type Palette } from './theme';

export type ScreenName = 'store' | 'collection' | 'progress' | 'matches' | 'account' | 'friends';
type Props = {
  model: AppModel;
  onItem(item: CatalogItem): void;
  onLink(expectedId?: string): void;
  onNavigate: Navigate;
};
export const SHOW_SETTINGS_ACCOUNTS = false;
const date = (value?: number) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '-';
const ago = (value?: number) => {
  if (!value) return '';
  const minutes = Math.round((Date.now() - value) / 60000);
  if (minutes < 60) return `${Math.max(1, minutes)}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days}d ago` : new Date(value).toLocaleDateString();
};
const duration = (ms?: number) =>
  ms ? `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s` : undefined;
const winRate = (wins: number, games: number) =>
  games ? `${((wins * 100) / games).toFixed(1)}%` : '-';
const resultTone = (result: MatchDetail['result'] | undefined, C: Palette) =>
  result === 'WIN' ? C.mint : result === 'LOSS' ? C.accent : C.gold;
const resultLabel = (result?: MatchDetail['result']) =>
  result === 'WIN'
    ? 'Victory'
    : result === 'LOSS'
      ? 'Defeat'
      : result === 'DRAW'
        ? 'Draw'
        : 'Unknown';
const fill = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as const;
function Page({ model, children }: { model: AppModel; children: React.ReactNode }) {
  const pull = usePullRefresh(model.refresh, model.active?.puuid);
  const { C, S, isDark } = useTheme();
  const navInset = useNavInset();
  const scrollHeader = useScrollHeader();

  return (
    <Animated.ScrollView
      {...scrollHeader}
      contentContainerStyle={[S.content, { paddingBottom: 24 + navInset }]}
      refreshControl={
        <RefreshControl
          refreshing={pull.refreshing}
          onRefresh={pull.refresh}
          tintColor={C.accent}
        />
      }
      showsVerticalScrollIndicator={false}
    >
      {children}
    </Animated.ScrollView>
  );
}
function Heading({ eyebrow, title }: { eyebrow: string; title: React.ReactNode }) {
  const { C, S, isDark } = useTheme();
  const navInset = useNavInset();

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 8,
        flexWrap: 'wrap',
      }}
    >
      <Text accessibilityRole="header" style={S.title} numberOfLines={1}>
        {title}
      </Text>
      <Text style={[S.eyebrow, { fontSize: 9, letterSpacing: 1 }]}>{eyebrow}</Text>
    </View>
  );
}
function Countdown({
  label,
  expiresAt,
  offset,
  color,
  icon,
}: {
  label: string;
  expiresAt: number;
  offset: number;
  color: string;
  icon: React.ComponentProps<typeof Feather>['name'];
}) {
  const { C, S, isDark } = useTheme();
  const navInset = useNavInset();
  const styles = useThemedStyles(makeStyles);

  return (
    <LinearGradient
      colors={[`${color}2E`, `${color}08`]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.countdown, { borderColor: `${color}33` }]}
    >
      <View style={{ gap: 2 }}>
        <Text style={S.small}>{label}</Text>
        <Timer expiresAt={expiresAt} offset={offset} />
      </View>
      <View style={[styles.countdownIcon, { backgroundColor: `${color}26` }]}>
        <Feather name={icon} size={18} color={color} />
      </View>
    </LinearGradient>
  );
}
function Wallet({ model }: { model: AppModel }) {
  const { C, S, isDark } = useTheme();
  const navInset = useNavInset();
  const styles = useThemedStyles(makeStyles);

  return (
    <Resource section={model.snapshot?.wallet} title="Balances" loading={model.busy}>
      {(balances) => (
        <View style={styles.wallet} testID="compact-wallet">
          {walletOverview(balances).map((m) => (
            <View key={m.currencyId} style={styles.currency}>
              <CurrencyIcon symbol={m.symbol} size={16} />
              <View style={{ flexShrink: 1, minWidth: 0, gap: 1 }}>
                <Text style={[S.small, { fontSize: 10, lineHeight: 14 }]}>{m.symbol}</Text>
                <Text
                  style={styles.balance}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.8}
                >
                  {m.amount === null ? '-' : m.amount.toLocaleString()}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </Resource>
  );
}
function AgentFrame({ image, size = 48 }: { image?: string; size?: number }) {
  const { C, S, isDark } = useTheme();
  const navInset = useNavInset();
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={[styles.agentFrame, { width: size, height: size, borderRadius: size / 4 }]}>
      {image ? (
        <Image
          source={{ uri: image }}
          style={{ width: '100%', height: '100%' }}
          resizeMode="cover"
        />
      ) : (
        <Feather name="user" size={size / 2.4} color={C.subtle} />
      )}
    </View>
  );
}
function MiniStat({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number | null;
  color?: string;
}) {
  const { C, S, isDark } = useTheme();
  const navInset = useNavInset();
  const styles = useThemedStyles(makeStyles);
  color ??= C.ink;

  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 2 }}>
      <Text style={[styles.miniValue, { color }]}>{value ?? '-'}</Text>
      <Text style={styles.miniLabel}>{label}</Text>
    </View>
  );
}
type StoreRow =
  | { id: string; kind: 'offers'; offers: StoreOffer[]; wide?: boolean }
  | { id: string; kind: 'bundle'; bundle: Store['bundles'][number] }
  | { id: string; kind: 'archive'; entries: [string, { name: string; image?: string }][] }
  | { id: string; kind: 'heading'; title: string; detail?: string }
  | { id: string; kind: 'history'; entry: AppModel['history'][number] };
const StoreGap = () => <View style={{ height: 12 }} />;
const storeKey = (row: StoreRow) => row.id;
const DailyOffer = memo(function DailyOffer({
  offer,
  wished,
  onWish,
  onItem,
}: {
  offer: StoreOffer;
  wished: boolean;
  onWish(id: string): void;
  onItem(item: CatalogItem): void;
}) {
  const { C, S } = useTheme(),
    tint = rarityColor(offer.item.rarity);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`View ${offer.item.name}`}
      onPress={() => onItem(offer.item)}
      style={({ pressed }) => ({
        opacity: pressed ? 0.78 : 1,
        width: '100%',
        borderRadius: 20,
        backgroundColor: C.surface,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: `${tint}35`,
      })}
    >
      <LinearGradient
        colors={[`${tint}16`, `${tint}04`]}
        style={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: 14 }}
      >
        <View style={{ position: 'absolute', top: 12, right: 14, zIndex: 1 }}>
          <WishButton
            wished={wished}
            name={offer.item.name}
            onPress={() => onWish(offer.item.canonicalId)}
          />
        </View>
        <ItemArt item={offer.item} size={82} style={{ paddingHorizontal: 26 }} />
        <View style={[S.between, { alignItems: 'center' }]}>
          <View style={[S.row, { flex: 1, minWidth: 0, gap: 7 }]}>
            <RarityIcon rarity={offer.item.rarity} size={18} />
            <Text style={[S.h3, { flexShrink: 1 }]} numberOfLines={2}>
              {offer.item.name}
            </Text>
          </View>
          <MoneyText prices={offer.prices} />
        </View>
      </LinearGradient>
    </Pressable>
  );
});
export function StoreScreen({ model, onItem, onNavigate }: Props) {
  const pull = usePullRefresh(model.refresh, model.active?.puuid);
  const { C, S } = useTheme(),
    styles = useThemedStyles(makeStyles),
    navInset = useNavInset();
  const scrollHeader = useScrollHeader();
  const [bundleLimit, setBundleLimit] = useState(12),
    [bundleSearch, setBundleSearch] = useState(false),
    [bundleQuery, setBundleQuery] = useState('');
  const archive = useMemo(
    () =>
      Object.entries(model.catalog.bundles)
        .filter(([, b]) => b.name.toLowerCase().includes(bundleQuery.trim().toLowerCase()))
        .sort((a, b) => a[1].name.localeCompare(b[1].name)),
    [model.catalog.bundles, bundleQuery],
  );
  const lastBundleQuery = useRef(bundleQuery);
  useEffect(() => {
    if (lastBundleQuery.current !== bundleQuery) {
      lastBundleQuery.current = bundleQuery;
      setBundleLimit(12);
    }
  }, [bundleQuery]);
  const [tab, setTab] = useState<'daily' | 'night' | 'bundles' | 'accessories' | 'history'>(
    'daily',
  );
  const store = model.snapshot?.store.status === 'ready' ? model.snapshot.store.data : undefined;
  const onWish = useCallback(
    (id: string) => {
      void model.toggleWish(id);
    },
    [model.toggleWish],
  );
  const rows = useMemo(() => {
    const result: StoreRow[] = [];
    const addOffers = (prefix: string, offers: StoreOffer[], wide = false) => {
      const batch = wide ? 1 : 2;
      for (let i = 0; i < offers.length; i += batch)
        result.push({
          id: prefix + i,
          kind: 'offers',
          wide,
          offers: offers
            .slice(i, i + batch)
            .map((o) => ({ ...o, item: hydrateItem(model.catalog, o.item) })),
        });
    };
    if (tab === 'history')
      return model.history.map((entry) => ({ id: entry.id, kind: 'history' as const, entry }));
    if (!store && tab !== 'bundles') return result;
    if (tab === 'daily') addOffers('daily', store?.daily ?? [], true);
    if (tab === 'accessories') addOffers('accessory', store?.accessories ?? []);
    if (tab === 'night') addOffers('night', store?.nightMarket?.offers ?? []);
    if (tab === 'bundles') {
      for (const bundle of (store?.bundles ?? []).filter((b) =>
        b.name.toLowerCase().includes(bundleQuery.trim().toLowerCase()),
      )) {
        result.push({ id: 'bundle' + bundle.id, kind: 'bundle', bundle });
        addOffers(bundle.id, bundle.offers);
      }
      result.push({
        id: 'archive-heading',
        kind: 'heading',
        title: 'All bundles',
        detail: String(archive.length),
      });
      for (let i = 0; i < Math.min(bundleLimit, archive.length); i += 2)
        result.push({ id: 'archive' + i, kind: 'archive', entries: archive.slice(i, i + 2) });
    }
    return result;
  }, [tab, store, model.catalog, model.history, bundleLimit, archive, bundleQuery]);
  const grid = useCallback(
    (offers: StoreOffer[]) => (
      <OfferGrid offers={offers} wishlist={model.wishlist} onWish={onWish} onOpen={onItem} />
    ),
    [model.wishlist, onWish, onItem],
  );
  const render = useCallback(
    ({ item: row }: { item: StoreRow }) => {
      if (row.kind === 'offers')
        return row.wide ? (
          <DailyOffer
            offer={row.offers[0]!}
            wished={model.wishlist.includes(row.offers[0]!.item.canonicalId)}
            onWish={onWish}
            onItem={onItem}
          />
        ) : (
          grid(row.offers)
        );
      if (row.kind === 'heading') return <SectionHeader title={row.title} detail={row.detail} />;
      if (row.kind === 'history')
        return (
          <View style={{ gap: 10 }}>
            <SectionHeader title={date(row.entry.observedAt)} />
            {grid(
              row.entry.offers.map((o) => ({ ...o, item: hydrateItem(model.catalog, o.item) })),
            )}
          </View>
        );
      if (row.kind === 'archive')
        return (
          <View style={{ flexDirection: 'row', gap: 12 }}>
            {row.entries.map(([id, bundle]) => (
              <Pressable
                key={id}
                accessibilityRole="button"
                accessibilityLabel={`Open ${bundle.name} bundle`}
                onPress={() => onNavigate({ type: 'bundle', id })}
                style={[styles.archiveCard, { flex: 1, width: undefined }]}
              >
                <ArtworkImage
                  candidates={bundleArtwork(id, bundle)}
                  label={bundle.name}
                  style={styles.archiveImage}
                  contentFit="cover"
                  transition={0}
                />
                <Text style={[S.h3, { fontSize: 13, paddingHorizontal: 10 }]} numberOfLines={2}>
                  {bundle.name}
                </Text>
              </Pressable>
            ))}
            {row.entries.length === 1 && <View style={{ flex: 1 }} />}
          </View>
        );
      const info = bundleContents(model.catalog, row.bundle.id, store);
      const bundle = {
        ...row.bundle,
        name: info.name,
        image: info.image,
        imageFallbacks: info.imageFallbacks,
      };
      return (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open ${bundle.name} bundle`}
          onPress={() => onNavigate({ type: 'bundle', id: bundle.id })}
          style={styles.bundle}
        >
          <ArtworkImage
            candidates={bundleArtwork(bundle.catalogId ?? bundle.id, bundle)}
            label={bundle.name}
            containerStyle={fill}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
          />
          <LinearGradient colors={[`${C.background}00`, `${C.background}F0`]} style={fill} />
          <View style={styles.bundleInfo}>
            <Text style={[S.eyebrow, { color: C.ink }]}>FEATURED BUNDLE</Text>
            <Text style={S.h2} numberOfLines={2}>
              {bundle.name}
            </Text>
            <View style={S.between}>
              <MoneyText prices={bundle.prices} large />
              <Timer
                small
                expiresAt={bundle.expiresAt}
                offset={store?.clockOffsetMs}
                color={C.muted}
              />
            </View>
          </View>
        </Pressable>
      );
    },
    [
      model.wishlist,
      model.catalog,
      onWish,
      onItem,
      onNavigate,
      grid,
      styles,
      C,
      S,
      store?.clockOffsetMs,
    ],
  );
  const expiry =
    tab === 'daily'
      ? store?.dailyExpiresAt
      : tab === 'accessories'
        ? store?.accessoriesExpireAt
        : tab === 'night'
          ? store?.nightMarket?.expiresAt
          : undefined;
  return (
    <Animated.FlatList
      {...scrollHeader}
      data={rows}
      renderItem={render}
      keyExtractor={storeKey}
      ItemSeparatorComponent={StoreGap}
      initialNumToRender={6}
      maxToRenderPerBatch={4}
      windowSize={5}
      updateCellsBatchingPeriod={32}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[S.content, { gap: 0, paddingBottom: 24 + navInset }]}
      refreshControl={
        <RefreshControl
          refreshing={pull.refreshing}
          onRefresh={pull.refresh}
          tintColor={C.accent}
        />
      }
      ListHeaderComponent={
        <View style={{ gap: 16, paddingBottom: 16 }}>
          <Heading eyebrow="YOUR DAILY DROP" title="Store" />
          <Wallet model={model} />
          <Tabs
            value={tab}
            onChange={setTab}
            items={[
              { id: 'daily', label: 'Today' },
              { id: 'night', label: 'Night Market' },
              { id: 'bundles', label: 'Bundles' },
              { id: 'accessories', label: 'Accessories' },
              { id: 'history', label: 'History' },
            ]}
          />
          {tab === 'history' && (
            <Button
              title="Saved Night Markets & bundles"
              secondary
              icon="archive"
              onPress={() => onNavigate({ type: 'market-history' })}
            />
          )}
          {tab === 'bundles' && (
            <View style={S.between}>
              <Text style={S.small}>Browse collections</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={bundleSearch ? 'Close bundle search' : 'Search bundles'}
                onPress={() => {
                  setBundleSearch((v) => !v);
                  setBundleQuery('');
                }}
                style={{ padding: 8 }}
              >
                <Feather name={bundleSearch ? 'x' : 'search'} size={22} color={C.ink} />
              </Pressable>
            </View>
          )}
          {tab === 'bundles' && bundleSearch && (
            <TextInput
              autoFocus
              value={bundleQuery}
              onChangeText={setBundleQuery}
              accessibilityLabel="Bundle search"
              placeholder="Search bundles"
              placeholderTextColor={C.subtle}
              style={S.input}
            />
          )}
          {expiry !== undefined && (
            <View style={[S.between, { paddingHorizontal: 4, paddingVertical: 2 }]}>
              <View style={{ gap: 3 }}>
                <Text style={S.small}>{tab === 'night' ? 'Ends in' : 'Resets in'}</Text>
                <Text style={[S.small, { fontSize: 11 }]}>Pull down to refresh</Text>
              </View>
              <View style={S.row}>
                <Feather name="clock" color={C.subtle} size={16} />
                <Timer small expiresAt={expiry} offset={store?.clockOffsetMs} />
              </View>
            </View>
          )}
          {model.snapshot?.refreshIssue && (
            <Text accessibilityRole="alert" style={[S.small, { color: C.gold }]}>
              {model.snapshot.refreshIssue.message}
            </Text>
          )}
          {!store && tab !== 'history' && (
            <Resource section={model.snapshot?.store} title="Store" loading={model.busy}>
              {() => null}
            </Resource>
          )}
        </View>
      }
      ListEmptyComponent={
        store || tab === 'history' ? (
          <Empty
            title={
              tab === 'night'
                ? 'Night Market is closed'
                : tab === 'history'
                  ? 'No saved rotations yet'
                  : 'No offers returned'
            }
            detail="Pull down to refresh."
            icon={tab === 'night' ? 'moon' : 'shopping-bag'}
          />
        ) : null
      }
      ListFooterComponent={
        <View style={{ paddingVertical: 18, gap: 16 }}>
          {tab === 'bundles' && archive.length > bundleLimit && (
            <Button
              title="Show more bundles"
              secondary
              onPress={() => setBundleLimit((n) => n + 12)}
            />
          )}
          {store && (
            <Text style={[S.small, { textAlign: 'center' }]}>
              Updated {date(store.fetchedAt)} · auto at daily reset
            </Text>
          )}
        </View>
      }
    />
  );
}
function ItemTile({
  item,
  wished,
  onOpen,
  onWish,
  label,
}: {
  item: CatalogItem;
  wished?: boolean;
  onOpen(): void;
  onWish?(): void;
  label?: string;
}) {
  const { C, S, isDark } = useTheme();
  const navInset = useNavInset();
  const styles = useThemedStyles(makeStyles);

  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`View ${item.name}`}
      style={({ pressed }) => [styles.tile, { opacity: pressed ? 0.85 : 1 }]}
    >
      <View style={S.between}>
        {label ? (
          <Text style={[S.small, { fontWeight: '700' }]} numberOfLines={1}>
            {label}
          </Text>
        ) : (
          <RarityIcon rarity={item.rarity} size={16} />
        )}
        {onWish && <WishButton wished={!!wished} name={item.name} onPress={onWish} size={18} />}
      </View>
      <ItemArt item={item} size={80} />
      <Text style={styles.tileName} numberOfLines={2}>
        {item.name}
      </Text>
      <View style={[styles.tileBar, { backgroundColor: rarityColor(item.rarity) }]} />
    </Pressable>
  );
}
export function CollectionScreen({ model, onNavigate }: Props) {
  return <CollectionHub model={model} onNavigate={onNavigate} />;
}
function BattlePassRewards({
  model,
  onItem,
}: {
  model: AppModel;
  onItem(item: CatalogItem): void;
}) {
  const { C, S, isDark } = useTheme();
  const navInset = useNavInset();
  const styles = useThemedStyles(makeStyles);

  if (model.snapshot?.progression.status !== 'ready') return null;
  const active = model.snapshot.progression.data.contracts.find((c) => c.currentBattlepass);
  const def = active ? model.catalog.contracts[active.id] : undefined;
  if (!def?.levels?.length) return null;
  const rewards = def.levels
    .map((level, index) => ({
      index,
      xp: level.xp,
      amount: level.rewardAmount,
      item: level.rewardId ? catalogItem(model.catalog, level.rewardId) : undefined,
    }))
    .filter((v) => v.item);
  if (!rewards.length) return null;
  return (
    <View style={{ gap: 12 }}>
      <SectionHeader title="Rewards" detail={`${rewards.length} tiers`} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 10 }}
      >
        {rewards.map((reward) => (
          <Pressable
            key={`${active?.id}:${reward.index}`}
            style={[
              styles.rewardCard,
              active && reward.index < active.level && { borderColor: `${C.mint}66` },
            ]}
            onPress={() => reward.item && onItem(reward.item)}
          >
            <Text style={[S.small, { fontWeight: '700' }]}>TIER {reward.index + 1}</Text>
            {reward.item && <ItemArt item={reward.item} size={72} />}
            <Text style={[S.h3, { fontSize: 13 }]} numberOfLines={2}>
              {reward.item?.name}
              {reward.amount && reward.amount > 1 ? ` ×${reward.amount}` : ''}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
function Stat({ label, value }: { label: string; value: string | number | null }) {
  const { C, S, isDark } = useTheme();
  const navInset = useNavInset();
  return (
    <View style={{ flex: 1, gap: 4 }}>
      <Text style={S.small}>{label}</Text>
      <Text style={[S.h2, { fontVariant: ['tabular-nums'] }]}>{value ?? '-'}</Text>
    </View>
  );
}
function BattlePassSummary({ model }: { model: AppModel }) {
  const { C, S, isDark } = useTheme();
  const navInset = useNavInset();

  return (
    <Resource title="Battle Pass" section={model.snapshot?.progression}>
      {(progress) => {
        const pass = progress.contracts.find((c) => c.currentBattlepass);
        if (!pass)
          return (
            <View style={S.card}>
              <Text style={S.h3}>No current pass returned</Text>
              <Text style={S.body}>Refresh to check the active act.</Text>
            </View>
          );
        const total = model.catalog.contracts[pass.id]?.levels.length;
        return (
          <View style={[S.card, { gap: 14 }]}>
            <View style={[S.between, { alignItems: 'flex-start' }]}>
              <View style={{ flex: 1, gap: 5 }}>
                <Text style={S.small}>CURRENT BATTLE PASS</Text>
                <Text style={S.h2}>{pass.name}</Text>
              </View>
              <Badge text="ACTIVE" color={C.mint} />
            </View>
            <View style={[S.row, { alignItems: 'baseline' }]}>
              <Text style={[S.title, { fontSize: 34 }]}>Tier {pass.level}</Text>
              {total && <Text style={S.body}>of {total}</Text>}
            </View>
            {total && <ProgressBar value={pass.level} max={total} />}
            <Text style={S.small}>
              {total && pass.level >= total
                ? 'All reported tiers completed'
                : pass.nextLevelXp
                  ? `${pass.xp.toLocaleString()} / ${pass.nextLevelXp.toLocaleString()} XP to next tier`
                  : 'Progress reported by Riot'}
            </Text>
          </View>
        );
      }}
    </Resource>
  );
}
function LevelCard({ model }: { model: AppModel }) {
  const { C, S, isDark } = useTheme();
  const navInset = useNavInset();

  return (
    <Resource title="Account level" section={model.snapshot?.xp}>
      {(xp) => (
        <View style={[S.between, { paddingHorizontal: 4 }]}>
          <Text style={S.body}>Account level {xp.level}</Text>
          <Text style={S.small}>{xp.xp.toLocaleString()} / 5,000 XP</Text>
        </View>
      )}
    </Resource>
  );
}
export function ProgressScreen({ model, onItem }: Props) {
  const { C, S, isDark } = useTheme();
  const navInset = useNavInset();
  const styles = useThemedStyles(makeStyles);

  return (
    <Page model={model}>
      <Heading eyebrow="SEASON PROGRESS" title="Battle Pass" />
      <BattlePassSummary model={model} />
      <LevelCard model={model} />
      <BattlePassRewards model={model} onItem={onItem} />
      <Resource title="Contracts" section={model.snapshot?.progression}>
        {(progress) => (
          <>
            <SectionHeader title="Missions" />
            <MissionsView progression={progress} catalog={model.catalog} />
            {progress.contracts.some((c) => !c.currentBattlepass) && (
              <SectionHeader title="Other contracts" />
            )}
            {progress.contracts.length ? (
              progress.contracts
                .filter((contract) => !contract.currentBattlepass)
                .map((contract) => (
                  <View style={S.card} key={contract.id}>
                    {contract.currentBattlepass && <Badge text="ACTIVE" color={C.accent} />}
                    <View style={S.between}>
                      <Text style={[S.h3, { flex: 1 }]}>{contract.name}</Text>
                      <Text style={S.h3}>Tier {contract.level}</Text>
                    </View>
                    {contract.nextLevelXp !== undefined && (
                      <>
                        <ProgressBar value={contract.xp} max={contract.nextLevelXp} />
                        <Text style={S.small}>
                          {contract.xp.toLocaleString()} / {contract.nextLevelXp.toLocaleString()}{' '}
                          XP
                        </Text>
                      </>
                    )}
                    {contract.nextReward && (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`View next reward ${contract.nextReward.name}`}
                        style={[S.row, styles.nextReward]}
                        onPress={() => onItem(contract.nextReward!)}
                      >
                        <ItemArt item={contract.nextReward} size={52} style={{ width: 76 }} />
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text style={S.small}>NEXT REWARD</Text>
                          <Text style={S.h3} numberOfLines={1}>
                            {contract.nextReward.name}
                          </Text>
                        </View>
                        <Feather name="chevron-right" size={18} color={C.subtle} />
                      </Pressable>
                    )}
                  </View>
                ))
            ) : (
              <Empty title="No active contracts" detail="Pull down to refresh." icon="flag" />
            )}
          </>
        )}
      </Resource>
    </Page>
  );
}
function ProfileBanner({ model, onNavigate }: { model: AppModel; onNavigate: Navigate }) {
  const loadout =
    model.snapshot?.loadout.status === 'ready' ? model.snapshot.loadout.data : undefined;
  const xp = model.snapshot?.xp.status === 'ready' ? model.snapshot.xp.data : undefined;
  if (!loadout && !model.observedIdentity && (!model.snapshot || model.busy))
    return <Skeleton kind="profile" label="Loading your profile" />;
  return (
    <PlayerCover
      player={{
        subject: model.active!.puuid,
        name: model.active!.gameName,
        tag: model.active!.tagLine,
        card: loadout?.card ?? model.observedIdentity?.player.card,
        title: loadout?.title ?? model.observedIdentity?.player.title,
        level: xp?.level,
      }}
      catalog={model.catalog}
      note={
        !loadout?.card && model.observedIdentity
          ? `Last ${model.observedIdentity.source === 'match' ? 'match' : 'equipped'} identity · ${date(model.observedIdentity.at)}`
          : undefined
      }
      xp={xp?.xp}
      onEdit={() => onNavigate({ type: 'identity' })}
    />
  );
}
function RankOverview({ model, onOpen }: { model: AppModel; onOpen(): void }) {
  const { C, S, isDark } = useTheme();
  const navInset = useNavInset();
  const styles = useThemedStyles(makeStyles);

  return (
    <Resource title="Rank" section={model.snapshot?.rank}>
      {(rank) => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open career summary"
          onPress={onOpen}
          style={({ pressed }) => [S.card, { opacity: pressed ? 0.85 : 1 }]}
        >
          <View style={S.between}>
            <Text style={S.h3}>Rank</Text>
            <View style={[S.row, { gap: 4 }]}>
              <Text style={S.small}>Career</Text>
              <Feather name="chevron-right" size={16} color={C.subtle} />
            </View>
          </View>
          {rank.note && <Text style={S.small}>{rank.note}</Text>}
          <View style={styles.rankRow}>
            <View style={styles.rankCol}>
              <Text style={S.small} numberOfLines={1}>
                {rank.seasonName ?? 'Current'}
              </Text>
              {rank.image ? (
                <Image source={{ uri: rank.image }} style={styles.rankIcon} resizeMode="contain" />
              ) : (
                <View style={styles.rankIconEmpty}>
                  <Feather name="award" size={30} color={C.subtle} />
                </View>
              )}
              <Text style={S.h3}>{rank.name}</Text>
              {rank.rr !== null ? (
                <View style={{ alignSelf: 'stretch', gap: 4, alignItems: 'center' }}>
                  <Text style={S.small}>{rank.rr} RR</Text>
                  <View style={{ alignSelf: 'stretch' }}>
                    <ProgressBar value={rank.rr} max={100} />
                  </View>
                </View>
              ) : null}
            </View>
            <View style={styles.rankDivider} />
            <View style={styles.rankCol}>
              <Text style={S.small} numberOfLines={1}>
                {rank.peak?.seasonName ? `Peak · ${rank.peak.seasonName}` : 'Peak'}
              </Text>
              {rank.peak?.image ? (
                <Image
                  source={{ uri: rank.peak.image }}
                  style={styles.rankIcon}
                  resizeMode="contain"
                />
              ) : (
                <View style={styles.rankIconEmpty}>
                  <Feather name="trending-up" size={30} color={C.subtle} />
                </View>
              )}
              <Text style={S.h3}>{rank.peak?.name ?? '-'}</Text>
              <Text style={S.small}>Peak rank</Text>
            </View>
          </View>
        </Pressable>
      )}
    </Resource>
  );
}
export function CareerModal({
  rank,
  visible,
  onClose,
  embedded = false,
}: {
  rank?: Ranked;
  visible: boolean;
  onClose(): void;
  embedded?: boolean;
}) {
  const { C, S, isDark } = useTheme();
  const navInset = useNavInset();
  const styles = useThemedStyles(makeStyles);

  const career = rank?.career ?? [];
  const [queue, setQueue] = useState('competitive'),
    [open, setOpen] = useState<string | null>(null);
  const current = career.find((entry) => entry.queue === queue) ?? career[0];
  const ranked = current?.queue === 'competitive',
    [latest, ...previous] = current?.acts ?? [];
  const content = (
    <ModalPage>
      <ModalHeader title="Career summary" closeLabel="Close career summary" onClose={onClose} />
      <ScrollView contentContainerStyle={[S.content, { paddingBottom: 24 + navInset }]}>
        {!current || !latest ? (
          <Empty
            title="No career stats yet"
            detail="Play a few matches and refresh."
            icon="bar-chart-2"
          />
        ) : (
          <>
            {career.length > 1 && (
              <Tabs
                value={current.queue}
                onChange={setQueue}
                items={career.map((entry) => ({ id: entry.queue, label: queueName(entry.queue) }))}
              />
            )}
            <View style={S.card}>
              <View style={S.between}>
                <Text style={S.h3}>{latest.name}</Text>
                {latest.current && <Badge text="CURRENT" color={C.violet} />}
              </View>
              <View style={S.divider} />
              <View style={styles.rankRow}>
                {ranked && (
                  <>
                    <View style={styles.rankCol}>
                      {latest.image ? (
                        <Image
                          source={{ uri: latest.image }}
                          style={styles.rankIconLarge}
                          resizeMode="contain"
                        />
                      ) : (
                        <View style={styles.rankIconEmpty}>
                          <Feather name="award" size={34} color={C.subtle} />
                        </View>
                      )}
                      <Text style={S.h3}>{latest.tierName}</Text>
                      {latest.rr !== null ? <Text style={S.small}>{latest.rr} RR</Text> : null}
                    </View>
                    <View style={styles.rankDivider} />
                  </>
                )}
                <View style={[styles.rankCol, { gap: 12 }]}>
                  <View style={{ alignItems: 'center' }}>
                    <Text
                      style={[
                        styles.bigStat,
                        { color: latest.wins * 2 >= latest.games ? C.mint : C.accent },
                      ]}
                    >
                      {winRate(latest.wins, latest.games)}
                    </Text>
                    <Text style={S.small}>Win rate</Text>
                  </View>
                  <View style={{ alignItems: 'center' }}>
                    <Text style={[styles.bigStat, { color: C.blue }]}>
                      {latest.wins} / {latest.games}
                    </Text>
                    <Text style={S.small}>Wins / games</Text>
                  </View>
                </View>
              </View>
            </View>
            <View style={S.card}>
              <View style={S.between}>
                <Text style={S.h3}>All-time</Text>
                <Text style={S.small}>
                  {current.acts.length} {current.acts.length === 1 ? 'act' : 'acts'}
                </Text>
              </View>
              <View style={S.row}>
                <MiniStat
                  label="Win rate"
                  value={winRate(current.wins, current.games)}
                  color={current.wins * 2 >= current.games ? C.mint : C.accent}
                />
                <MiniStat
                  label="Wins / games"
                  value={`${current.wins} / ${current.games}`}
                  color={C.blue}
                />
              </View>
            </View>
            {previous.length > 0 && (
              <SectionHeader title="Previous acts" detail={`${previous.length}`} />
            )}
            {previous.map((act) => {
              const expanded = open === act.seasonId;
              return (
                <Pressable
                  key={act.seasonId}
                  onPress={() => setOpen(expanded ? null : act.seasonId)}
                  style={S.card}
                >
                  <View style={S.row}>
                    {ranked ? (
                      act.image ? (
                        <Image
                          source={{ uri: act.image }}
                          style={{ width: 40, height: 40 }}
                          resizeMode="contain"
                        />
                      ) : (
                        <View style={[styles.rankIconEmpty, { width: 40, height: 40 }]}>
                          <Feather name="help-circle" size={20} color={C.subtle} />
                        </View>
                      )
                    ) : null}
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={S.h3}>{act.name}</Text>
                      <Text style={S.small}>
                        {ranked ? `${act.tierName} · ` : ''}
                        {act.games} games
                      </Text>
                    </View>
                    <Feather
                      name={expanded ? 'chevron-up' : 'chevron-down'}
                      size={18}
                      color={C.subtle}
                    />
                  </View>
                  {expanded && (
                    <View style={S.row}>
                      <MiniStat label="Win rate" value={winRate(act.wins, act.games)} />
                      <MiniStat label="Wins" value={act.wins} />
                      <MiniStat label="Games" value={act.games} />
                      {ranked && <MiniStat label="RR" value={act.rr} />}
                    </View>
                  )}
                </Pressable>
              );
            })}
          </>
        )}
      </ScrollView>
    </ModalPage>
  );
  return embedded ? (
    content
  ) : (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      {...sheetPresentation()}
    >
      {content}
    </Modal>
  );
}
export function MatchCard({
  match,
  detail,
  issue,
  onPress,
}: {
  match: MatchSummary;
  detail?: MatchDetail;
  issue?: PreviewIssue;
  onPress(): void;
}) {
  const { C, S, isDark } = useTheme();
  const navInset = useNavInset();
  const styles = useThemedStyles(makeStyles);

  detail = detail ?? (match.preview as MatchDetail | undefined);
  if (!detail)
    return issue ? (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open unavailable match report"
        onPress={onPress}
        style={[
          styles.matchCard,
          { minHeight: MATCH_ROW_MIN_HEIGHT, padding: 16, justifyContent: 'center', gap: 6 },
        ]}
      >
        <Text style={S.h3}>Match preview unavailable</Text>
        <Text style={S.small}>
          {issue.code === 'RATE_LIMIT' ? 'Riot asked us to wait.' : 'Tap to open the report.'} Retry
          after{' '}
          {new Date(issue.retryAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Text>
      </Pressable>
    ) : (
      <Skeleton kind="match" label="Loading match" testID={`match-skeleton-${match.id}`} />
    );
  const tone = resultTone(detail.result, C),
    map = detail.map,
    image = detail.mapImage ?? match.mapImage;
  return (
    <ArtworkBoundary
      identity={`match-${match.id}`}
      urls={[image, detail.agentImage, match.tierImage]}
      placeholder={
        <Skeleton
          kind="match"
          label="Loading match artwork"
          testID={`match-artwork-skeleton-${match.id}`}
        />
      }
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${map} match`}
        onPress={onPress}
        style={({ pressed }) => [styles.matchCard, { opacity: pressed ? 0.85 : 1 }]}
      >
        {image ? <Image source={{ uri: image }} style={fill} resizeMode="cover" /> : null}
        <LinearGradient
          colors={[`${C.surface}F7`, `${C.surface}EE`, `${C.surface}C0`]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={fill}
        />
        <View style={styles.matchBody}>
          <AgentFrame image={detail?.agentImage} size={50} />
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={S.h3} numberOfLines={1}>
              {map}
            </Text>
            <Text style={S.small} numberOfLines={1}>
              {queueName(match.queue)} · {ago(match.startedAt)}
            </Text>
            {detail ? (
              <Text style={[S.small, { color: C.muted }]}>
                K/D/A {detail.kills ?? '-'}/{detail.deaths ?? '-'}/{detail.assists ?? '-'}
              </Text>
            ) : null}
          </View>
          <View style={{ alignItems: 'flex-end', gap: 3 }}>
            {detail ? (
              <Text style={[styles.resultText, { color: tone }]}>
                {resultLabel(detail.result).toUpperCase()}
              </Text>
            ) : (
              <Feather name="file-text" size={16} color={C.subtle} />
            )}
            {detail ? (
              <Text style={styles.matchScore}>
                {isGauntlet({
                  queue: match.queue,
                  mapId: detail.mapId ?? match.mapId,
                  map: detail.map,
                })
                  ? detail.placement
                    ? `#${detail.placement}`
                    : detail.result === 'WIN'
                      ? 'Winning duo'
                      : detail.result === 'LOSS'
                        ? 'Duo eliminated'
                        : '2v2 survival'
                  : detail.score}
              </Text>
            ) : null}
            <View style={[S.row, { gap: 4 }]}>
              {match.tierImage ? (
                <Image
                  source={{ uri: match.tierImage }}
                  style={{ width: 16, height: 16 }}
                  resizeMode="contain"
                />
              ) : null}
              {match.rrChange !== undefined && (
                <Text style={[styles.rr, { color: match.rrChange >= 0 ? C.mint : C.accent }]}>
                  {match.rrChange > 0 ? '+' : ''}
                  {match.rrChange} RR
                </Text>
              )}
            </View>
          </View>
        </View>
        <View style={[styles.matchStripe, { backgroundColor: tone }]} />
      </Pressable>
    </ArtworkBoundary>
  );
}
const ROUND_ICONS: Record<
  RoundOutcome,
  React.ComponentProps<typeof MaterialCommunityIcons>['name']
> = {
  elimination: 'skull-outline',
  detonate: 'bomb',
  defuse: 'bomb-off',
  time: 'timer-sand',
  surrender: 'flag-outline',
  other: 'circle-small',
};
function PlayerRow({
  player,
  ally,
  onOpen,
  ownId,
}: {
  player: MatchPlayer;
  ally: boolean;
  onOpen(): void;
  ownId?: string;
}) {
  const { C, S, isDark } = useTheme();
  const navInset = useNavInset();
  const styles = useThemedStyles(makeStyles);

  const you = player.subject === ownId,
    label = playerLabel(player, ownId);
  const kd = player.kills !== null && player.deaths ? player.kills / player.deaths : null,
    stripe = you ? C.gold : ally ? C.mint : C.accent;
  return (
    <Pressable
      onPress={onOpen}
      disabled={!!player.hidden}
      accessibilityRole="button"
      accessibilityLabel={`View ${label} profile`}
      style={[styles.playerCard, you && { borderColor: `${C.gold}59` }]}
    >
      <View style={[S.row, { gap: 12 }]}>
        <AgentFrame image={player.agentImage} size={34} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[S.h3, you && { color: C.gold }]} numberOfLines={1}>
            {label}
            {!you && player.tag ? (
              <Text style={{ color: C.subtle, fontWeight: '400' }}> #{player.tag}</Text>
            ) : null}
          </Text>
          <Text style={S.small} numberOfLines={1}>
            {player.agent}
            {player.level !== null ? ` · Level ${player.level}` : ''}
          </Text>
        </View>
        {player.tierImage ? (
          <Image
            source={{ uri: player.tierImage }}
            style={{ width: 30, height: 30 }}
            resizeMode="contain"
          />
        ) : null}
      </View>
      <View style={S.row}>
        <MiniStat
          label="K/D"
          value={kd === null ? null : kd.toFixed(2)}
          color={kd === null ? C.ink : kd >= 1 ? C.mint : C.accent}
        />
        <MiniStat
          label="K/D/A"
          value={`${player.kills ?? '-'}/${player.deaths ?? '-'}/${player.assists ?? '-'}`}
        />
        <MiniStat
          label="HS%"
          value={player.headshotPct === null ? null : `${Math.round(player.headshotPct)}%`}
        />
        <MiniStat label="ACS" value={player.acs} color={C.blue} />
      </View>
      <View style={[styles.playerStripe, { backgroundColor: stripe }]} />
    </Pressable>
  );
}
export function MatchReport({
  id,
  model,
  onClose,
  onNavigate,
  subject,
  embedded = false,
}: {
  id: string | null;
  model: AppModel;
  onClose(): void;
  onNavigate: Navigate;
  subject?: string;
  embedded?: boolean;
}) {
  const { C, S, isDark } = useTheme();
  const navInset = useNavInset();
  const styles = useThemedStyles(makeStyles);

  const [detail, setDetail] = useState<MatchDetail | null>(null),
    [error, setError] = useState<string | null>(null),
    [tab, setTab] = useState<'scoreboard' | 'rounds' | 'duels'>('scoreboard');
  useEffect(() => {
    let alive = true;
    setDetail(null);
    setError(null);
    setTab('scoreboard');
    if (id)
      model
        .matchDetail(id, subject)
        .then((data) => {
          if (alive) setDetail(data);
        })
        .catch((reason) => {
          if (alive) setError(safeError(reason).message);
        });
    return () => {
      alive = false;
    };
  }, [id, subject, model.matchDetail]);
  const own = detail?.teams.find((t) => t.id === detail.teamId),
    other = detail?.teams.find((t) => t.id !== detail.teamId),
    gauntletMode = !!detail && isGauntlet(detail),
    teamGame = !gauntletMode && detail?.teams.length === 2;
  const tone = resultTone(detail?.result, C);
  const content = (
    <ModalPage>
      <ModalHeader
        eyebrow={detail ? queueName(detail.queue).toUpperCase() : undefined}
        title={detail?.map ?? 'Match report'}
        closeLabel="Close match report"
        onClose={onClose}
      />
      <ScrollView contentContainerStyle={[S.content, { paddingBottom: 24 + navInset }]}>
        {error ? (
          <Empty title="Report unavailable" detail={error} icon="alert-circle" />
        ) : !detail ? (
          <Skeleton kind="report" label="Loading match report" />
        ) : (
          <>
            <View style={[styles.reportHero, { minHeight: 132, padding: 16, gap: 5 }]}>
              {detail.mapImage ? (
                <Image source={{ uri: detail.mapImage }} style={fill} resizeMode="cover" />
              ) : (
                <LinearGradient colors={[`${tone}40`, C.surface]} style={fill} />
              )}
              <LinearGradient colors={[`${C.background}80`, `${C.background}F2`]} style={fill} />
              <Text style={[S.eyebrow, { color: tone }]}>
                {resultLabel(detail.result).toUpperCase()}
              </Text>
              {gauntletMode ? (
                <Text style={[styles.heroScore, { fontSize: 26 }]}>
                  {gauntletOwnResult(detail)}
                </Text>
              ) : teamGame && own && other && own.roundsWon !== null && other.roundsWon !== null ? (
                <Text style={styles.heroScore}>
                  <Text style={{ color: C.mint }}>{own.roundsWon}</Text>
                  <Text style={{ color: C.subtle }}> - </Text>
                  <Text style={{ color: C.accent }}>{other.roundsWon}</Text>
                </Text>
              ) : (
                <Text style={styles.heroScore}>{detail.score}</Text>
              )}
              <Text style={S.body}>
                {[detail.agent, duration(detail.durationMs), date(detail.startedAt)]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </View>
            <View style={[S.card, { padding: 12 }]}>
              <View style={S.row}>
                <MiniStat
                  label="K/D/A"
                  value={`${detail.kills ?? '-'}/${detail.deaths ?? '-'}/${detail.assists ?? '-'}`}
                />
                <MiniStat label="ACS" value={detail.acs} color={C.blue} />
                <MiniStat
                  label="HS%"
                  value={detail.headshotPct === null ? null : `${detail.headshotPct}%`}
                />
                <MiniStat
                  label="K/D"
                  value={
                    detail.kills !== null && detail.deaths
                      ? (detail.kills / detail.deaths).toFixed(2)
                      : null
                  }
                />
              </View>
            </View>
            <Tabs
              value={tab}
              onChange={setTab}
              items={[
                { id: 'scoreboard', label: 'Scoreboard' },
                ...(teamGame && detail.rounds.length
                  ? [{ id: 'rounds' as const, label: 'Rounds' }]
                  : []),
                { id: 'duels', label: 'Duels' },
              ]}
            />
            {tab === 'scoreboard' &&
              (gauntletMode ? (
                <GauntletReportTeams
                  detail={detail}
                  ownId={model.active?.puuid}
                  renderPlayer={(player, friendly) => (
                    <PlayerRow
                      player={player}
                      ownId={model.active?.puuid}
                      ally={friendly}
                      onOpen={() => onNavigate({ type: 'player', player })}
                    />
                  )}
                />
              ) : teamGame ? (
                [own, other].map(
                  (team) =>
                    team && (
                      <View key={team.id} style={{ gap: 10 }}>
                        <SectionHeader
                          title={
                            team === own
                              ? subject && subject !== model.active?.puuid
                                ? 'Player’s team'
                                : 'Your team'
                              : 'Opposing team'
                          }
                          detail={team.roundsWon !== null ? `${team.roundsWon} rounds` : undefined}
                        />
                        {detail.players
                          .filter((p) => p.teamId === team.id)
                          .map((player) => (
                            <PlayerRow
                              key={player.subject}
                              player={player}
                              ownId={model.active?.puuid}
                              ally={team === own}
                              onOpen={() => onNavigate({ type: 'player', player })}
                            />
                          ))}
                      </View>
                    ),
                )
              ) : (
                detail.players.map((player) => (
                  <PlayerRow
                    key={player.subject}
                    player={player}
                    ownId={model.active?.puuid}
                    ally={player.self}
                    onOpen={() => onNavigate({ type: 'player', player })}
                  />
                ))
              ))}
            {tab === 'rounds' && <RoundOverview detail={detail} onNavigate={onNavigate} />}
            {tab === 'duels' && (
              <DuelMatrix detail={detail} ownId={model.active?.puuid} onNavigate={onNavigate} />
            )}
          </>
        )}
      </ScrollView>
    </ModalPage>
  );
  return embedded ? (
    content
  ) : (
    <Modal
      visible={id !== null}
      animationType="slide"
      onRequestClose={onClose}
      {...sheetPresentation()}
    >
      {content}
    </Modal>
  );
}
export const HistoryRow = memo(function HistoryRow({
  match,
  detail,
  issue,
  onOpen,
  catalog,
}: {
  catalog?: import('../core/types').Catalog;
  match: MatchSummary;
  detail?: MatchDetail;
  issue?: PreviewIssue;
  onOpen(id: string): void;
}) {
  return (
    <MatchCard
      match={catalog ? hydrateMatchSummary(catalog, match) : match}
      detail={detail && catalog ? hydrateMatchDetail(catalog, detail) : detail}
      issue={issue}
      onPress={() => onOpen(match.id)}
    />
  );
});
const matchKey = (match: MatchSummary) => match.id;
const HistoryGap = () => <View style={{ height: 12 }} />;
export function MatchesScreen({ model, onNavigate }: Props) {
  const polling = useLivePolling(model);
  const { C, S } = useTheme(),
    navInset = useNavInset();
  const scrollHeader = useScrollHeader();
  const [filter, setFilter] = useState<MatchFilter>(EMPTY_FILTER),
    [loadingOlder, setLoadingOlder] = useState(false);
  const previews = useMatchPreviews(model),
    details = previews.details;
  const savedMatches =
    model.snapshot?.matches.status === 'ready' ? model.snapshot.matches.data : undefined;
  const matches = useMemo(
    () => savedMatches?.map((row) => hydrateMatchSummary(model.catalog, row)),
    [savedMatches, model.catalog.maps],
  );
  const options = useMemo(() => matchFilterOptions(matches ?? [], details), [matches, details]);
  const active = useMemo(() => reconcileFilter(filter, options), [filter, options]);
  const shown = useMemo(
    () => applyMatchFilter(matches ?? [], active, details),
    [matches, active, details],
  );
  const open = useCallback((id: string) => onNavigate({ type: 'match', id }), [onNavigate]);
  const render = useCallback(
    ({ item }: { item: MatchSummary }) => (
      <HistoryRow
        catalog={model.catalog}
        match={item}
        detail={details[item.id]}
        issue={previews.issue}
        onOpen={open}
      />
    ),
    [details, previews.issue, open, model.catalog],
  );
  const rank = model.snapshot?.rank.status === 'ready' ? model.snapshot.rank.data : undefined;
  const game =
    model.snapshot?.liveGame.status === 'ready' ? model.snapshot.liveGame.data : undefined;
  const rewindDays = useMemo(
    () => groupRankedRewind(matches ?? [], model.catalog.tiers),
    [matches, model.catalog.tiers],
  );
  const liveTitle =
    game?.state === 'in_game'
      ? `In game${game.map ? ` · ${game.map}` : ''}`
      : game?.state === 'agent_select'
        ? 'Agent select'
        : 'Not in a game';
  return (
    <Animated.FlatList
      {...scrollHeader}
      data={shown}
      renderItem={render}
      keyExtractor={matchKey}
      ItemSeparatorComponent={HistoryGap}
      onViewableItemsChanged={previews.onViewableItemsChanged}
      viewabilityConfig={previews.viewabilityConfig}
      initialNumToRender={6}
      maxToRenderPerBatch={6}
      windowSize={5}
      updateCellsBatchingPeriod={32}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[S.content, { gap: 0, paddingBottom: 24 + navInset }]}
      refreshControl={
        <RefreshControl
          refreshing={polling.refreshing}
          onRefresh={polling.refresh}
          tintColor={C.accent}
        />
      }
      ListHeaderComponent={
        <View style={{ gap: 16, paddingBottom: 16 }}>
          <Heading eyebrow="YOUR CAREER" title="Profile" />
          <ProfileBanner model={model} onNavigate={onNavigate} />
          <RankOverview model={model} onOpen={() => rank && onNavigate({ type: 'career', rank })} />
          {model.snapshot?.profileIssue && (
            <Text style={[S.small, { color: C.gold }]}>{model.snapshot.profileIssue.message}</Text>
          )}
          <ListGroup>
            <ListRow
              icon="award"
              title="Rank History"
              subtitle={rank?.seasonName ?? 'Act-by-act ranked performance'}
              label="Open rank history"
              onPress={() => onNavigate({ type: 'rank-history' })}
            />
            <ListRow
              icon="rewind"
              title="Ranked Rewind"
              subtitle={rewindEntryLabel(rewindDays)}
              label="Open ranked rewind"
              onPress={() => onNavigate({ type: 'ranked-rewind' })}
            />
            <ListRow
              icon="users"
              title="Party"
              subtitle="Queue, invites and party code"
              label="Open your party"
              testID="open-party"
              onPress={() => onNavigate({ type: 'party' })}
            />
            <ListRow
              icon={game?.state === 'in_game' ? 'radio' : 'moon'}
              title={liveTitle}
              subtitle={polling.busy ? 'Checking live status' : 'Live match watcher is running'}
              label="View live game details"
              trailing={polling.busy ? <ActivityIndicator size="small" color={C.muted} /> : null}
              onPress={() => onNavigate({ type: 'live' })}
              last
            />
          </ListGroup>
          <SectionHeader title="Match history" />
          {!!matches?.length && (
            <MatchFilterBar
              matches={matches}
              details={details}
              value={active}
              onChange={setFilter}
            />
          )}
          {model.snapshot?.matches.status !== 'ready' && (
            <Resource title="Match history" section={model.snapshot?.matches}>
              {() => null}
            </Resource>
          )}
        </View>
      }
      ListEmptyComponent={
        matches ? (
          <Empty
            title="No matches in this view"
            detail={activeFilterCount(active) ? 'Clear a filter to see more matches.' : undefined}
            icon="crosshair"
          />
        ) : null
      }
      ListFooterComponent={
        !model.active?.demo && !!matches?.length && matches.length < 10000 ? (
          <View style={{ paddingTop: 16 }}>
            <View style={{ gap: 12 }}>
              {loadingOlder && <Skeleton kind="match" count={2} label="Loading older matches" />}
              <Button
                title="Load older matches"
                secondary
                disabled={loadingOlder}
                onPress={() => {
                  if (loadingOlder) return;
                  setLoadingOlder(true);
                  void model.moreMatches().finally(() => setLoadingOlder(false));
                }}
              />
            </View>
          </View>
        ) : null
      }
    />
  );
}
export function AccountScreen({ model, onLink }: Props) {
  const { C, S, isDark } = useTheme();
  const navInset = useNavInset();
  const styles = useThemedStyles(makeStyles);

  const [confirm, setConfirm] = useState<'remove' | 'cache' | 'signout' | null>(null),
    [working, setWorking] = useState(false),
    [actionError, setActionError] = useState<string>();
  const active = model.active!;
  useEffect(() => {
    setConfirm(null);
    setActionError(undefined);
  }, [active.puuid]);
  const confirmAction = async () => {
    if (!confirm || working) return;
    setWorking(true);
    setActionError(undefined);
    try {
      if (confirm === 'signout') await model.signOut(active.puuid);
      else if (confirm === 'remove') await model.remove(active.puuid);
      else await model.clearCache();
      setConfirm(null);
    } catch (e) {
      setActionError(safeError(e).message);
    } finally {
      setWorking(false);
    }
  };
  const live = active.expiresAt > Date.now(),
    renewable = active.canReauth;
  const theme = model.settings.theme ?? 'navy';
  const themeLabel = { system: 'System', navy: 'Navy', dark: 'Dark', light: 'Light' }[theme];
  const chooseTheme = () => {
    const choices = [
      { label: 'System', value: 'system' as const },
      { label: 'Navy', value: 'navy' as const },
      { label: 'Dark', value: 'dark' as const },
      { label: 'Light', value: 'light' as const },
    ];
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: 'Theme',
          options: [...choices.map((choice) => choice.label), 'Cancel'],
          cancelButtonIndex: choices.length,
        },
        (index) => {
          const choice = choices[index];
          if (choice) void model.setTheme(choice.value);
        },
      );
      return;
    }
    Alert.alert(
      'Theme',
      undefined,
      choices.map((choice) => ({
        text: choice.label,
        onPress: () => void model.setTheme(choice.value),
      })),
    );
  };
  const showPlatform = () =>
    Platform.OS === 'ios'
      ? ActionSheetIOS.showActionSheetWithOptions(
          {
            title: 'Outpost supports PC VALORANT accounts.',
            options: ['PC', 'Cancel'],
            cancelButtonIndex: 1,
          },
          () => {},
        )
      : Alert.alert('Platform', 'Outpost supports PC VALORANT accounts.');
  return (
    <>
      <Page model={model}>
        <Heading eyebrow="SETTINGS" title="Account" />
        <View style={S.card}>
          <View style={S.between}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={S.h2}>
                {active.gameName}
                <Text style={{ color: C.subtle }}>#{active.tagLine}</Text>
              </Text>
              <Text style={S.small}>
                {active.region.toUpperCase()} · {active.shard.toUpperCase()}
              </Text>
            </View>
            <Badge
              text={
                active.demo
                  ? 'DEMO'
                  : live
                    ? 'CONNECTED'
                    : renewable
                      ? 'AUTO RENEW'
                      : 'SIGN IN AGAIN'
              }
              color={active.demo ? C.gold : live ? C.mint : C.accent}
            />
          </View>
          {!active.demo && (
            <>
              <View style={S.divider} />
              <InfoRow label="Session expires" value={date(active.expiresAt)} />
              <InfoRow label="Account created" value={date(active.createdAt)} />
              <InfoRow label="Country" value={active.country ?? '-'} />
              <InfoRow
                label="Email verified"
                value={
                  active.emailVerified === undefined ? '-' : active.emailVerified ? 'Yes' : 'No'
                }
              />
              <SessionStatus accountId={active.puuid} revision={model.snapshot?.fetchedAt} />
              <View style={S.row}>
                <View style={{ flex: 1 }}>
                  <Button
                    title="Reconnect"
                    secondary
                    icon="refresh-cw"
                    onPress={() => onLink(active.puuid)}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    title="Sign out"
                    secondary
                    icon="log-out"
                    onPress={() => {
                      setActionError(undefined);
                      setConfirm('signout');
                    }}
                  />
                </View>
              </View>
            </>
          )}
        </View>
        {SHOW_SETTINGS_ACCOUNTS && (
          <>
            <SectionHeader title="Accounts" detail={`${model.accounts.length} / ${MAX_ACCOUNTS}`} />
            {model.accounts.map((account) => {
              const current = account.puuid === active.puuid;
              return (
                <Pressable
                  key={account.puuid}
                  accessibilityRole="button"
                  onPress={() => model.switchAccount(account)}
                  style={[S.card, S.between, current && { borderColor: `${C.accent}80` }]}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={S.h3}>
                      {account.gameName}
                      <Text style={{ color: C.subtle }}>#{account.tagLine}</Text>
                    </Text>
                    <Text style={S.small}>
                      {account.region.toUpperCase()} ·{' '}
                      {account.expiresAt > Date.now()
                        ? 'Connected'
                        : account.canReauth
                          ? 'Auto-renew available'
                          : 'Sign in again'}
                    </Text>
                  </View>
                  <Feather
                    name={current ? 'check-circle' : 'chevron-right'}
                    size={20}
                    color={current ? C.accent : C.subtle}
                  />
                </Pressable>
              );
            })}
            <Button
              title="Add account"
              icon="plus"
              disabled={model.accounts.length >= MAX_ACCOUNTS || Platform.OS === 'web'}
              onPress={() => onLink()}
            />
          </>
        )}
        {active.demo && <Button title="Leave demo" secondary onPress={model.leaveDemo} />}
        <SectionHeader title="Appearance" />
        {Platform.OS === 'ios' ? (
          <ListGroup>
            <ListRow
              icon="moon"
              title="Theme"
              subtitle="System follows your device appearance"
              value={themeLabel}
              onPress={chooseTheme}
            />
            <ListRow
              icon="monitor"
              title="Platform"
              subtitle="Riot account platform"
              value="PC"
              onPress={showPlatform}
              last
            />
          </ListGroup>
        ) : (
          <View style={S.card}>
            <Tabs
              value={theme}
              onChange={(choice) => void model.setTheme(choice)}
              items={[
                { id: 'navy', label: 'Navy' },
                { id: 'dark', label: 'Dark' },
                { id: 'light', label: 'Light' },
                { id: 'system', label: 'System' },
              ]}
            />
          </View>
        )}
        <SectionHeader title="Video" />
        <ListGroup>
          <Setting
            title="Autoplay previews"
            detail="Play skin previews automatically."
            value={model.settings.autoplayVideos !== false}
            onChange={(value) => void model.setAutoplayVideos(value)}
          />
          <Setting
            title="Video sound"
            detail="Start previews with sound."
            value={model.settings.videoSound !== false}
            onChange={(value) => void model.setVideoSound(value)}
            last
          />
        </ListGroup>
        <SectionHeader title="Chat history" />
        <View style={S.card}>
          <ChatSettings model={model} />
        </View>
        <SectionHeader title="Refresh schedule" />
        <View style={S.card}>
          <InfoRow label="Live matches" value="Every 5 seconds in game" />
          <View style={S.divider} />
          <InfoRow label="Automatic store refresh" value="When the daily timer resets" />
          <View style={S.divider} />
          <InfoRow label="Skins & catalog" value="Patch-aware cache" />
          <Text style={S.small}>
            Idle and Profile updates run every 60 seconds. Saved match reports are reused. Pull to
            check for new data.
          </Text>
          <GameDataPanel key={active.puuid} model={model} />
        </View>
        <SectionHeader title="Notifications" />
        <ListGroup>
          <Setting
            title="Store reminders"
            detail="At the daily reset."
            value={model.settings.reminders}
            disabled={active.demo || Platform.OS === 'web'}
            onChange={(value) => void model.saveSettings({ ...model.settings, reminders: value })}
          />
          <Setting
            title="Wishlist alerts"
            detail="Daily store, Night Market and bundles."
            value={!!model.settings.wishlistAlerts}
            disabled={active.demo || Platform.OS === 'web'}
            onChange={(value) =>
              void model.saveSettings({ ...model.settings, wishlistAlerts: value })
            }
          />
          <Setting
            title="Chat alerts"
            detail="New messages while Outpost is open."
            value={!!model.settings.chatAlerts}
            disabled={active.demo || Platform.OS === 'web'}
            onChange={(value) => void model.saveSettings({ ...model.settings, chatAlerts: value })}
          />
          <Setting
            title="Notification previews"
            detail="Show names and message text on the lock screen."
            value={!!model.settings.notificationPreviews}
            disabled={active.demo || Platform.OS === 'web'}
            onChange={(value) =>
              void model.saveSettings({ ...model.settings, notificationPreviews: value })
            }
          />
          <Setting
            title="Background refresh"
            detail="At store reset, when your phone allows it."
            value={model.settings.backgroundSync}
            disabled={active.demo || Platform.OS === 'web'}
            onChange={(value) =>
              void model.saveSettings({ ...model.settings, backgroundSync: value })
            }
            last
          />
        </ListGroup>
        <SectionHeader title="Phone purchases" />
        <View style={S.card}>
          <Setting
            title="Allow VP purchases"
            detail="Daily skins only. Confirmation required."
            value={!!model.settings.allowPurchases}
            disabled={active.demo || Platform.OS === 'web'}
            onChange={(value) =>
              void model.saveSettings({ ...model.settings, allowPurchases: value })
            }
          />
          <PurchaseHistory model={model} />
        </View>
        <SectionHeader title="Data" />
        <BackupPanel model={model} />
        <DiagnosticsPanel model={model} />
        <Button
          title="Clear cached data"
          secondary
          icon="trash-2"
          disabled={!!active.demo}
          onPress={() => setConfirm('cache')}
        />
        {!active.demo && (
          <Button
            title="Remove this account"
            secondary
            icon="log-out"
            onPress={() => setConfirm('remove')}
          />
        )}
        <SectionHeader title="About" />
        <View style={S.card}>
          <Text style={S.body}>Unofficial VALORANT companion. Not endorsed by Riot Games.</Text>
          <Text style={S.body}>
            Sessions are saved securely. Chats are encrypted on this device. Sign out ends the saved
            Riot web session; Remove locally only deletes local data.
          </Text>
          <Text style={S.small}>Outpost 0.9.2</Text>
        </View>
      </Page>
      <Modal
        visible={confirm !== null}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!working) setConfirm(null);
        }}
      >
        <View style={styles.scrim}>
          <View style={[S.card, { width: '100%', maxWidth: 440 }]}>
            <Text style={S.h2}>
              {confirm === 'signout'
                ? 'Sign out of this account?'
                : confirm === 'remove'
                  ? 'Remove this account?'
                  : 'Clear cached data?'}
            </Text>
            <Text style={S.body}>
              {confirm === 'signout'
                ? 'End this Riot web session and delete this account’s local chats, wishlist and presets? Other accounts and devices are not signed out.'
                : confirm === 'remove'
                  ? 'Delete this account and its local chats, wishlist and presets?'
                  : 'Temporary game data, artwork and catalog will be cleared. Saved matches, store history, accounts, chats and presets stay.'}
            </Text>
            {actionError && (
              <Text accessibilityRole="alert" style={[S.small, { color: C.gold }]}>
                {actionError}
              </Text>
            )}
            {confirm === 'signout' && actionError && (
              <Button
                secondary
                title="Remove locally instead"
                disabled={working}
                onPress={() => {
                  setActionError(undefined);
                  setConfirm('remove');
                }}
              />
            )}
            <Button
              title={working ? 'Working…' : 'Confirm'}
              disabled={working}
              onPress={() => void confirmAction()}
            />
            <Button title="Cancel" secondary disabled={working} onPress={() => setConfirm(null)} />
          </View>
        </View>
      </Modal>
    </>
  );
}
function Setting({
  title,
  detail,
  value,
  onChange,
  disabled,
  last,
}: {
  title: string;
  detail: string;
  value: boolean;
  onChange(value: boolean): void;
  disabled?: boolean;
  last?: boolean;
}) {
  const { C } = useTheme();
  return (
    <ListRow
      title={title}
      subtitle={detail}
      disabled={disabled}
      last={last}
      trailing={
        <Switch
          accessibilityLabel={title}
          value={value}
          disabled={disabled}
          onValueChange={onChange}
          trackColor={{ false: C.raised, true: C.accent }}
          thumbColor={C.ink}
        />
      }
    />
  );
}
export function ItemModal({
  item: original,
  model,
  onClose,
  embedded = false,
}: {
  item: CatalogItem | null;
  model: AppModel;
  onClose(): void;
  embedded?: boolean;
}) {
  const { C, S, isDark } = useTheme();
  const navInset = useNavInset();
  const styles = useThemedStyles(makeStyles);

  const item = original ? hydrateItem(model.catalog, original) : null;
  const [preview, setPreview] = useState<CatalogMedia | null>(null);
  useEffect(() => setPreview(null), [item?.id]);
  const selectedPreview = preview
    ? ([...(item?.levels ?? []), ...(item?.chromas ?? [])].find((p) => p.id === preview.id) ??
      preview)
    : null;
  const shown = selectedPreview ?? item,
    video = selectedPreview ? selectedPreview.video : item?.video,
    tint = rarityColor(item?.rarity);
  const wished = item ? model.wishlist.includes(item.canonicalId) : false,
    weaponItem = item?.kind === 'skin' || item?.kind === 'chroma';
  const content = (
    <ModalPage>
      <ModalHeader
        eyebrow={(item?.weapon ?? item?.kind ?? '').toUpperCase()}
        title={item?.name ?? ''}
        closeLabel="Close item details"
        onClose={onClose}
      />
      {item && (
        <ScrollView contentContainerStyle={[S.content, { paddingBottom: 24 + navInset }]}>
          <LinearGradient
            colors={[`${tint}40`, `${tint}0D`, C.background]}
            style={styles.detailHero}
          >
            {shown?.image ? (
              <Image
                source={{ uri: shown.image }}
                style={{ width: '100%', height: 200 }}
                resizeMode="contain"
              />
            ) : (
              <ItemArt item={item} size={200} />
            )}
          </LinearGradient>
          <View style={S.between}>
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={S.title} numberOfLines={2}>
                {shown?.name ?? item.name}
              </Text>
              {item.rarity ? (
                <View style={[S.row, { gap: 6 }]}>
                  <RarityIcon rarity={item.rarity} size={16} />
                  <Text style={[S.small, { color: tint, fontWeight: '700' }]}>
                    {item.rarity.toUpperCase()}
                  </Text>
                </View>
              ) : null}
            </View>
            <WishButton
              wished={wished}
              name={item.name}
              size={26}
              onPress={() => void model.toggleWish(item.canonicalId)}
            />
          </View>
          <PurchaseControls key={`${model.active?.puuid}:${item.id}`} item={item} model={model} />
          {video ? (
            <SkinVideo
              key={video}
              uri={video}
              autoplay={model.settings.autoplayVideos !== false}
              sound={model.settings.videoSound !== false}
              onSoundChange={model.setVideoSound}
              refresh={model.refreshMedia}
            />
          ) : weaponItem ? (
            <Text style={S.small}>No preview for this selection.</Text>
          ) : null}
          {item.levels && item.levels.length > 1 ? (
            <>
              <SectionHeader title="Levels" />
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 10 }}
              >
                {item.levels.map((level, index) => (
                  <Pressable
                    key={level.id}
                    onPress={() => setPreview(level)}
                    style={[
                      styles.mediaChip,
                      preview?.id === level.id && { borderColor: C.accent },
                    ]}
                  >
                    <View style={S.between}>
                      <Text style={[S.small, { fontWeight: '700' }]}>LEVEL {index + 1}</Text>
                      {level.video ? (
                        <Feather name="play-circle" color={C.accent} size={14} />
                      ) : null}
                    </View>
                    {level.image ? (
                      <Image
                        source={{ uri: level.image }}
                        style={{ width: 120, height: 56 }}
                        resizeMode="contain"
                      />
                    ) : null}
                    <Text style={[S.h3, { fontSize: 13 }]} numberOfLines={1}>
                      {level.name}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </>
          ) : null}
          {item.chromas && item.chromas.length > 1 ? (
            <>
              <SectionHeader title="Variants" />
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 10 }}
              >
                {item.chromas.map((chroma) => (
                  <Pressable
                    key={chroma.id}
                    onPress={() => setPreview(chroma)}
                    style={[
                      styles.mediaChip,
                      preview?.id === chroma.id && { borderColor: C.accent },
                    ]}
                  >
                    {chroma.image ? (
                      <Image
                        source={{ uri: chroma.image }}
                        style={{ width: 120, height: 64 }}
                        resizeMode="contain"
                      />
                    ) : null}
                    <View style={S.between}>
                      <Text style={[S.h3, { fontSize: 13, flex: 1 }]} numberOfLines={1}>
                        {chroma.name}
                      </Text>
                      {chroma.video ? (
                        <Feather name="play-circle" color={C.accent} size={14} />
                      ) : null}
                    </View>
                  </Pressable>
                ))}
              </ScrollView>
            </>
          ) : null}
        </ScrollView>
      )}
    </ModalPage>
  );
  return embedded ? (
    content
  ) : (
    <Modal visible={!!item} animationType="slide" onRequestClose={onClose} {...sheetPresentation()}>
      {content}
    </Modal>
  );
}
const makeStyles = (C: Palette) =>
  StyleSheet.create({
    countdown: {
      borderRadius: 18,
      padding: 16,
      borderWidth: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    countdownIcon: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
    },
    wallet: {
      flexDirection: 'row',
      gap: 2,
      backgroundColor: C.surface,
      borderRadius: 16,
      paddingHorizontal: 6,
      paddingVertical: 3,
      borderWidth: 0.5,
      borderColor: C.border,
    },
    currency: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: C.surface,
      borderRadius: 14,
      borderWidth: 0,
      borderColor: C.border,
      paddingHorizontal: 8,
      paddingVertical: 8,
    },
    balance: { color: C.ink, fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
    bundle: {
      height: 200,
      borderRadius: 18,
      overflow: 'hidden',
      backgroundColor: C.surface,
      borderWidth: 1,
      borderColor: C.border,
      justifyContent: 'flex-end',
    },
    bundleInfo: { padding: 16, gap: 6 },
    tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
    tileCell: { width: '48%', flexGrow: 1, maxWidth: '50%' },
    archiveCard: {
      width: '48%',
      flexGrow: 1,
      maxWidth: '50%',
      backgroundColor: C.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: C.border,
      overflow: 'hidden',
      paddingBottom: 12,
      gap: 10,
    },
    archiveImage: { width: '100%', height: 90, backgroundColor: C.raised },
    tile: {
      backgroundColor: C.surface,
      borderRadius: 16,
      padding: 12,
      paddingBottom: 14,
      borderWidth: 1,
      borderColor: C.border,
      gap: 8,
      overflow: 'hidden',
    },
    tileName: { color: C.ink, fontSize: 13, fontWeight: '600', lineHeight: 17, minHeight: 34 },
    tileBar: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 3 },
    search: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: C.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: C.border,
      paddingHorizontal: 14,
    },
    searchInput: { flex: 1, color: C.ink, fontSize: 15, paddingVertical: 12 },
    rewardCard: {
      width: 130,
      backgroundColor: C.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: C.border,
      padding: 12,
      gap: 6,
    },
    nextReward: { backgroundColor: C.raised, borderRadius: 14, padding: 10 },
    banner: {
      backgroundColor: C.surface,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: C.border,
      overflow: 'hidden',
    },
    bannerArt: { height: 120, backgroundColor: C.raised },
    bannerBody: { paddingHorizontal: 16, paddingBottom: 16, marginTop: -28, gap: 14 },
    bannerAvatar: {
      width: 56,
      height: 56,
      borderRadius: 14,
      borderWidth: 2,
      borderColor: C.surface,
      backgroundColor: C.raised,
    },
    levelPill: {
      position: 'absolute',
      top: 12,
      right: 12,
      backgroundColor: `${C.background}E6`,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 5,
    },
    levelText: { color: C.ink, fontSize: 12, fontWeight: '700' },
    rankRow: { flexDirection: 'row', alignItems: 'center' },
    rankCol: { flex: 1, alignItems: 'center', gap: 6, paddingHorizontal: 6 },
    rankDivider: { width: 1, alignSelf: 'stretch', backgroundColor: C.border, marginVertical: 8 },
    rankIcon: { width: 64, height: 64 },
    rankIconLarge: { width: 88, height: 88 },
    rankIconEmpty: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: C.raised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    bigStat: { fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] },
    miniValue: { fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
    miniLabel: { color: C.subtle, fontSize: 10, fontWeight: '600', letterSpacing: 0.8 },
    liveCard: {
      overflow: 'hidden',
      minHeight: 76,
      backgroundColor: C.surface,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: C.border,
      padding: 14,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    liveIcon: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
    },
    matchCard: {
      borderRadius: 16,
      overflow: 'hidden',
      backgroundColor: C.surface,
      borderWidth: 1,
      borderColor: C.border,
    },
    matchBody: {
      minHeight: MATCH_ROW_MIN_HEIGHT - 2,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: 12,
      paddingLeft: 16,
    },
    matchStripe: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
    agentFrame: {
      backgroundColor: C.raised,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
    },
    resultText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },
    matchScore: { color: C.ink, fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] },
    rr: { fontWeight: '700', fontSize: 12, fontVariant: ['tabular-nums'] },
    reportHero: {
      borderRadius: 20,
      overflow: 'hidden',
      minHeight: 170,
      padding: 18,
      justifyContent: 'flex-end',
      gap: 4,
      backgroundColor: C.surface,
    },
    heroScore: {
      color: C.ink,
      fontSize: 44,
      fontWeight: '800',
      letterSpacing: -1,
      fontVariant: ['tabular-nums'],
    },
    playerCard: {
      backgroundColor: C.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: C.border,
      padding: 12,
      paddingLeft: 16,
      gap: 12,
      overflow: 'hidden',
    },
    playerStripe: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
    roundLine: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    roundLabel: { width: 52, fontSize: 11, fontWeight: '800', letterSpacing: 0.6 },
    roundNumber: { width: 26, textAlign: 'center', color: C.subtle, fontSize: 10 },
    roundCell: {
      width: 26,
      height: 26,
      borderRadius: 6,
      backgroundColor: C.raised,
      borderWidth: 1,
      borderColor: C.raised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
    duelScore: { fontSize: 17, fontWeight: '800', fontVariant: ['tabular-nums'] },
    duelBar: { flexDirection: 'row', height: 6, borderRadius: 3, overflow: 'hidden', gap: 2 },
    scrim: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#000000B3',
      padding: 24,
    },
    detailHero: {
      borderRadius: 22,
      padding: 18,
      minHeight: 240,
      alignItems: 'center',
      justifyContent: 'center',
    },
    videoShell: {
      backgroundColor: '#000',
      borderRadius: 18,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: C.border,
    },
    video: { width: '100%', aspectRatio: 16 / 9 },
    mediaChip: {
      width: 148,
      backgroundColor: C.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: C.border,
      padding: 10,
      gap: 6,
    },
  });
