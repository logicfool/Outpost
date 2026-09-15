import { PurchaseControls, PurchaseHistory } from './PurchaseControls';
import { useNavInset } from './NavInsets';
import { SessionStatus } from './SessionStatus';
import { useMatchPreviews } from '../state/useMatchPreviews';
import { ChatSettings } from './ChatSettings';
import { Image } from './CachedImage';
import { DiagnosticsPanel } from './DiagnosticsPanel';
import type { Navigate } from './explorerTypes';
import { playerLabel } from '../core/playerNames';
import { PlayerCover, LiveCard } from './profileViews';
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { useVideoPlayer, VideoView } from 'expo-video';
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
} from './components';
import { rarityColor, useTheme, useThemedStyles, type Palette } from './theme';

export type ScreenName = 'store' | 'collection' | 'progress' | 'matches' | 'account' | 'friends';
type Props = {
  model: AppModel;
  onItem(item: CatalogItem): void;
  onLink(expectedId?: string): void;
  onNavigate: Navigate;
};
const date = (value?: number) =>
  value
    ? new Date(value).toLocaleString(undefined, {
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
  const { C, S, isDark } = useTheme();
  const navInset = useNavInset();

  return (
    <ScrollView
      contentContainerStyle={[S.content, { paddingBottom: 24 + navInset }]}
      refreshControl={
        <RefreshControl
          refreshing={model.busy}
          onRefresh={() => void model.refresh()}
          tintColor={C.accent}
        />
      }
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );
}
function Heading({ eyebrow, title }: { eyebrow: string; title: React.ReactNode }) {
  const { C, S, isDark } = useTheme();
  const navInset = useNavInset();

  return (
    <View style={{ gap: 4 }}>
      <Text style={S.eyebrow}>{eyebrow}</Text>
      <Text style={S.title} numberOfLines={1}>
        {title}
      </Text>
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
    <Resource section={model.snapshot?.wallet} title="Balances">
      {(balances) => (
        <View style={styles.wallet}>
          {walletOverview(balances).map((m) => (
            <View key={m.currencyId} style={[styles.currency, { flexDirection: 'column', gap: 4 }]}>
              <View style={S.row}>
                <CurrencyIcon symbol={m.symbol} size={16} />
                <Text style={S.small}>{m.symbol}</Text>
              </View>
              <Text style={styles.balance}>
                {m.amount === null ? '-' : m.amount.toLocaleString()}
              </Text>
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
export function StoreScreen({ model, onItem }: Props) {
  const { C, S } = useTheme(),
    styles = useThemedStyles(makeStyles),
    navInset = useNavInset();
  const [bundleLimit, setBundleLimit] = useState(12);
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
    if (!store) return result;
    if (tab === 'daily') addOffers('daily', store.daily, true);
    if (tab === 'accessories') addOffers('accessory', store.accessories);
    if (tab === 'night') addOffers('night', store.nightMarket?.offers ?? []);
    if (tab === 'bundles') {
      for (const bundle of store.bundles) {
        result.push({ id: 'bundle' + bundle.id, kind: 'bundle', bundle });
        addOffers(bundle.id, bundle.offers);
      }
      const archive = Object.entries(model.catalog.bundles).sort((a, b) =>
        a[1].name.localeCompare(b[1].name),
      );
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
  }, [tab, store, model.catalog, model.history, bundleLimit]);
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
              <View key={id} style={[styles.archiveCard, { flex: 1, width: undefined }]}>
                {bundle.image ? (
                  <Image
                    source={{ uri: bundle.image }}
                    style={styles.archiveImage}
                    contentFit="cover"
                    transition={0}
                  />
                ) : (
                  <View style={styles.archiveImage} />
                )}
                <Text style={[S.h3, { fontSize: 13, paddingHorizontal: 10 }]} numberOfLines={2}>
                  {bundle.name}
                </Text>
              </View>
            ))}
            {row.entries.length === 1 && <View style={{ flex: 1 }} />}
          </View>
        );
      const bundle = row.bundle;
      return (
        <View style={styles.bundle}>
          {bundle.image && (
            <Image
              source={{ uri: bundle.image }}
              contentFit="cover"
              style={fill}
              accessibilityLabel={bundle.name}
            />
          )}
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
        </View>
      );
    },
    [model.wishlist, model.catalog, onWish, onItem, grid, styles, C, S, store?.clockOffsetMs],
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
    <FlatList
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
          refreshing={model.busy}
          onRefresh={() => void model.refresh()}
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
          {expiry !== undefined && (
            <View style={[S.between, { paddingHorizontal: 4, paddingVertical: 2 }]}>
              <View style={{ gap: 3 }}>
                <Text style={S.small}>
                  {tab === 'daily'
                    ? 'Next rotation'
                    : tab === 'night'
                      ? 'Night Market ends'
                      : 'Accessories reset'}
                </Text>
                <Text style={[S.small, { fontSize: 11 }]}>Cached · pull down to refresh</Text>
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
            <Resource section={model.snapshot?.store} title="Store">
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
            detail="Pull down to refresh. Automatic updates happen at the daily reset."
            icon={tab === 'night' ? 'moon' : 'shopping-bag'}
          />
        ) : null
      }
      ListFooterComponent={
        <View style={{ paddingVertical: 18, gap: 16 }}>
          {tab === 'bundles' && Object.keys(model.catalog.bundles).length > bundleLimit && (
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
export function CollectionScreen({ model, onItem, onNavigate }: Props) {
  const { C, S, isDark } = useTheme();
  const navInset = useNavInset();
  const styles = useThemedStyles(makeStyles);

  const [tab, setTab] = useState<'owned' | 'wishlist' | 'catalog' | 'equipped'>('owned'),
    [query, setQuery] = useState('');
  const [kind, setKind] = useState<
      'all' | 'skin' | 'buddy' | 'spray' | 'card' | 'agent' | 'chroma' | 'title'
    >('all'),
    [weapon, setWeapon] = useState('all');
  const owned = model.snapshot?.collection.status === 'ready' ? model.snapshot.collection.data : [];
  const all = useMemo(
    () =>
      Array.from(
        new Map(
          Object.values(model.catalog.items).map((item) => [
            item.kind === 'chroma' ? item.id : item.canonicalId,
            item.kind === 'chroma' ? item : { ...item, id: item.canonicalId },
          ]),
        ).values(),
      ),
    [model.catalog],
  );
  const weapons = useMemo(
    () => ['all', ...Array.from(new Set(all.filter((i) => i.weapon).map((i) => i.weapon!))).sort()],
    [all],
  );
  const items = useMemo(
    () =>
      (tab === 'owned'
        ? owned
        : tab === 'wishlist'
          ? all.filter((item) => model.wishlist.includes(item.canonicalId))
          : all
      )
        .filter(
          (item) =>
            (kind === 'all' || item.kind === kind) &&
            (weapon === 'all' || item.weapon === weapon) &&
            item.name.toLowerCase().includes(query.toLowerCase()),
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    [tab, owned, all, kind, weapon, query, model.wishlist],
  );
  const header = (
    <View style={{ gap: 14, paddingBottom: 16 }}>
      <Heading eyebrow="BUILT OVER TIME" title="Collection" />
      <Button
        title="Saved loadouts"
        secondary
        icon="layers"
        onPress={() => onNavigate({ type: 'presets' })}
      />
      <Button
        title="Change player card & title"
        secondary
        icon="image"
        onPress={() => onNavigate({ type: 'identity' })}
      />
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: 'owned', label: 'Owned' },
          { id: 'wishlist', label: `Wishlist · ${model.wishlist.length}` },
          { id: 'catalog', label: 'All items' },
          { id: 'equipped', label: 'Loadout' },
        ]}
      />
      {tab !== 'equipped' && (
        <>
          <View style={styles.search}>
            <Feather name="search" size={16} color={C.subtle} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search skins, buddies, cards…"
              placeholderTextColor={C.subtle}
              value={query}
              onChangeText={setQuery}
              accessibilityLabel="Search collection"
              autoCorrect={false}
            />
          </View>
          <Tabs
            value={kind}
            onChange={setKind}
            items={[
              { id: 'all', label: 'All' },
              { id: 'skin', label: 'Skins' },
              { id: 'chroma', label: 'Chromas' },
              { id: 'buddy', label: 'Buddies' },
              { id: 'spray', label: 'Sprays' },
              { id: 'card', label: 'Cards' },
              { id: 'title', label: 'Titles' },
              { id: 'agent', label: 'Agents' },
            ]}
          />
          {(kind === 'skin' || kind === 'chroma') && (
            <Tabs
              value={weapon}
              onChange={setWeapon}
              items={weapons.map((id) => ({ id, label: id === 'all' ? 'All weapons' : id }))}
            />
          )}
        </>
      )}
    </View>
  );
  if (tab === 'equipped')
    return (
      <Page model={model}>
        {header}
        <Resource title="Loadout" section={model.snapshot?.loadout}>
          {(data) => (
            <>
              {data.card || data.title ? (
                <View style={[S.card, S.row]}>
                  {data.card && <ItemArt item={data.card} size={84} style={{ width: 64 }} />}
                  <View style={{ flex: 1, gap: 4 }}>
                    {data.card && <Text style={S.h3}>{data.card.name}</Text>}
                    {data.title && (
                      <Text style={[S.small, { color: C.gold }]}>{data.title.name}</Text>
                    )}
                  </View>
                </View>
              ) : null}
              <View style={styles.tileGrid}>
                {data.guns.map((gun, index) => (
                  <View key={`${gun.weapon}:${index}`} style={styles.tileCell}>
                    <ItemTile
                      item={gun.skin}
                      label={gun.weapon.toUpperCase()}
                      onOpen={() => onItem(gun.skin)}
                    />
                  </View>
                ))}
              </View>
            </>
          )}
        </Resource>
      </Page>
    );
  const waiting = tab === 'owned' && model.snapshot?.collection.status !== 'ready';
  return (
    <FlatList
      data={waiting ? [] : items}
      numColumns={2}
      keyExtractor={(item) => `${item.kind}:${item.id}`}
      contentContainerStyle={[S.content, { paddingBottom: 24 + navInset }]}
      columnWrapperStyle={{ gap: 12 }}
      ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
      ListHeaderComponent={header}
      refreshControl={
        <RefreshControl
          refreshing={model.busy}
          onRefresh={() => void model.refresh()}
          tintColor={C.accent}
        />
      }
      initialNumToRender={12}
      maxToRenderPerBatch={12}
      windowSize={7}
      renderItem={({ item }) => (
        <View style={{ flex: 1, maxWidth: '49%' }}>
          <ItemTile
            item={item}
            wished={model.wishlist.includes(item.canonicalId)}
            onOpen={() => onItem(item)}
            onWish={() => void model.toggleWish(item.canonicalId)}
          />
        </View>
      )}
      ListEmptyComponent={
        waiting ? (
          <Resource section={model.snapshot?.collection} title="Collection">
            {() => null}
          </Resource>
        ) : (
          <Empty
            title={tab === 'wishlist' ? 'Your wishlist is empty' : 'Nothing found'}
            detail={
              tab === 'wishlist'
                ? 'Tap the heart on any item to save it.'
                : 'Try a different search or filter.'
            }
            icon={tab === 'wishlist' ? 'heart' : 'search'}
          />
        )
      }
    />
  );
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
            {progress.missions.length > 0 && (
              <SectionHeader
                title="Missions"
                detail={
                  progress.weeklyRefillAt ? `Refills ${date(progress.weeklyRefillAt)}` : undefined
                }
              />
            )}
            {progress.missions.map((mission, index) => (
              <View key={mission.id} style={[S.card, S.between]}>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={S.h3}>Mission {index + 1}</Text>
                  {mission.objectives.length ? (
                    <Text style={S.body}>Progress {mission.objectives.join(' · ')}</Text>
                  ) : null}
                  {mission.expiresAt ? (
                    <Text style={S.small}>Expires {date(mission.expiresAt)}</Text>
                  ) : null}
                </View>
                <Badge
                  text={mission.complete ? 'DONE' : 'ACTIVE'}
                  color={mission.complete ? C.mint : C.gold}
                />
              </View>
            ))}
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
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      {content}
    </Modal>
  );
}
export function MatchCard({
  match,
  detail,
  onPress,
}: {
  match: MatchSummary;
  detail?: MatchDetail;
  onPress(): void;
}) {
  const { C, S, isDark } = useTheme();
  const navInset = useNavInset();
  const styles = useThemedStyles(makeStyles);

  const tone = detail ? resultTone(detail.result, C) : C.border,
    map = detail?.map ?? match.map,
    image = detail?.mapImage ?? match.mapImage;
  return (
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
          {detail ? <Text style={styles.matchScore}>{detail.score}</Text> : null}
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
        <AgentFrame image={player.agentImage} size={44} />
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
    teamGame = detail?.teams.length === 2;
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
          <ActivityIndicator style={{ marginTop: 40 }} size="large" color={C.accent} />
        ) : (
          <>
            <View style={styles.reportHero}>
              {detail.mapImage ? (
                <Image source={{ uri: detail.mapImage }} style={fill} resizeMode="cover" />
              ) : (
                <LinearGradient colors={[`${tone}40`, C.surface]} style={fill} />
              )}
              <LinearGradient colors={[`${C.background}80`, `${C.background}F2`]} style={fill} />
              <Text style={[S.eyebrow, { color: tone }]}>
                {resultLabel(detail.result).toUpperCase()}
              </Text>
              {own && other && own.roundsWon !== null && other.roundsWon !== null ? (
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
            <View style={S.card}>
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
              (teamGame
                ? [own, other].map(
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
                            detail={
                              team.roundsWon !== null ? `${team.roundsWon} rounds` : undefined
                            }
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
                : detail.players.map((player) => (
                    <PlayerRow
                      key={player.subject}
                      player={player}
                      ownId={model.active?.puuid}
                      ally={player.self}
                      onOpen={() => onNavigate({ type: 'player', player })}
                    />
                  )))}
            {tab === 'rounds' && own && other && (
              <View style={[S.card, { gap: 14 }]}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={{ gap: 6 }}>
                    <View style={styles.roundLine}>
                      <View style={styles.roundLabel} />
                      {detail.rounds.map((round) => (
                        <Text key={round.number} style={styles.roundNumber}>
                          {round.number}
                        </Text>
                      ))}
                    </View>
                    {[own, other].map((team) => {
                      const color = team === own ? C.mint : C.accent;
                      return (
                        <View key={team.id} style={styles.roundLine}>
                          <Text style={[styles.roundLabel, { color }]}>
                            {team === own ? 'YOU' : 'ENEMY'}
                          </Text>
                          {detail.rounds.map((round) => {
                            const won = round.winningTeam === team.id;
                            return (
                              <View
                                key={round.number}
                                style={[
                                  styles.roundCell,
                                  won && {
                                    backgroundColor: `${color}2E`,
                                    borderColor: `${color}66`,
                                  },
                                ]}
                              >
                                {won ? (
                                  <MaterialCommunityIcons
                                    name={ROUND_ICONS[round.outcome]}
                                    size={14}
                                    color={color}
                                  />
                                ) : null}
                              </View>
                            );
                          })}
                        </View>
                      );
                    })}
                  </View>
                </ScrollView>
                <View style={styles.legend}>
                  {(['elimination', 'detonate', 'defuse', 'time'] as const).map((outcome) => (
                    <View key={outcome} style={[S.row, { gap: 4 }]}>
                      <MaterialCommunityIcons
                        name={ROUND_ICONS[outcome]}
                        size={13}
                        color={C.muted}
                      />
                      <Text style={S.small}>
                        {outcome === 'elimination'
                          ? 'Elimination'
                          : outcome === 'detonate'
                            ? 'Spike detonated'
                            : outcome === 'defuse'
                              ? 'Spike defused'
                              : 'Time expired'}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            )}
            {tab === 'duels' &&
              (detail.duels.length ? (
                detail.duels.map((duel) => (
                  <View key={duel.subject} style={[S.card, { gap: 10 }]}>
                    <View style={[S.row, { gap: 12 }]}>
                      <AgentFrame image={duel.agentImage} size={40} />
                      <Text style={[S.h3, { flex: 1 }]} numberOfLines={1}>
                        {duel.name}
                      </Text>
                      <Text style={styles.duelScore}>
                        <Text style={{ color: C.mint }}>{duel.kills}</Text>
                        <Text style={{ color: C.subtle }}> - </Text>
                        <Text style={{ color: C.accent }}>{duel.deaths}</Text>
                      </Text>
                    </View>
                    <View style={styles.duelBar}>
                      <View style={{ flex: duel.kills || 0.0001, backgroundColor: C.mint }} />
                      <View style={{ flex: duel.deaths || 0.0001, backgroundColor: C.accent }} />
                    </View>
                  </View>
                ))
              ) : (
                <Empty title="No duels recorded" icon="crosshair" />
              ))}
          </>
        )}
      </ScrollView>
    </ModalPage>
  );
  return embedded ? (
    content
  ) : (
    <Modal visible={id !== null} animationType="slide" onRequestClose={onClose}>
      {content}
    </Modal>
  );
}
export const HistoryRow = memo(function HistoryRow({
  match,
  detail,
  onOpen,
}: {
  match: MatchSummary;
  detail?: MatchDetail;
  onOpen(id: string): void;
}) {
  return <MatchCard match={match} detail={detail} onPress={() => onOpen(match.id)} />;
});
const matchKey = (match: MatchSummary) => match.id;
const HistoryGap = () => <View style={{ height: 12 }} />;
export function MatchesScreen({ model, onNavigate }: Props) {
  const { C, S } = useTheme(),
    navInset = useNavInset();
  const [filter, setFilter] = useState('all');
  const previews = useMatchPreviews(model),
    details = previews.details;
  const matches =
    model.snapshot?.matches.status === 'ready' ? model.snapshot.matches.data : undefined;
  const queues = useMemo(() => ['all', ...new Set((matches ?? []).map((m) => m.queue))], [matches]);
  const shown = useMemo(
    () => (matches ?? []).filter((m) => filter === 'all' || m.queue === filter),
    [matches, filter],
  );
  const open = useCallback((id: string) => onNavigate({ type: 'match', id }), [onNavigate]);
  const render = useCallback(
    ({ item }: { item: MatchSummary }) => (
      <HistoryRow match={item} detail={details[item.id]} onOpen={open} />
    ),
    [details, open],
  );
  const rank = model.snapshot?.rank.status === 'ready' ? model.snapshot.rank.data : undefined;
  return (
    <FlatList
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
          refreshing={model.busy}
          onRefresh={() => void model.refresh()}
          tintColor={C.accent}
        />
      }
      ListHeaderComponent={
        <View style={{ gap: 16, paddingBottom: 16 }}>
          <Heading eyebrow="YOUR CAREER" title="Profile" />
          <ProfileBanner model={model} onNavigate={onNavigate} />
          <RankOverview model={model} onOpen={() => rank && onNavigate({ type: 'career', rank })} />
          <LiveCard model={model} onOpen={() => onNavigate({ type: 'live' })} />
          <SectionHeader title="Match history" />
          {queues.length > 2 && (
            <Tabs
              value={queues.includes(filter) ? filter : 'all'}
              onChange={setFilter}
              items={queues.map((id) => ({ id, label: id === 'all' ? 'All' : queueName(id) }))}
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
        matches ? <Empty title="No matches in this view" icon="crosshair" /> : null
      }
      ListFooterComponent={
        !model.active?.demo && !!matches?.length && matches.length < 1000 ? (
          <View style={{ paddingTop: 16 }}>
            <Button
              title="Load older matches"
              secondary
              disabled={model.busy}
              onPress={() => void model.moreMatches()}
            />
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

  const [confirm, setConfirm] = useState<'remove' | 'cache' | null>(null),
    [working, setWorking] = useState(false);
  const active = model.active!;
  const confirmAction = async () => {
    if (!confirm) return;
    setWorking(true);
    try {
      if (confirm === 'remove') await model.remove(active.puuid);
      else await model.clearCache();
    } finally {
      setWorking(false);
      setConfirm(null);
    }
  };
  const live = active.expiresAt > Date.now(),
    renewable = active.canReauth;
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
              <Button
                title="Reconnect"
                secondary
                icon="refresh-cw"
                onPress={() => onLink(active.puuid)}
              />
            </>
          )}
        </View>
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
        {active.demo && <Button title="Leave demo" secondary onPress={model.leaveDemo} />}
        <SectionHeader title="Appearance" />
        <View style={S.card}>
          <Tabs
            value={model.settings.theme ?? 'navy'}
            onChange={(choice) => void model.setTheme(choice)}
            items={[
              { id: 'navy', label: 'Navy' },
              { id: 'dark', label: 'Dark' },
              { id: 'light', label: 'Light' },
              { id: 'system', label: 'System' },
            ]}
          />
          <Text style={S.small}>
            Theme applies to all screens, dialogs and chat. System follows your device appearance.
          </Text>
        </View>
        <SectionHeader title="Chat history" />
        <View style={S.card}>
          <ChatSettings model={model} />
        </View>
        <SectionHeader title="Refresh schedule" />
        <View style={S.card}>
          <InfoRow label="Live matches" value="Every 60 seconds" />
          <View style={S.divider} />
          <InfoRow label="Automatic store refresh" value="When the daily timer resets" />
          <View style={S.divider} />
          <InfoRow label="Skins & catalog" value="Cached for 24 hours" />
          <Text style={S.small}>
            Pull down for a manual refresh. Repeated pulls and live checks share a one-minute limit.
            Server cooldowns always take priority. Friends' presence arrives over the chat
            connection, not by polling every friend.
          </Text>
        </View>
        <SectionHeader title="Notifications" />
        <View style={S.card}>
          <Setting
            title="Store reminders"
            detail="A reminder when the current daily rotation ends."
            value={model.settings.reminders}
            disabled={active.demo || Platform.OS === 'web'}
            onChange={(value) => void model.saveSettings({ ...model.settings, reminders: value })}
          />
          <View style={S.divider} />
          <Setting
            title="Wishlist alerts"
            detail="Notify when a saved skin appears in daily offers, Night Market or an active bundle. Uses scheduled refreshes, not extra polling."
            value={!!model.settings.wishlistAlerts}
            disabled={active.demo || Platform.OS === 'web'}
            onChange={(value) =>
              void model.saveSettings({ ...model.settings, wishlistAlerts: value })
            }
          />
          <View style={S.divider} />
          <Setting
            title="Chat alerts"
            detail="Alert on new incoming messages while the chat connection is active. No alerts for history imports or the open conversation. Fully closed-app push needs a separate relay and is not enabled."
            value={!!model.settings.chatAlerts}
            disabled={active.demo || Platform.OS === 'web'}
            onChange={(value) => void model.saveSettings({ ...model.settings, chatAlerts: value })}
          />
          <View style={S.divider} />
          <Setting
            title="Notification previews"
            detail="Show skin names or message text in device notifications. Off keeps lock-screen alerts private."
            value={!!model.settings.notificationPreviews}
            disabled={active.demo || Platform.OS === 'web'}
            onChange={(value) =>
              void model.saveSettings({ ...model.settings, notificationPreviews: value })
            }
          />
          <View style={S.divider} />
          <Setting
            title="Background refresh"
            detail="Refresh only an expired daily rotation when the system wakes the app. No background live-match polling."
            value={model.settings.backgroundSync}
            disabled={active.demo || Platform.OS === 'web'}
            onChange={(value) =>
              void model.saveSettings({ ...model.settings, backgroundSync: value })
            }
          />
        </View>
        <SectionHeader title="Phone purchases" />
        <View style={S.card}>
          <Setting
            title="Allow VP purchases"
            detail="Experimental daily skin orders with a separate price and account confirmation. No automatic purchases, VP top-ups, gifts or bulk orders."
            value={!!model.settings.allowPurchases}
            disabled={active.demo || Platform.OS === 'web'}
            onChange={(value) =>
              void model.saveSettings({ ...model.settings, allowPurchases: value })
            }
          />
          <PurchaseHistory model={model} />
        </View>
        <SectionHeader title="Data" />
        <DiagnosticsPanel />
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
          <Text style={S.body}>
            Outpost is an independent companion app and is not affiliated with or endorsed by Riot
            Games. Store, collection and match data come from unofficial Riot client services that
            can change or stop working at any time. Item art, videos and catalog details come from
            valorant-api.com.
          </Text>
          <Text style={S.body}>
            Your Riot password is never stored. Session tokens and sign-in cookies stay in secure
            storage. Chats are encrypted locally with a separate key for each account. Sending a
            whisper transmits it to Riot and the recipient; syncing history reads messages Riot
            retains. Removing an account deletes its local data but does not sign it out on Riot's
            side. Demo mode uses made-up data.
          </Text>
          <Text style={S.small}>Outpost 0.6.2</Text>
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
              {confirm === 'remove' ? 'Remove this account?' : 'Clear cached data?'}
            </Text>
            <Text style={S.body}>
              {confirm === 'remove'
                ? 'Its saved session, game history, encrypted messages, wishlist and notifications will be deleted from this device.'
                : 'Cached game data, artwork and catalog will be cleared. Accounts, saved chats and wishlists stay.'}
            </Text>
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
}: {
  title: string;
  detail: string;
  value: boolean;
  onChange(value: boolean): void;
  disabled?: boolean;
}) {
  const { C, S, isDark } = useTheme();
  const navInset = useNavInset();
  return (
    <View style={S.row}>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={S.h3}>{title}</Text>
        <Text style={S.small}>{detail}</Text>
      </View>
      <Switch
        accessibilityLabel={title}
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ false: C.raised, true: C.accent }}
        thumbColor={C.ink}
      />
    </View>
  );
}
function SkinVideo({ uri }: { uri: string }) {
  const { C, S, isDark } = useTheme();
  const navInset = useNavInset();
  const styles = useThemedStyles(makeStyles);

  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
  });
  return (
    <View style={styles.videoShell}>
      <VideoView player={player} style={styles.video} nativeControls contentFit="contain" />
    </View>
  );
}
export function ItemModal({
  item: original,
  model,
  onClose,
}: {
  item: CatalogItem | null;
  model: AppModel;
  onClose(): void;
}) {
  const { C, S, isDark } = useTheme();
  const navInset = useNavInset();
  const styles = useThemedStyles(makeStyles);

  const item = original ? hydrateItem(model.catalog, original) : null;
  const [preview, setPreview] = useState<CatalogMedia | null>(null);
  useEffect(() => setPreview(null), [item?.id]);
  const shown = preview ?? item,
    video = preview ? preview.video : item?.video,
    tint = rarityColor(item?.rarity);
  const wished = item ? model.wishlist.includes(item.canonicalId) : false,
    weaponItem = item?.kind === 'skin' || item?.kind === 'chroma';
  return (
    <Modal visible={!!item} animationType="slide" onRequestClose={onClose}>
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
              <SkinVideo key={video} uri={video} />
            ) : weaponItem ? (
              <Text style={S.small}>No video preview is available for this selection.</Text>
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
    wallet: { flexDirection: 'row', gap: 8 },
    currency: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: C.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: C.border,
      paddingHorizontal: 12,
      paddingVertical: 10,
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
