import type { Navigate } from './explorerTypes';
import { PlayerCover, LiveCard } from './profileViews';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
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
import { catalogItem } from '../core/catalog';
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
import { C, S, rarityColor } from './theme';

export type ScreenName = 'store' | 'collection' | 'progress' | 'matches' | 'account';
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
const resultTone = (result?: MatchDetail['result']) =>
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
  return (
    <ScrollView
      contentContainerStyle={S.content}
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
  color = C.ink,
}: {
  label: string;
  value: string | number | null;
  color?: string;
}) {
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 2 }}>
      <Text style={[styles.miniValue, { color }]}>{value ?? '-'}</Text>
      <Text style={styles.miniLabel}>{label}</Text>
    </View>
  );
}
export function StoreScreen({ model, onItem }: Props) {
  const [tab, setTab] = useState<'daily' | 'night' | 'bundles' | 'accessories' | 'history'>(
    'daily',
  );
  const grid = (offers: StoreOffer[]) => (
    <OfferGrid
      offers={offers}
      wishlist={model.wishlist}
      onWish={(id) => void model.toggleWish(id)}
      onOpen={onItem}
    />
  );
  const renderStore = (store: Store) => (
    <>
      {tab === 'daily' && (
        <>
          <Countdown
            label="Offers reset in"
            expiresAt={store.dailyExpiresAt}
            offset={store.clockOffsetMs}
            color={C.accent}
            icon="refresh-cw"
          />
          {store.daily.length ? (
            grid(store.daily)
          ) : (
            <Empty title="No offers" detail="Pull down to refresh." />
          )}
        </>
      )}
      {tab === 'night' &&
        (store.nightMarket ? (
          <>
            <Countdown
              label="Night Market ends in"
              expiresAt={store.nightMarket.expiresAt}
              offset={store.clockOffsetMs}
              color={C.violet}
              icon="moon"
            />
            {grid(store.nightMarket.offers)}
          </>
        ) : (
          <Empty
            title="Night Market is closed"
            detail="It will appear here when it opens."
            icon="moon"
          />
        ))}
      {tab === 'bundles' && (
        <>
          {store.bundles.length ? (
            store.bundles.map((bundle) => (
              <View key={bundle.id} style={{ gap: 12 }}>
                <View style={styles.bundle}>
                  {bundle.image ? (
                    <Image
                      source={{ uri: bundle.image }}
                      resizeMode="cover"
                      style={fill}
                      accessibilityLabel={bundle.name}
                    />
                  ) : null}
                  <LinearGradient colors={['#0B101800', '#0B1018F0']} style={fill} />
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
                        offset={store.clockOffsetMs}
                        color={C.muted}
                      />
                    </View>
                  </View>
                </View>
                {bundle.offers.length > 0 && grid(bundle.offers)}
              </View>
            ))
          ) : (
            <Empty title="No featured bundles" detail="Pull down to refresh." icon="package" />
          )}
          <SectionHeader
            title="All bundles"
            detail={`${Object.keys(model.catalog.bundles).length}`}
          />
          <View style={styles.tileGrid}>
            {Object.entries(model.catalog.bundles)
              .sort((a, b) => a[1].name.localeCompare(b[1].name))
              .map(([id, bundle]) => (
                <View key={id} style={styles.archiveCard}>
                  {bundle.image ? (
                    <Image
                      source={{ uri: bundle.image }}
                      style={styles.archiveImage}
                      resizeMode="cover"
                    />
                  ) : (
                    <View
                      style={[
                        styles.archiveImage,
                        { alignItems: 'center', justifyContent: 'center' },
                      ]}
                    >
                      <Feather name="package" size={22} color={C.subtle} />
                    </View>
                  )}
                  <Text style={[S.h3, { fontSize: 13, paddingHorizontal: 10 }]} numberOfLines={2}>
                    {bundle.name}
                  </Text>
                </View>
              ))}
          </View>
        </>
      )}
      {tab === 'accessories' && (
        <>
          {store.accessoriesExpireAt ? (
            <Countdown
              label="Accessories reset in"
              expiresAt={store.accessoriesExpireAt}
              offset={store.clockOffsetMs}
              color={C.gold}
              icon="gift"
            />
          ) : null}
          {store.accessories.length ? (
            grid(store.accessories)
          ) : (
            <Empty title="No accessories right now" icon="gift" />
          )}
        </>
      )}
      <Text style={[S.small, { textAlign: 'center' }]}>Updated {date(store.fetchedAt)}</Text>
    </>
  );
  return (
    <Page model={model}>
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
      {tab === 'history' ? (
        model.history.length ? (
          model.history.map((entry) => (
            <View key={entry.id} style={{ gap: 10 }}>
              <SectionHeader title={date(entry.observedAt)} />
              {grid(entry.offers)}
            </View>
          ))
        ) : (
          <Empty
            title="No history yet"
            detail={
              model.active?.demo
                ? 'History is not saved in demo mode.'
                : 'Every daily rotation you load is kept here for 90 days.'
            }
            icon="clock"
          />
        )
      ) : (
        <Resource section={model.snapshot?.store} title="Store">
          {renderStore}
        </Resource>
      )}
    </Page>
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
      contentContainerStyle={S.content}
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
  if (model.snapshot?.progression.status !== 'ready') return null;
  const active = model.snapshot.progression.data.contracts.find((c) => c.currentBattlepass);
  const def = active ? model.catalog.contracts[active.id] : undefined;
  if (!def?.levels?.length) return null;
  const rewards = def.levels
    .map((level, index) => ({
      index,
      xp: level.xp,
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
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
function Stat({ label, value }: { label: string; value: string | number | null }) {
  return (
    <View style={{ flex: 1, gap: 4 }}>
      <Text style={S.small}>{label}</Text>
      <Text style={[S.h2, { fontVariant: ['tabular-nums'] }]}>{value ?? '-'}</Text>
    </View>
  );
}
function RankCard({ model, stats }: { model: AppModel; stats?: boolean }) {
  return (
    <Resource title="Rank" section={model.snapshot?.rank}>
      {(rank) => (
        <View style={S.card}>
          <View style={S.between}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={S.small}>CURRENT RANK</Text>
              <Text style={S.h2}>{rank.name}</Text>
              <Text style={S.body}>{rank.rr === null ? '-' : `${rank.rr} RR`}</Text>
            </View>
            {rank.image ? (
              <Image
                source={{ uri: rank.image }}
                style={{ width: 72, height: 72 }}
                resizeMode="contain"
              />
            ) : (
              <Feather name="award" size={44} color={C.gold} />
            )}
          </View>
          {stats && (
            <>
              <View style={S.divider} />
              <View style={S.row}>
                <Stat label="WINS" value={rank.wins} />
                <Stat label="GAMES" value={rank.games} />
                <Stat
                  label="WIN RATE"
                  value={
                    rank.wins !== null && rank.games
                      ? `${Math.round((rank.wins / rank.games) * 100)}%`
                      : null
                  }
                />
              </View>
            </>
          )}
        </View>
      )}
    </Resource>
  );
}
function LevelCard({ model }: { model: AppModel }) {
  return (
    <Resource title="Account level" section={model.snapshot?.xp}>
      {(xp) => (
        <View style={[S.card, S.between]}>
          <View style={{ gap: 4 }}>
            <Text style={S.small}>ACCOUNT LEVEL</Text>
            <Text style={S.title}>{xp.level}</Text>
          </View>
          <Text style={S.body}>{xp.xp.toLocaleString()} XP</Text>
        </View>
      )}
    </Resource>
  );
}
export function ProgressScreen({ model, onItem }: Props) {
  return (
    <Page model={model}>
      <Heading eyebrow="SEASON PROGRESS" title="Battle Pass" />
      <RankCard model={model} stats />
      <LevelCard model={model} />
      <BattlePassRewards model={model} onItem={onItem} />
      <Resource title="Contracts" section={model.snapshot?.progression}>
        {(progress) => (
          <>
            <SectionHeader title="Contracts" />
            {progress.contracts.length ? (
              progress.contracts.map((contract) => (
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
                        {contract.xp.toLocaleString()} / {contract.nextLevelXp.toLocaleString()} XP
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
        card: loadout?.card,
        title: loadout?.title,
        level: xp?.level,
      }}
      catalog={model.catalog}
      xp={xp?.xp}
      onEdit={() => onNavigate({ type: 'identity' })}
    />
  );
}
function RankOverview({ model, onOpen }: { model: AppModel; onOpen(): void }) {
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
  const career = rank?.career ?? [];
  const [queue, setQueue] = useState('competitive'),
    [open, setOpen] = useState<string | null>(null);
  const current = career.find((entry) => entry.queue === queue) ?? career[0];
  const ranked = current?.queue === 'competitive',
    [latest, ...previous] = current?.acts ?? [];
  const content = (
    <ModalPage>
      <ModalHeader title="Career summary" closeLabel="Close career summary" onClose={onClose} />
      <ScrollView contentContainerStyle={S.content}>
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
  const tone = detail ? resultTone(detail.result) : C.border,
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
        colors={['#131A25F7', '#131A25E0', '#131A25A6']}
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
}: {
  player: MatchPlayer;
  ally: boolean;
  onOpen(): void;
}) {
  const kd = player.kills !== null && player.deaths ? player.kills / player.deaths : null,
    stripe = player.self ? C.gold : ally ? C.mint : C.accent;
  return (
    <Pressable
      onPress={onOpen}
      disabled={!!player.hidden}
      accessibilityRole="button"
      accessibilityLabel={`View ${player.hidden ? 'hidden player' : player.name} profile`}
      style={[styles.playerCard, player.self && { borderColor: `${C.gold}59` }]}
    >
      <View style={[S.row, { gap: 12 }]}>
        <AgentFrame image={player.agentImage} size={44} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[S.h3, player.self && { color: C.gold }]} numberOfLines={1}>
            {player.name}
            {player.tag ? (
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
  const tone = resultTone(detail?.result);
  const content = (
    <ModalPage>
      <ModalHeader
        eyebrow={detail ? queueName(detail.queue).toUpperCase() : undefined}
        title={detail?.map ?? 'Match report'}
        closeLabel="Close match report"
        onClose={onClose}
      />
      <ScrollView contentContainerStyle={S.content}>
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
              <LinearGradient colors={['#0B101840', '#0B1018E6']} style={fill} />
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
export function MatchesScreen({ model, onNavigate }: Props) {
  const [filter, setFilter] = useState('all');
  const [details, setDetails] = useState<Record<string, MatchDetail>>({}),
    requested = useRef(new Set<string>());
  const matches =
    model.snapshot?.matches.status === 'ready' ? model.snapshot.matches.data : undefined;

  useEffect(() => {
    let alive = true;
    (async () => {
      for (const match of matches ?? []) {
        if (!alive) return;
        if (requested.current.has(match.id)) continue;
        requested.current.add(match.id);
        try {
          const detail = await model.matchDetail(match.id);
          if (alive) setDetails((previous) => ({ ...previous, [match.id]: detail }));
        } catch {
          requested.current.delete(match.id);
          return;
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [matches, model.matchDetail]);
  const queues = useMemo(
    () => ['all', ...Array.from(new Set((matches ?? []).map((m) => m.queue)))],
    [matches],
  );
  const rank = model.snapshot?.rank.status === 'ready' ? model.snapshot.rank.data : undefined;
  return (
    <>
      <Page model={model}>
        <Heading eyebrow="YOUR CAREER" title="Profile" />
        <ProfileBanner model={model} onNavigate={onNavigate} />
        <RankOverview model={model} onOpen={() => rank && onNavigate({ type: 'career', rank })} />
        <Button
          title="Friends & chat"
          secondary
          icon="users"
          onPress={() => onNavigate({ type: 'friends' })}
        />
        <LiveCard model={model} onOpen={() => onNavigate({ type: 'live' })} />
        <SectionHeader title="Match history" />
        <Resource title="Match history" section={model.snapshot?.matches}>
          {(list) => {
            const shown = list.filter((m) => filter === 'all' || m.queue === filter);
            return (
              <>
                {queues.length > 2 && (
                  <Tabs
                    value={queues.includes(filter) ? filter : 'all'}
                    onChange={setFilter}
                    items={queues.map((id) => ({
                      id,
                      label: id === 'all' ? 'All' : queueName(id),
                    }))}
                  />
                )}
                {shown.map((match) => (
                  <MatchCard
                    key={match.id}
                    match={match}
                    detail={details[match.id]}
                    onPress={() => onNavigate({ type: 'match', id: match.id })}
                  />
                ))}
                {!shown.length && <Empty title="No matches yet" icon="crosshair" />}
                {!model.active?.demo && list.length > 0 && list.length < 1000 && (
                  <Button
                    title="Load older matches"
                    secondary
                    disabled={model.busy}
                    onPress={() => void model.moreMatches()}
                  />
                )}
              </>
            );
          }}
        </Resource>
      </Page>
    </>
  );
}
export function AccountScreen({ model, onLink }: Props) {
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
        <SectionHeader title="Notifications" />
        <View style={S.card}>
          <Setting
            title="Store reminders"
            detail="Reset reminders and wishlist alerts."
            value={model.settings.reminders}
            disabled={active.demo || Platform.OS === 'web'}
            onChange={(value) => void model.saveSettings({ ...model.settings, reminders: value })}
          />
          <View style={S.divider} />
          <Setting
            title="Background refresh"
            detail="Check the store in the background when the system allows it."
            value={model.settings.backgroundSync}
            disabled={active.demo || Platform.OS === 'web'}
            onChange={(value) =>
              void model.saveSettings({ ...model.settings, backgroundSync: value })
            }
          />
        </View>
        <SectionHeader title="Data" />
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
            Your Riot password is never stored. Session tokens and sign-in cookies stay in the
            device's secure storage, and cached data never leaves this device. Removing an account
            deletes its local data but does not sign it out on Riot's side. Demo mode uses made-up
            data.
          </Text>
          <Text style={S.small}>Outpost 0.3.0</Text>
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
                ? 'Its saved session, history, wishlist and notifications will be deleted from this device.'
                : 'Cached store data, catalog and history will be cleared. Accounts and wishlists stay.'}
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
  item,
  model,
  onClose,
}: {
  item: CatalogItem | null;
  model: AppModel;
  onClose(): void;
}) {
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
          <ScrollView contentContainerStyle={S.content}>
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
const styles = StyleSheet.create({
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
    backgroundColor: '#0B1018B3',
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
  matchBody: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, paddingLeft: 16 },
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
