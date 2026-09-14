import React, { useEffect, useMemo, useState } from 'react';
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
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useVideoPlayer, VideoView } from 'expo-video';
import type { AppModel } from '../state/useApp';
import type { CatalogItem, MatchDetail, Store } from '../core/types';
import { safeError } from '../core/validation';
import { catalogItem } from '../core/catalog';
import {
  Badge,
  Button,
  Empty,
  IconButton,
  InfoRow,
  ItemArt,
  MoneyText,
  OfferGrid,
  ProgressBar,
  Resource,
  Tabs,
  Timer,
} from './components';
import { C, S } from './theme';

export type ScreenName = 'store' | 'collection' | 'progress' | 'matches' | 'account';
type Props = {
  model: AppModel;
  onItem(item: CatalogItem): void;
  onLink(expectedId?: string): void;
};
const date = (value?: number) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'Unavailable';
function Page({ model, children }: { model: AppModel; children: React.ReactNode }) {
  return (
    <ScrollView
      contentContainerStyle={S.content}
      refreshControl={
        <RefreshControl
          refreshing={model.busy}
          onRefresh={() => void model.refresh()}
          tintColor={C.mint}
        />
      }
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );
}
function Intro({ eyebrow, title, detail }: { eyebrow: string; title: string; detail?: string }) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={S.eyebrow}>{eyebrow}</Text>
      <Text style={S.title}>{title}</Text>
      {detail && <Text style={S.body}>{detail}</Text>}
    </View>
  );
}
function Wallet({ model }: { model: AppModel }) {
  return (
    <Resource section={model.snapshot?.wallet} title="Balances">
      {(balances) => (
        <View style={styles.wallet}>
          {balances.map((m) => (
            <View key={m.currencyId} style={styles.currency}>
              <View style={S.row}>
                <View
                  style={[
                    styles.coin,
                    {
                      borderColor: m.symbol === 'VP' ? C.ink : m.symbol === 'RP' ? C.mint : C.gold,
                    },
                  ]}
                />
                <Text style={S.small}>{m.symbol}</Text>
              </View>
              <Text style={styles.balance}>{m.amount.toLocaleString()}</Text>
            </View>
          ))}
        </View>
      )}
    </Resource>
  );
}
export function StoreScreen({ model, onItem }: Props) {
  const [tab, setTab] = useState<'daily' | 'night' | 'bundles' | 'accessories' | 'history'>(
    'daily',
  );
  const renderStore = (store: Store) => (
    <>
      {tab === 'daily' && (
        <>
          <LinearGradient colors={['#263746', '#14252C']} style={styles.hero}>
            <View style={S.between}>
              <Badge text="DAILY ROTATION" />
              <Feather name="clock" color={C.mint} size={20} />
            </View>
            <Text style={[S.h2, { fontSize: 25, marginTop: 10 }]}>Your next favourite.</Text>
            <Text style={S.body}>Four slots. A new possibility every day.</Text>
            <View style={[S.between, { marginTop: 16 }]}>
              <Text style={S.small}>NEXT RESET</Text>
              <Timer expiresAt={store.dailyExpiresAt} offset={store.clockOffsetMs} />
            </View>
          </LinearGradient>
          <View style={S.between}>
            <Text style={S.h2}>Made for your store</Text>
            <Text style={S.small}>{store.daily.length} offers</Text>
          </View>
          {store.daily.length ? (
            <OfferGrid
              offers={store.daily}
              wishlist={model.wishlist}
              onWish={(id) => void model.toggleWish(id)}
              onOpen={onItem}
            />
          ) : (
            <Empty
              title="No offers returned"
              detail="Riot returned an empty daily panel. Refresh later."
            />
          )}
        </>
      )}
      {tab === 'night' && (
        <>
          <Intro
            eyebrow="AFTER DARK"
            title="Night Market"
            detail="Personal discounts, exactly as returned by Riot."
          />
          {store.nightMarket ? (
            <>
              <View style={S.between}>
                <Badge text="OBSERVED MARKET" color={C.violet} />
                <Timer small expiresAt={store.nightMarket.expiresAt} offset={store.clockOffsetMs} />
              </View>
              <OfferGrid
                offers={store.nightMarket.offers}
                wishlist={model.wishlist}
                onWish={(id) => void model.toggleWish(id)}
                onOpen={onItem}
              />
              <Text style={S.small}>
                This app does not reveal or purchase cards. Unrevealed or unavailable offers may not
                appear.
              </Text>
            </>
          ) : (
            <Empty
              title="No Night Market in this response"
              detail="A market may not be active or available for your account. We do not invent its next start date."
              icon="moon"
            />
          )}
        </>
      )}
      {tab === 'bundles' && (
        <>
          <Intro
            eyebrow="THE FULL SET"
            title="Featured bundles"
            detail="Current offers first, then the complete public bundle archive."
          />
          {store.bundles.length ? (
            store.bundles.map((bundle) => (
              <View key={bundle.id} style={S.card}>
                {bundle.image && (
                  <Image
                    source={{ uri: bundle.image }}
                    resizeMode="cover"
                    style={styles.bundleImage}
                    accessibilityLabel={bundle.name}
                  />
                )}
                <View style={S.between}>
                  <Text style={[S.h2, { flex: 1 }]}>{bundle.name}</Text>
                  <Feather name="package" size={25} color={C.gold} />
                </View>
                <MoneyText prices={bundle.prices} large />
                <Timer small expiresAt={bundle.expiresAt} offset={store.clockOffsetMs} />
                {bundle.offers.length > 0 && (
                  <OfferGrid
                    offers={bundle.offers}
                    wishlist={model.wishlist}
                    onWish={(id) => void model.toggleWish(id)}
                    onOpen={onItem}
                  />
                )}
              </View>
            ))
          ) : (
            <Empty
              title="No featured bundles returned"
              detail="This section updates with the next successful store refresh."
            />
          )}
          <Text style={S.h2}>Bundle archive</Text>
          <View style={styles.bundleArchive}>
            {Object.entries(model.catalog.bundles)
              .sort((a, b) => a[1].name.localeCompare(b[1].name))
              .map(([id, bundle]) => (
                <View key={id} style={styles.bundleArchiveCard}>
                  {bundle.image ? (
                    <Image
                      source={{ uri: bundle.image }}
                      style={styles.bundleArchiveImage}
                      resizeMode="cover"
                    />
                  ) : null}
                  <Text style={S.h3} numberOfLines={2}>
                    {bundle.name}
                  </Text>
                  <Text style={S.small}>Public catalog · historical availability</Text>
                </View>
              ))}
          </View>
        </>
      )}
      {tab === 'accessories' && (
        <>
          <Intro
            eyebrow="THE SMALL DETAILS"
            title="Accessory store"
            detail="Buddies, sprays, and other accessories returned in your store."
          />
          {store.accessoriesExpireAt && (
            <Timer small expiresAt={store.accessoriesExpireAt} offset={store.clockOffsetMs} />
          )}
          {store.accessories.length ? (
            <OfferGrid
              offers={store.accessories}
              wishlist={model.wishlist}
              onWish={(id) => void model.toggleWish(id)}
              onOpen={onItem}
            />
          ) : (
            <Empty
              title="No accessories returned"
              detail="Availability and response formats can differ by account and client version."
            />
          )}
        </>
      )}
      <Text style={S.small}>
        Observed {date(store.fetchedAt)} ·{' '}
        {store.endpoint === 'demo' ? 'Illustrative data' : `Unofficial ${store.endpoint} adapter`} ·
        Prices are not a purchase quote.
      </Text>
    </>
  );
  return (
    <Page model={model}>
      <View style={S.between}>
        <Intro eyebrow="YOUR DAILY DROP" title="The store" />
        <View style={styles.largeIcon}>
          <Feather name="shopping-bag" size={24} color={C.accent} />
        </View>
      </View>
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
        <>
          <Intro
            eyebrow="SEEN, NOT GUESSED"
            title="Observed history"
            detail="Only rotations this device actually fetched are recorded. Offline and expired-session gaps stay gaps."
          />
          {model.history.length ? (
            model.history.map((entry) => (
              <View key={entry.id} style={S.card}>
                <Text style={S.h3}>{date(entry.observedAt)}</Text>
                <Text style={S.small}>Reset: {date(entry.expiresAt)}</Text>
                <OfferGrid
                  offers={entry.offers}
                  wishlist={model.wishlist}
                  onWish={(id) => void model.toggleWish(id)}
                  onOpen={onItem}
                />
              </View>
            ))
          ) : (
            <Empty
              title="Your story starts here"
              detail={
                model.active?.demo
                  ? 'Demo mode never writes account history to the device database.'
                  : 'Successful real-account refreshes will save observed rotations here for up to 90 days.'
              }
              icon="clock"
            />
          )}
        </>
      ) : (
        <Resource section={model.snapshot?.store} title="Store">
          {renderStore}
        </Resource>
      )}
    </Page>
  );
}
export function CollectionScreen({ model, onItem }: Props) {
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
          Object.values(model.catalog.items)
            .filter((item) => item.kind !== 'chroma')
            .map((item) => [item.canonicalId, { ...item, id: item.canonicalId }]),
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
    <View style={{ gap: 18, paddingBottom: 18 }}>
      <Intro
        eyebrow="BUILT OVER TIME"
        title="Your collection"
        detail="Explore what you own. Save what you are waiting for."
      />
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { id: 'owned', label: 'Owned' },
          { id: 'wishlist', label: `Wishlist · ${model.wishlist.length}` },
          { id: 'catalog', label: 'Discover' },
          { id: 'equipped', label: 'Loadout' },
        ]}
      />
      {tab !== 'equipped' && (
        <>
          <TextInput
            style={S.input}
            placeholder="Search your next favourite…"
            placeholderTextColor={C.subtle}
            value={query}
            onChangeText={setQuery}
            accessibilityLabel="Search collection"
            autoCorrect={false}
          />
          <Tabs
            value={kind}
            onChange={setKind}
            items={[
              { id: 'all', label: 'All' },
              { id: 'skin', label: 'Skins' },
              { id: 'buddy', label: 'Buddies' },
              { id: 'spray', label: 'Sprays' },
              { id: 'card', label: 'Cards' },
              { id: 'agent', label: 'Agents' },
              { id: 'chroma', label: 'Chromas' },
              { id: 'title', label: 'Titles' },
            ]}
          />
          {(kind === 'skin' || kind === 'chroma') && (
            <Tabs
              value={weapon}
              onChange={setWeapon}
              items={weapons.map((id) => ({ id, label: id === 'all' ? 'All weapons' : id }))}
            />
          )}
          <Text style={S.small}>
            {tab === 'catalog'
              ? 'Public catalog; not an ownership claim.'
              : tab === 'owned'
                ? 'Skin levels are grouped into their parent skin; chromas remain separate.'
                : 'A heart means “notify me after a successful refresh”, not continuous monitoring.'}
          </Text>
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
              {data.card && (
                <View style={S.card}>
                  <ItemArt item={data.card} size={140} />
                  <Text style={S.h3}>{data.card.name}</Text>
                </View>
              )}
              {data.title && <Badge text={data.title.name} color={C.gold} />}
              {data.guns.map((gun, index) => (
                <Pressable
                  key={`${gun.weapon}:${index}`}
                  style={S.card}
                  onPress={() => onItem(gun.skin)}
                >
                  <Text style={S.eyebrow}>{gun.weapon.toUpperCase()}</Text>
                  <ItemArt item={gun.skin} size={110} />
                  <Text style={S.h3}>{gun.skin.name}</Text>
                  {gun.buddy && <Text style={S.body}>Buddy · {gun.buddy.name}</Text>}
                </Pressable>
              ))}
              <Text style={S.small}>Read-only. This app cannot change your equipped items.</Text>
            </>
          )}
        </Resource>
      </Page>
    );
  return (
    <FlatList
      data={tab === 'owned' && model.snapshot?.collection.status !== 'ready' ? [] : items}
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
          tintColor={C.mint}
        />
      }
      initialNumToRender={12}
      maxToRenderPerBatch={12}
      windowSize={7}
      renderItem={({ item }) => (
        <View style={[styles.collectionCard, { maxWidth: '49%' }]}>
          <Pressable
            onPress={() => onItem(item)}
            accessibilityRole="button"
            accessibilityLabel={`View ${item.name}`}
          >
            <ItemArt item={item} size={100} />
            <Text style={[S.h3, { fontSize: 14, minHeight: 38 }]} numberOfLines={2}>
              {item.name}
            </Text>
          </Pressable>
          <View style={S.between}>
            <Text style={S.small}>{item.kind}</Text>
            <IconButton
              icon="heart"
              label={`${model.wishlist.includes(item.canonicalId) ? 'Remove' : 'Add'} wishlist item`}
              color={model.wishlist.includes(item.canonicalId) ? C.accent : C.subtle}
              onPress={() => void model.toggleWish(item.canonicalId)}
            />
          </View>
        </View>
      )}
      ListEmptyComponent={
        tab === 'owned' && model.snapshot?.collection.status !== 'ready' ? (
          <Resource section={model.snapshot?.collection} title="Collection">
            {() => null}
          </Resource>
        ) : (
          <Empty
            title={tab === 'wishlist' ? 'Good things are worth waiting for' : 'Nothing found'}
            detail={
              tab === 'wishlist'
                ? 'Tap a heart in the store or Discover. Wishlists are separate for every account.'
                : 'Try a different search or refresh the account.'
            }
            icon="heart"
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
      <View style={S.between}>
        <Text style={S.h2}>All rewards</Text>
        <Text style={S.small}>{rewards.length} catalogued tiers</Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 10 }}
      >
        {rewards.map((reward) => (
          <Pressable
            key={`${active?.id}:${reward.index}`}
            style={styles.rewardCard}
            onPress={() => reward.item && onItem(reward.item)}
          >
            <Text style={S.small}>TIER {reward.index + 1}</Text>
            {reward.item && <ItemArt item={reward.item} size={82} />}
            <Text style={S.h3} numberOfLines={2}>
              {reward.item?.name}
            </Text>
            <Text style={S.small}>{reward.xp.toLocaleString()} XP</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
export function ProgressScreen({ model, onItem }: Props) {
  return (
    <Page model={model}>
      <Intro
        eyebrow="SEASON PROGRESS"
        title="Battle Pass"
        detail="Tier progress, missions, rank context, and every catalogued reward."
      />
      <Resource title="Rank" section={model.snapshot?.rank}>
        {(rank) => (
          <LinearGradient colors={['#2B243E', C.surface]} style={styles.hero}>
            <View style={S.between}>
              <Badge
                text={rank.currentSeason ? 'CURRENT ACT' : 'SEASON UNRESOLVED'}
                color={C.violet}
              />
              <Feather name="award" color={C.violet} size={30} />
            </View>
            <Text style={[S.title, { fontSize: 27, marginTop: 14 }]}>{rank.name}</Text>
            <Text style={[S.body, { marginTop: 8 }]}>
              {rank.rr === null ? 'Rank rating unavailable' : `${rank.rr} RR`}
            </Text>
            <View style={[S.row, { marginTop: 16 }]}>
              <Stat label="ACT WINS" value={rank.wins} />
              <Stat label="ACT GAMES" value={rank.games} />
              <Stat
                label="WIN RATE"
                value={
                  rank.wins !== null && rank.games
                    ? `${Math.round((rank.wins / rank.games) * 100)}%`
                    : null
                }
              />
            </View>
          </LinearGradient>
        )}
      </Resource>
      <Resource title="Account level" section={model.snapshot?.xp}>
        {(xp) => (
          <View style={[S.card, S.between]}>
            <View style={{ gap: 6 }}>
              <Text style={S.eyebrow}>ACCOUNT LEVEL</Text>
              <Text style={S.title}>{xp.level}</Text>
            </View>
            <View>
              <Text style={S.h3}>{xp.xp.toLocaleString()} AP</Text>
              <Text style={S.small}>Current reported progress</Text>
            </View>
          </View>
        )}
      </Resource>
      <BattlePassRewards model={model} onItem={onItem} />
      <Resource title="Contracts and missions" section={model.snapshot?.progression}>
        {(progress) => (
          <>
            <Text style={S.h2}>Contracts & battle pass</Text>
            {progress.contracts.length ? (
              progress.contracts.map((contract) => (
                <View style={S.card} key={contract.id}>
                  {contract.currentBattlepass && <Badge text="ACTIVE BATTLE PASS" color={C.gold} />}
                  <Text style={S.h2}>{contract.name}</Text>
                  <View style={S.between}>
                    <Text style={S.body}>Level {contract.level}</Text>
                    <Text style={S.small}>
                      {contract.xp.toLocaleString()}
                      {contract.nextLevelXp ? ` / ${contract.nextLevelXp.toLocaleString()}` : ''} XP
                    </Text>
                  </View>
                  {contract.nextLevelXp !== undefined && (
                    <ProgressBar value={contract.xp} max={contract.nextLevelXp} />
                  )}
                  {contract.nextReward && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`View next reward ${contract.nextReward.name}`}
                      style={[S.row, { marginTop: 6 }]}
                      onPress={() => onItem(contract.nextReward!)}
                    >
                      <ItemArt item={contract.nextReward} size={62} style={{ width: 90 }} />
                      <View style={{ flex: 1 }}>
                        <Text style={S.eyebrow}>NEXT REWARD</Text>
                        <Text style={S.h3}>{contract.nextReward.name}</Text>
                      </View>
                      <Feather name="chevron-right" size={20} color={C.subtle} />
                    </Pressable>
                  )}
                </View>
              ))
            ) : (
              <Empty
                title="No active contracts returned"
                detail="The app does not estimate progress from play time."
                icon="flag"
              />
            )}
            <Text style={S.h2}>Missions</Text>
            {progress.missions.map((mission, index) => (
              <View key={mission.id} style={S.card}>
                <View style={S.between}>
                  <Text style={S.h3}>Mission {index + 1}</Text>
                  <Badge
                    text={mission.complete ? 'COMPLETE' : 'IN PROGRESS'}
                    color={mission.complete ? C.mint : C.gold}
                  />
                </View>
                <Text style={S.body}>
                  Reported objective values:{' '}
                  {mission.objectives.length ? mission.objectives.join(' · ') : 'Unavailable'}
                </Text>
                <Text style={S.small}>
                  Descriptions and targets are not supplied by this adapter. Values are not
                  completion percentages.
                </Text>
                {mission.expiresAt && (
                  <Text style={S.small}>Expires {date(mission.expiresAt)}</Text>
                )}
              </View>
            ))}
            {!progress.missions.length && (
              <Text style={S.body}>No missions in the current response.</Text>
            )}
            {progress.weeklyRefillAt && (
              <Text style={S.small}>Weekly refill · {date(progress.weeklyRefillAt)}</Text>
            )}
          </>
        )}
      </Resource>
    </Page>
  );
}
function Stat({ label, value }: { label: string; value: string | number | null }) {
  return (
    <View style={{ flex: 1, gap: 7 }}>
      <Text style={S.small}>{label}</Text>
      <Text style={[S.h2, { fontVariant: ['tabular-nums'] }]}>{value ?? '-'}</Text>
    </View>
  );
}
export function MatchesScreen({ model }: Props) {
  const [selected, setSelected] = useState<string | null>(null),
    [detail, setDetail] = useState<MatchDetail | null>(null),
    [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setSelected(null);
    setDetail(null);
  }, [model.active?.puuid]);
  useEffect(() => {
    let alive = true;
    setDetail(null);
    setError(null);
    if (selected)
      model
        .matchDetail(selected)
        .then((data) => {
          if (alive) setDetail(data);
        })
        .catch((reason) => {
          if (alive) setError(safeError(reason).message);
        });
    return () => {
      alive = false;
    };
  }, [selected, model.matchDetail]);
  return (
    <>
      <Page model={model}>
        <Intro
          eyebrow="YOUR CAREER"
          title={`${model.active?.gameName ?? 'Profile'}#${model.active?.tagLine ?? ''}`}
          detail="Rank, account level, recent matches and personal performance in one place."
        />
        <Resource title="Rank" section={model.snapshot?.rank}>
          {(rank) => (
            <View style={styles.profileRank}>
              <View>
                <Text style={S.small}>CURRENT RANK</Text>
                <Text style={S.h2}>{rank.name}</Text>
                <Text style={S.body}>{rank.rr === null ? 'RR unavailable' : `${rank.rr} RR`}</Text>
              </View>
              {rank.image ? (
                <Image
                  source={{ uri: rank.image }}
                  style={{ width: 78, height: 78 }}
                  resizeMode="contain"
                />
              ) : (
                <Feather name="award" size={52} color={C.gold} />
              )}
            </View>
          )}
        </Resource>
        <Resource title="Account level" section={model.snapshot?.xp}>
          {(xp) => (
            <View style={[S.card, S.between]}>
              <View>
                <Text style={S.small}>ACCOUNT LEVEL</Text>
                <Text style={S.title}>{xp.level}</Text>
              </View>
              <Text style={S.body}>{xp.xp.toLocaleString()} AP</Text>
            </View>
          )}
        </Resource>
        <Text style={S.h2}>Current game</Text>
        <Resource title="Current game" section={model.snapshot?.liveGame}>
          {(game) => (
            <View style={styles.liveCard}>
              {game.mapImage ? (
                <Image
                  source={{ uri: game.mapImage }}
                  style={StyleSheet.absoluteFill}
                  resizeMode="cover"
                />
              ) : null}
              <View style={styles.liveShade} />
              <View style={{ gap: 4 }}>
                <Text style={[S.h2, { zIndex: 2 }]}>
                  {game.state === 'in_game'
                    ? 'In Progress'
                    : game.state === 'agent_select'
                      ? 'Agent Select'
                      : 'Not in a live game'}
                </Text>
                <Text style={[S.body, { zIndex: 2 }]}>
                  {game.map ??
                    (game.state === 'offline'
                      ? 'Open VALORANT to start a session'
                      : 'Map resolving…')}
                </Text>
              </View>
              <Feather
                name={game.state === 'offline' ? 'moon' : 'radio'}
                color={game.state === 'offline' ? C.subtle : C.mint}
                size={26}
              />
            </View>
          )}
        </Resource>
        <Text style={S.h2}>Match history</Text>
        <Resource title="Match history" section={model.snapshot?.matches}>
          {(matches) => (
            <>
              {matches.map((match) => (
                <Pressable
                  key={match.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${match.map} match`}
                  onPress={() => setSelected(match.id)}
                  style={styles.matchRow}
                >
                  <View style={[styles.mapTile, { overflow: 'hidden' }]}>
                    {match.mapImage ? (
                      <Image
                        source={{ uri: match.mapImage }}
                        style={StyleSheet.absoluteFill}
                        resizeMode="cover"
                      />
                    ) : (
                      <Feather name="map" size={25} color={C.subtle} />
                    )}
                  </View>
                  <View style={{ flex: 1, gap: 5 }}>
                    <Text style={S.h3}>{match.map}</Text>
                    <Text style={S.small}>
                      {match.queue} · {date(match.startedAt)}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 7 }}>
                    {match.rrChange !== undefined && (
                      <Text
                        style={{
                          color: match.rrChange >= 0 ? C.mint : C.accent,
                          fontWeight: '800',
                          fontSize: 17,
                        }}
                      >
                        {match.rrChange > 0 ? '+' : ''}
                        {match.rrChange} RR
                      </Text>
                    )}
                    <Feather name="chevron-right" size={18} color={C.subtle} />
                  </View>
                </Pressable>
              ))}
              {!matches.length && (
                <Empty
                  title="No matches returned"
                  detail="History availability depends on the account and Riot's service."
                  icon="crosshair"
                />
              )}
              {!model.active?.demo && matches.length > 0 && matches.length < 1000 && (
                <Button
                  title="Load older matches"
                  secondary
                  disabled={model.busy}
                  onPress={() => void model.moreMatches()}
                />
              )}
            </>
          )}
        </Resource>
      </Page>
      <Modal
        visible={selected !== null}
        animationType="slide"
        onRequestClose={() => setSelected(null)}
      >
        <SafeAreaView style={S.page}>
          <View style={styles.modalHeader}>
            <Text style={S.h2}>Match report</Text>
            <IconButton icon="x" label="Close match report" onPress={() => setSelected(null)} />
          </View>
          <ScrollView contentContainerStyle={S.content}>
            {error ? (
              <Empty title="Report unavailable" detail={error} icon="alert-circle" />
            ) : !detail ? (
              <ActivityIndicator size="large" color={C.mint} />
            ) : (
              <>
                <Badge
                  text={detail.result === 'UNKNOWN' ? 'RESULT UNAVAILABLE' : detail.result}
                  color={
                    detail.result === 'WIN' ? C.mint : detail.result === 'LOSS' ? C.accent : C.gold
                  }
                />
                <Text style={S.title}>{detail.map}</Text>
                <Text style={[S.title, { fontSize: 48 }]}>{detail.score}</Text>
                <Text style={S.body}>
                  {detail.agent} · {detail.queue} · {date(detail.startedAt)}
                </Text>
                <View style={S.card}>
                  <View style={S.row}>
                    <Stat label="KILLS" value={detail.kills} />
                    <Stat label="DEATHS" value={detail.deaths} />
                    <Stat label="ASSISTS" value={detail.assists} />
                  </View>
                  <View style={S.divider} />
                  <View style={S.row}>
                    <Stat label="AVG COMBAT SCORE" value={detail.acs} />
                    <Stat
                      label="HEADSHOTS"
                      value={detail.headshotPct === null ? null : `${detail.headshotPct}%`}
                    />
                  </View>
                </View>
                <Text style={S.small}>
                  Headshot rate uses your reported head/body/leg hit counts. ACS uses your combat
                  score divided by rounds played. Missing values stay unavailable.
                </Text>
              </>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>
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
  return (
    <>
      <Page model={model}>
        <Intro eyebrow="YOU ARE IN CONTROL" title="Account & privacy" />
        <View style={S.card}>
          <View style={S.between}>
            <View style={{ flex: 1 }}>
              <Text style={S.h2}>
                {active.gameName}
                <Text style={{ color: C.subtle }}>#{active.tagLine}</Text>
              </Text>
              <Text style={S.body}>
                {active.region.toUpperCase()} region · {active.shard.toUpperCase()} shard
              </Text>
            </View>
            <Feather name="shield" size={28} color={C.mint} />
          </View>
          <Badge
            text={
              active.demo
                ? 'DEMO ACCOUNT'
                : active.expiresAt > Date.now()
                  ? 'LOCAL SESSION'
                  : 'RECONNECT REQUIRED'
            }
            color={active.demo ? C.gold : active.expiresAt > Date.now() ? C.mint : C.accent}
          />
          <InfoRow
            label="Session expires"
            value={active.demo ? 'Not a real session' : date(active.expiresAt)}
          />
          <InfoRow label="Account created" value={date(active.createdAt)} />
          <InfoRow label="Country returned by Riot" value={active.country ?? 'Not returned'} />
          <InfoRow
            label="Email verified"
            value={
              active.emailVerified === undefined
                ? 'Not returned'
                : active.emailVerified
                  ? 'Yes'
                  : 'No'
            }
          />
          <InfoRow
            label="Phone verified"
            value={
              active.phoneVerified === undefined
                ? 'Not returned'
                : active.phoneVerified
                  ? 'Yes'
                  : 'No'
            }
          />
          {!active.demo && (
            <Button
              title="Reconnect Riot account"
              secondary
              icon="refresh-cw"
              onPress={() => onLink(active.puuid)}
            />
          )}
        </View>
        <View style={S.between}>
          <Text style={S.h2}>Your accounts</Text>
          <Text style={S.small}>{model.accounts.length} / 5 linked</Text>
        </View>
        {model.accounts.map((account) => (
          <Pressable
            key={account.puuid}
            accessibilityRole="button"
            onPress={() => model.switchAccount(account)}
            style={[S.card, S.between, account.puuid === active.puuid && { borderColor: C.mint }]}
          >
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={S.h3}>
                {account.gameName}#{account.tagLine}
              </Text>
              <Text style={S.small}>
                {account.region.toUpperCase()} ·{' '}
                {account.expiresAt > Date.now() ? 'Session stored' : 'Sign-in required'}
              </Text>
            </View>
            <Feather
              name={account.puuid === active.puuid ? 'check-circle' : 'chevron-right'}
              size={21}
              color={account.puuid === active.puuid ? C.mint : C.subtle}
            />
          </Pressable>
        ))}
        <Button
          title="Link another account"
          icon="plus"
          disabled={model.accounts.length >= 5 || Platform.OS === 'web'}
          onPress={() => onLink()}
        />
        {active.demo && <Button title="Leave demo" secondary onPress={model.leaveDemo} />}
        <Text style={S.h2}>Device services</Text>
        <View style={S.card}>
          <Setting
            title="Local reminders & wishlist alerts"
            detail="A reset reminder from the last observed timer; wishlist alerts only after a successful sync."
            value={model.settings.reminders}
            disabled={active.demo || Platform.OS === 'web'}
            onChange={(value) => void model.saveSettings({ ...model.settings, reminders: value })}
          />
          <View style={S.divider} />
          <Setting
            title="Unattended store monitoring"
            detail="Renews short-lived Riot access tokens from your encrypted web session cookie and refreshes when the OS grants background time. No password is stored."
            value={model.settings.backgroundSync}
            disabled={active.demo || Platform.OS === 'web'}
            onChange={(value) =>
              void model.saveSettings({ ...model.settings, backgroundSync: value })
            }
          />
        </View>
        <View style={S.card}>
          <Text style={S.h3}>What stays on this device</Text>
          <Text style={S.body}>
            Riot tokens use native secure storage. Account metadata, normalized snapshots, observed
            store history, and wishlists are stored locally. The game-data cache is not additionally
            encrypted by this app.
          </Text>
          <Text style={S.body}>
            No Outpost backend, analytics SDK, password database, purchase actions, or hidden-player
            scouting. Public catalog images come from valorant-api.com without your Riot token.
          </Text>
          <Text style={S.body}>
            Reusable Riot web-session cookies are retained in native secure storage so access tokens
            can renew without another password prompt. Riot can revoke them or require MFA again.
            Removing an account deletes the local session, cache, wishlist, and pending
            notifications; it does not revoke the Riot session on Riot's servers.
          </Text>
        </View>
        <View style={S.card}>
          <Text style={[S.h3, { color: C.gold }]}>Experimental, not Riot-approved</Text>
          <Text style={S.body}>
            The personal store is not available through Riot's public VALORANT API. This adapter
            uses undocumented client services and can break or be blocked. A working token is not
            permission to publicly distribute the integration.
          </Text>
          <Text style={S.body}>
            This version covers VALORANT only. It does not retrieve payment history, lifetime
            spending, League/TFT inventories, private messages, or all account settings.
          </Text>
        </View>
        <Button
          title="Clear cached game data"
          secondary
          icon="trash-2"
          disabled={!!active.demo}
          onPress={() => setConfirm('cache')}
        />
        {!active.demo && (
          <Button
            title="Remove this account from device"
            secondary
            icon="log-out"
            onPress={() => setConfirm('remove')}
          />
        )}
        <Text style={[S.small, { textAlign: 'center' }]}>
          OUTPOST 0.2.0 · Independent companion{'\n'}Not affiliated with or endorsed by Riot Games.
        </Text>
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
              {confirm === 'remove' ? 'Remove this account?' : 'Clear local game data?'}
            </Text>
            <Text style={S.body}>
              {confirm === 'remove'
                ? 'This removes the saved session, snapshots, observed history, wishlist, and notifications for this account. Your Riot account is not deleted.'
                : 'This clears cached snapshots, catalog, and observed history for all accounts. Linked accounts and wishlists are kept.'}
            </Text>
            <Button
              title={working ? 'Applying…' : 'Confirm'}
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
      <View style={{ flex: 1, gap: 5 }}>
        <Text style={S.h3}>{title}</Text>
        <Text style={S.small}>{detail}</Text>
      </View>
      <Switch
        accessibilityLabel={title}
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ false: C.border, true: C.mint }}
        thumbColor={C.ink}
      />
    </View>
  );
}
function SkinVideo({ uri }: { uri?: string }) {
  const player = useVideoPlayer(uri ?? null, (p) => {
    p.loop = true;
    p.muted = false;
  });
  if (!uri) return null;
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
  const [preview, setPreview] = useState<{
    id: string;
    name: string;
    image?: string;
    video?: string;
  } | null>(null);
  useEffect(() => setPreview(null), [item?.id]);
  const shown = preview ?? item;
  return (
    <Modal visible={!!item} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={S.page}>
        <View style={styles.modalHeader}>
          <View>
            <Text style={S.small}>COSMETIC DETAILS</Text>
            <Text style={S.h2} numberOfLines={1}>
              {item?.name ?? ''}
            </Text>
          </View>
          <IconButton icon="x" label="Close item details" onPress={onClose} />
        </View>
        {item && (
          <ScrollView contentContainerStyle={S.content}>
            <LinearGradient colors={['#25191C', '#111', C.background]} style={styles.detailHero}>
              {shown?.image ? (
                <Image
                  source={{ uri: shown.image }}
                  style={{ width: '100%', height: 220 }}
                  resizeMode="contain"
                />
              ) : (
                <ItemArt item={item} size={220} />
              )}
            </LinearGradient>
            <View style={{ gap: 6 }}>
              <Text style={S.eyebrow}>{item.rarity?.toUpperCase() ?? item.kind.toUpperCase()}</Text>
              <Text style={S.title}>{item.name}</Text>
              {item.weapon && <Text style={S.body}>{item.weapon}</Text>}
            </View>
            <SkinVideo uri={shown?.video ?? item.video} />
            {item.levels?.length ? (
              <>
                <Text style={S.h2}>Upgrade levels</Text>
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
                      <Text style={S.small}>LEVEL {index + 1}</Text>
                      {level.image ? (
                        <Image
                          source={{ uri: level.image }}
                          style={{ width: 110, height: 64 }}
                          resizeMode="contain"
                        />
                      ) : null}
                      <Text style={S.h3} numberOfLines={1}>
                        {level.name}
                      </Text>
                      {level.video ? (
                        <View style={S.row}>
                          <Feather name="play-circle" color={C.accent} size={14} />
                          <Text style={S.small}>Preview video</Text>
                        </View>
                      ) : null}
                    </Pressable>
                  ))}
                </ScrollView>
              </>
            ) : null}
            {item.chromas?.length ? (
              <>
                <Text style={S.h2}>Color variants</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 10 }}
                >
                  {item.chromas.map((chroma, index) => (
                    <Pressable
                      key={chroma.id}
                      onPress={() => setPreview(chroma)}
                      style={[
                        styles.chromaChip,
                        preview?.id === chroma.id && { borderColor: C.accent },
                      ]}
                    >
                      {chroma.image ? (
                        <Image
                          source={{ uri: chroma.image }}
                          style={{ width: 130, height: 86 }}
                          resizeMode="contain"
                        />
                      ) : null}
                      <Text style={S.small}>VARIANT {index + 1}</Text>
                      <Text style={S.h3} numberOfLines={1}>
                        {chroma.name}
                      </Text>
                      {chroma.video ? <Feather name="play" color={C.accent} size={14} /> : null}
                    </Pressable>
                  ))}
                </ScrollView>
              </>
            ) : null}
            <Button
              title={
                model.wishlist.includes(item.canonicalId)
                  ? 'Remove from wishlist'
                  : 'Add to wishlist'
              }
              icon="heart"
              secondary={model.wishlist.includes(item.canonicalId)}
              onPress={() => void model.toggleWish(item.canonicalId)}
            />
            <Text style={S.small}>
              Weapon metadata, upgrade videos and variants come from the public VALORANT asset
              catalog. Ownership comes only from your linked account entitlements.
            </Text>
            {model.active?.demo && <Badge text="ILLUSTRATIVE DEMO ITEM" color={C.gold} />}
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  );
}
const styles = StyleSheet.create({
  hero: { borderRadius: 22, padding: 22, borderWidth: 1, borderColor: C.border, gap: 8 },
  wallet: {
    backgroundColor: C.surface,
    borderRadius: 18,
    flexDirection: 'row',
    padding: 17,
    gap: 12,
  },
  currency: { flex: 1, gap: 9 },
  coin: {
    width: 12,
    height: 12,
    borderWidth: 2,
    transform: [{ rotate: '45deg' }],
    borderRadius: 3,
  },
  balance: { color: C.ink, fontSize: 21, fontWeight: '800', fontVariant: ['tabular-nums'] },
  largeIcon: {
    width: 52,
    height: 52,
    borderRadius: 17,
    backgroundColor: '#FF536414',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bundleImage: { width: '100%', height: 155, borderRadius: 12 },
  collectionCard: {
    flex: 1,
    backgroundColor: C.surface,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: C.border,
  },
  matchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: C.surface,
    borderRadius: 18,
    padding: 13,
    borderWidth: 1,
    borderColor: C.border,
  },
  mapTile: {
    width: 60,
    height: 70,
    borderRadius: 12,
    backgroundColor: C.raised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: C.border,
  },
  scrim: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000B',
    padding: 24,
  },
  bundleArchive: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  bundleArchiveCard: {
    width: '48%',
    flexGrow: 1,
    maxWidth: '50%',
    backgroundColor: C.surface,
    borderRadius: 20,
    overflow: 'hidden',
    paddingBottom: 14,
    gap: 8,
  },
  bundleArchiveImage: { width: '100%', height: 100 },
  profileRank: {
    backgroundColor: C.surface,
    borderRadius: 24,
    padding: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#242424',
  },
  rewardCard: {
    width: 150,
    backgroundColor: C.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.border,
    padding: 12,
    gap: 7,
  },
  liveCard: {
    position: 'relative',
    overflow: 'hidden',
    minHeight: 120,
    backgroundColor: C.surface,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: C.border,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  liveShade: { ...StyleSheet.absoluteFill, backgroundColor: '#0008' },
  detailHero: {
    borderRadius: 28,
    padding: 18,
    minHeight: 260,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoShell: {
    backgroundColor: '#000',
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: C.border,
  },
  video: { width: '100%', aspectRatio: 16 / 9 },
  mediaChip: {
    width: 170,
    backgroundColor: C.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.border,
    padding: 12,
    gap: 7,
  },
  chromaChip: {
    width: 160,
    backgroundColor: C.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.border,
    padding: 12,
    gap: 7,
  },
});
