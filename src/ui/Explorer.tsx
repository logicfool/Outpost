import { CollectionBrowser, EquippedPanel } from './CollectionHub';
import { RoundPanel } from './RoundPanel';
import { LiveEquipmentPanel } from './LiveEquipmentPanel';
import { ownLiveProgress, progressLabel } from '../core/liveProgress';
import { BundlePanel } from './BundlePanel';
import { ItemModal } from './screens';
import { useMatchPreviews } from '../state/useMatchPreviews';
import { ChatPanel } from './ChatPanel';
import { ChatSettings } from './ChatSettings';
import { PlayerAvatar } from './PlayerAvatar';
import { PresetsPanel } from './PresetsPanel';
import { Image } from './CachedImage';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { AppModel } from '../state/useApp';
import type { ExplorerRoute, Navigate } from './explorerTypes';
import type { PlayerProfile, PlayerRef } from '../core/playerTypes';
import type { CatalogItem, Loadout, MatchDetail, MatchSummary, Ranked } from '../core/types';
import type { Friend } from '../core/chatTypes';
import { safeError } from '../core/validation';
import { queueName } from '../core/normalize';
import { useLivePolling } from '../state/useLivePolling';
import {
  Button,
  Badge,
  Empty,
  IconButton,
  ItemArt,
  ModalHeader,
  ModalPage,
  ProgressBar,
  Resource,
  SectionHeader,
  Tabs,
} from './components';
import { CareerModal, HistoryRow, MatchCard, MatchReport } from './screens';
import { playerLabel } from '../core/playerNames';
import { PlayerCover } from './profileViews';
import { useTheme, type Palette } from './theme';

type PanelProps = { model: AppModel; onNavigate: Navigate; onBack(): void };
const time = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const statusName: Record<Friend['presence'], string> = {
  in_game: 'In game',
  agent_select: 'Agent select',
  queue: 'In queue',
  online: 'Online',
  away: 'Away',
  offline: 'Offline',
};
function RankSummary({ rank, onCareer }: { rank: Ranked; onCareer(): void }) {
  const { C, S, isDark } = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="View rank history"
      onPress={onCareer}
      style={S.card}
    >
      <View style={S.between}>
        <Text style={S.h3}>Rank & career</Text>
        <Feather name="chevron-right" size={18} color={C.subtle} />
      </View>
      <View style={S.row}>
        {[
          {
            name: rank.name,
            image: rank.image,
            label: rank.currentSeason ? 'CURRENT' : 'LAST REPORTED',
            detail: rank.rr === null ? 'RR not returned' : `${rank.rr} RR`,
          },
          {
            name: rank.peak?.name ?? 'Not returned',
            image: rank.peak?.image,
            label: 'PEAK',
            detail: rank.peak?.seasonName ?? '',
          },
        ].map((item, index) => (
          <View key={index} style={{ flex: 1, alignItems: 'center', gap: 7 }}>
            <Text style={S.small}>{item.label}</Text>
            {item.image ? (
              <Image
                source={{ uri: item.image }}
                style={{ width: 72, height: 72 }}
                resizeMode="contain"
              />
            ) : (
              <Feather name="award" size={42} color={C.subtle} />
            )}
            <Text style={S.h3}>{item.name}</Text>
            <Text style={[S.small, { textAlign: 'center' }]}>{item.detail}</Text>
          </View>
        ))}
      </View>
      {rank.note && <Text style={S.small}>{rank.note}</Text>}
      <Text style={S.body}>
        {rank.wins ?? '-'} wins · {rank.games ?? '-'} games
        {rank.wins !== null && rank.games
          ? ` · ${((100 * rank.wins) / rank.games).toFixed(1)}% win rate`
          : ''}
      </Text>
    </Pressable>
  );
}
function PlayerPanel({ model, player, onBack, onNavigate }: PanelProps & { player: PlayerRef }) {
  const { C, S, isDark } = useTheme();

  const [data, setData] = useState<PlayerProfile | null>(null),
    [error, setError] = useState<string | null>(null),
    [version, setVersion] = useState(0);
  const [queue, setQueue] = useState('all'),
    [loading, setLoading] = useState(false),
    [finished, setFinished] = useState(false);
  const previews = useMatchPreviews(model, player.subject),
    details = previews.details;
  const generation = useRef(0);
  useEffect(() => {
    const stamp = ++generation.current;
    setData(null);
    setError(null);
    setFinished(false);
    model
      .playerProfile(player)
      .then((value) => {
        if (generation.current === stamp) setData(value);
      })
      .catch((e) => {
        if (generation.current === stamp) setError(safeError(e).message);
      });
    return () => {
      generation.current++;
    };
  }, [player.subject, version, model.playerProfile]);
  const friend =
    model.chat.status === 'ready'
      ? model.chat.friends.find((f) => f.subject === player.subject)
      : undefined;
  const live =
    model.snapshot?.liveGame.status === 'ready' ? model.snapshot.liveGame.data : undefined;
  const liveParticipant =
    !!live?.matchId && !!live.players?.some((p) => p.subject === player.subject && !p.hidden);
  const matches = data?.matches.status === 'ready' ? data.matches.data : [];
  const more = async () => {
    if (loading) return;
    const stamp = generation.current;
    setLoading(true);
    try {
      const next = await model.playerMatches(player.subject, matches.length);
      if (generation.current !== stamp) return;
      setFinished(!next.length);
      setData((old) =>
        old
          ? {
              ...old,
              matches: {
                status: 'ready',
                data: [...new Map([...matches, ...next].map((m) => [m.id, m])).values()],
                fetchedAt: Date.now(),
              },
            }
          : old,
      );
    } catch (e) {
      if (generation.current === stamp) setError(safeError(e).message);
    } finally {
      if (generation.current === stamp) setLoading(false);
    }
  };
  const queues = useMemo(() => ['all', ...new Set(matches.map((m) => m.queue))], [data?.matches]);
  const shown = useMemo(
    () => matches.filter((m) => queue === 'all' || m.queue === queue),
    [data?.matches, queue],
  );
  const open = useCallback(
    (id: string) => onNavigate({ type: 'match', id, subject: player.subject }),
    [onNavigate, player.subject],
  );
  const render = useCallback(
    ({ item }: { item: MatchSummary }) => (
      <View style={{ marginBottom: 12 }}>
        <HistoryRow match={item} detail={details[item.id]} onOpen={open} />
      </View>
    ),
    [details, open],
  );
  return (
    <ModalPage>
      <ModalHeader title="Player profile" closeLabel="Back from player profile" onClose={onBack} />
      <FlatList
        refreshControl={
          <RefreshControl
            refreshing={!data && !error}
            onRefresh={() => setVersion((v) => v + 1)}
            tintColor={C.accent}
          />
        }
        data={shown}
        keyExtractor={(m) => m.id}
        onViewableItemsChanged={previews.onViewableItemsChanged}
        viewabilityConfig={previews.viewabilityConfig}
        renderItem={render}
        initialNumToRender={6}
        maxToRenderPerBatch={6}
        windowSize={5}
        updateCellsBatchingPeriod={32}
        contentContainerStyle={[S.content, { gap: 0 }]}
        ListHeaderComponent={
          <View style={{ gap: 16, paddingBottom: 16 }}>
            <PlayerCover
              player={data?.player ?? player}
              ownId={model.active?.puuid}
              catalog={model.catalog}
            />
            {friend && (
              <Text style={[S.small, { color: C.mint }]}>
                {friend.presence === 'in_game'
                  ? [friend.activity ?? 'In game', progressLabel(friend.progress), friend.map]
                      .filter(Boolean)
                      .join(' · ')
                  : (friend.activity ?? friend.presence)}
              </Text>
            )}
            {liveParticipant && (
              <Button
                title="View match skins"
                secondary
                icon="crosshair"
                onPress={() =>
                  onNavigate({
                    type: 'live-loadout',
                    matchId: live!.matchId!,
                    subject: player.subject,
                  })
                }
              />
            )}
            <Text style={S.small}>
              {data?.identitySource === 'friend'
                ? 'Identity from your friend’s reported presence.'
                : 'Card and level last seen in a match.'}
            </Text>
            {error && (
              <Empty title="Some profile data is unavailable" detail={error} icon="alert-circle" />
            )}

            <Resource title="Rank" section={data?.rank}>
              {(rank) => (
                <RankSummary rank={rank} onCareer={() => onNavigate({ type: 'career', rank })} />
              )}
            </Resource>
            <SectionHeader title="Match history" />
            {data?.matches.status === 'ready' ? (
              <Tabs
                value={queue}
                onChange={setQueue}
                items={queues.map((id) => ({ id, label: id === 'all' ? 'All' : queueName(id) }))}
              />
            ) : (
              <Resource title="Match history" section={data?.matches}>
                {() => null}
              </Resource>
            )}
          </View>
        }
        ListEmptyComponent={
          data?.matches.status === 'ready' ? <Empty title="No matches in this view" /> : null
        }
        ListFooterComponent={
          !!matches.length && !finished && matches.length < 1000 && !model.active?.demo ? (
            <Button
              title={loading ? 'Loading…' : 'Load older matches'}
              secondary
              disabled={loading}
              onPress={() => void more()}
            />
          ) : null
        }
      />
    </ModalPage>
  );
}

function LivePanel({ model, onBack, onNavigate }: PanelProps) {
  const { C, S, isDark } = useTheme();

  const polling = useLivePolling(model),
    section = model.snapshot?.liveGame;
  const [ranks, setRanks] = useState<Record<string, Ranked>>({});
  const gameData = section?.status === 'ready' ? section.data : undefined;
  const progress = ownLiveProgress(
    gameData,
    model.chat.selfPresence,
    model.chat.status === 'ready',
  );
  const rosterKey = gameData?.players
    ?.filter((p) => !p.hidden)
    .map((p) => p.subject)
    .sort()
    .join(':');
  useEffect(() => {
    let alive = true;
    setRanks({});
    (async () => {
      for (const player of gameData?.players ?? []) {
        if (!alive) return;
        if (player.hidden || player.tier != null) continue;
        try {
          const rank = await model.playerRank(player);
          if (alive) setRanks((previous) => ({ ...previous, [player.subject]: rank }));
        } catch {
          return;
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [gameData?.matchId, rosterKey, model.playerRank]);
  return (
    <ModalPage>
      <ModalHeader title="Live match" closeLabel="Back from live match" onClose={onBack} />
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={polling.busy}
            onRefresh={polling.refresh}
            tintColor={C.accent}
          />
        }
        contentContainerStyle={S.content}
      >
        {false && (
          <Button
            title={polling.busy ? 'Checking…' : 'Refresh live game'}
            icon="refresh-cw"
            secondary
            disabled={polling.busy}
            onPress={polling.refresh}
          />
        )}
        <Resource title="Live game" section={section}>
          {(game) => (
            <>
              {game.mapImage && (
                <Image
                  source={{ uri: game.mapImage }}
                  style={{ width: '100%', height: 128, borderRadius: 18 }}
                  resizeMode="cover"
                />
              )}
              <View style={S.card}>
                <Badge
                  text={
                    game.state === 'in_game'
                      ? 'IN PROGRESS'
                      : game.state === 'agent_select'
                        ? 'AGENT SELECT'
                        : 'NO MATCH'
                  }
                  color={game.state === 'idle' ? C.subtle : C.mint}
                />
                <Text style={S.h2}>{game.map ?? 'Map not returned'}</Text>
                {game.queue && <Text style={S.body}>{queueName(game.queue)}</Text>}
                {progressLabel(progress) && (
                  <Text style={[S.h2, { color: C.mint }]}>{progressLabel(progress)}</Text>
                )}
                {progress?.roundEstimated && (
                  <Text style={S.small}>Round estimate from the last reported score.</Text>
                )}
                <Text style={S.small}>
                  Checked {game.observedAt ? time(game.observedAt) : 'on the last refresh'} ·{' '}
                  {model.active?.region.toUpperCase()}
                </Text>
              </View>
              {game.detailError && (
                <Empty
                  title="Match found; details unavailable"
                  detail={`${game.detailError.message} (${game.detailError.code})`}
                  icon="alert-circle"
                />
              )}
              {(game.state === 'idle' || game.state === 'offline') && (
                <Empty
                  title="No current match"
                  detail="Start a game in VALORANT. This screen checks again automatically while open."
                  icon="moon"
                />
              )}
              {game.players?.length ? (
                <View style={S.between}>
                  <Text style={S.small}>{game.players.length} players returned.</Text>
                  <Button
                    title="Match skins"
                    icon="crosshair"
                    secondary
                    onPress={() =>
                      game.matchId && onNavigate({ type: 'live-loadout', matchId: game.matchId })
                    }
                  />
                </View>
              ) : null}
              {[...new Set(game.players?.map((p) => p.teamId))].map((team) => (
                <View key={team} style={{ gap: 10 }}>
                  <SectionHeader title={team ? `${team} team` : 'Players'} />
                  {game.players
                    ?.filter((p) => p.teamId === team)
                    .map((p) => (
                      <Pressable
                        key={p.subject}
                        onPress={() => onNavigate({ type: 'player', player: p })}
                        disabled={!!p.hidden}
                        accessibilityRole="button"
                        accessibilityLabel={`View ${playerLabel(p, model.active?.puuid)} profile`}
                        style={[S.card, S.row, { padding: 12, gap: 10 }]}
                      >
                        {p.agentImage ? (
                          <Image source={{ uri: p.agentImage }} style={{ width: 34, height: 34 }} />
                        ) : (
                          <Feather name="crosshair" size={30} color={C.subtle} />
                        )}
                        <View style={{ flex: 1, gap: 4 }}>
                          <Text style={[S.h3, p.self && { color: C.gold }]}>
                            {playerLabel(p, model.active?.puuid)}
                            {p.subject !== model.active?.puuid && p.tag ? ` #${p.tag}` : ''}
                          </Text>
                          <Text style={S.small}>
                            {p.agent ?? 'Choosing agent'}
                            {p.selection ? ` · ${p.selection}` : ''}
                          </Text>
                          <Text style={S.small}>
                            {p.hideLevel
                              ? 'Level hidden'
                              : p.level != null
                                ? `Level ${p.level}`
                                : ''}
                          </Text>
                          {!p.hidden && (
                            <Text style={S.small}>
                              {p.tierName ?? ranks[p.subject]?.name ?? 'Rank not returned'}
                              {ranks[p.subject]?.rr != null ? ` · ${ranks[p.subject]!.rr} RR` : ''}
                              {ranks[p.subject] && !ranks[p.subject]!.currentSeason
                                ? ' · last reported'
                                : ''}
                            </Text>
                          )}
                        </View>
                        {(p.tierImage ?? ranks[p.subject]?.image) && (
                          <Image
                            source={{ uri: p.tierImage ?? ranks[p.subject]?.image }}
                            style={{ width: 32, height: 32 }}
                            resizeMode="contain"
                          />
                        )}
                        <Feather
                          name={p.hidden ? 'lock' : 'chevron-right'}
                          size={18}
                          color={C.subtle}
                        />
                      </Pressable>
                    ))}
                </View>
              ))}
            </>
          )}
        </Resource>
      </ScrollView>
    </ModalPage>
  );
}

function IdentityPanel({
  model,
  onBack,
  initialTab = 'card',
}: PanelProps & { initialTab?: 'card' | 'title' }) {
  const { C, S, isDark } = useTheme();

  const [base, setBase] = useState<Loadout | null>(null),
    [tab, setTab] = useState<'card' | 'title'>(initialTab);
  const [cardId, setCardId] = useState<string | undefined>(),
    [titleId, setTitleId] = useState<string | undefined>();
  const [query, setQuery] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState<string | null>(null);
  const alive = useRef(true);
  const applyBase = (data: Loadout) => {
    setBase(data);
    setCardId(data.card?.id);
    setTitleId(data.title?.id);
  };
  useEffect(() => {
    alive.current = true;
    model
      .freshLoadout()
      .then((data) => {
        if (alive.current) applyBase(data);
      })
      .catch((e) => {
        if (alive.current) setMessage(safeError(e).message);
      });
    return () => {
      alive.current = false;
    };
  }, [model.freshLoadout]);
  const owned = model.snapshot?.collection.status === 'ready' ? model.snapshot.collection.data : [];
  const items = useMemo(
    () => [
      ...new Map(
        [...owned, ...(base?.card ? [base.card] : []), ...(base?.title ? [base.title] : [])]
          .filter((i) => i.kind === tab && i.name.toLowerCase().includes(query.toLowerCase()))
          .map((i) => [i.id, model.catalog.items[i.id] ?? i]),
      ).values(),
    ],
    [owned, base, tab, query, model.catalog],
  );
  const card = cardId ? (model.catalog.items[cardId] ?? base?.card) : base?.card;
  const title = titleId ? (model.catalog.items[titleId] ?? base?.title) : base?.title;
  const changed = !!base && (cardId !== base.card?.id || titleId !== base.title?.id);
  const save = async () => {
    if (!base || !changed || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const data = await model.saveIdentity({
        cardId: cardId !== base.card?.id ? cardId : undefined,
        titleId: titleId !== base.title?.id ? titleId : undefined,
        expectedVersion: base.version,
        expectedCardId: base.card?.id,
        expectedTitleId: base.title?.id,
      });
      if (alive.current) {
        applyBase(data);
        setMessage(
          model.active?.demo
            ? 'Demo selection applied. No Riot account was changed.'
            : 'Riot confirmed your new player card and title.',
        );
      }
    } catch (e) {
      if (alive.current) setMessage(safeError(e).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const reload = async () => {
    setBusy(true);
    try {
      const data = await model.freshLoadout();
      if (alive.current) {
        applyBase(data);
        setMessage(null);
      }
    } catch (e) {
      if (alive.current) setMessage(safeError(e).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  return (
    <ModalPage>
      <ModalHeader
        title="Player card & title"
        closeLabel="Back from identity editor"
        onClose={() => {
          if (!busy) onBack();
        }}
      />
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={S.content}
        initialNumToRender={10}
        ListHeaderComponent={
          <View style={{ gap: 16 }}>
            <PlayerCover
              player={{
                subject: model.active!.puuid,
                name: model.active!.gameName,
                tag: model.active!.tagLine,
                card,
                title,
                level:
                  model.snapshot?.xp.status === 'ready' ? model.snapshot.xp.data.level : undefined,
              }}
              catalog={model.catalog}
            />
            <Text style={S.body}>
              Choose an owned card or title. Apply updates your VALORANT loadout.
            </Text>
            {card?.wallpaper && (
              <View style={S.card}>
                <Text style={S.small}>FULL PLAYER CARD ARTWORK</Text>
                <Image
                  source={{ uri: card.wallpaper }}
                  style={{ width: '100%', height: 180 }}
                  resizeMode="contain"
                />
              </View>
            )}
            {message && (
              <Text accessibilityRole="alert" style={[S.body, { color: C.gold }]}>
                {message}
              </Text>
            )}
            <Button
              title={busy ? 'Saving…' : model.active?.demo ? 'Apply to demo' : 'Apply to VALORANT'}
              disabled={!changed || busy}
              onPress={() => void save()}
              icon="check"
            />
            <Button
              title="Reload equipped identity"
              secondary
              disabled={busy}
              onPress={() => void reload()}
              icon="refresh-cw"
            />
            <Tabs
              value={tab}
              onChange={setTab}
              items={[
                { id: 'card', label: 'Owned player cards' },
                { id: 'title', label: 'Owned titles' },
              ]}
            />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search your collection"
              placeholderTextColor={C.subtle}
              style={S.input}
              accessibilityLabel="Search owned identity items"
            />
          </View>
        }
        ListEmptyComponent={
          <Empty
            title={
              base
                ? 'No matching owned items'
                : message
                  ? 'Equipped identity unavailable'
                  : 'Loading equipped identity'
            }
            detail={
              model.snapshot?.collection.status === 'error'
                ? model.snapshot.collection.message
                : undefined
            }
            icon="image"
          />
        }
        renderItem={({ item }) => {
          const selected = (tab === 'card' ? cardId : titleId) === item.id;
          return (
            <Pressable
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={`Select ${item.name}`}
              accessibilityState={{ selected }}
              onPress={() => (tab === 'card' ? setCardId(item.id) : setTitleId(item.id))}
              style={[S.card, { borderColor: selected ? C.accent : C.border, marginTop: 10 }]}
            >
              {tab === 'card' && (item.wideArt || item.wallpaper) ? (
                <Image
                  source={{ uri: item.wideArt ?? item.wallpaper }}
                  style={{ width: '100%', height: 92, borderRadius: 12 }}
                  resizeMode="cover"
                />
              ) : null}
              <View style={S.between}>
                <Text style={[S.h3, { flex: 1 }]}>{item.name}</Text>
                <Feather
                  name={selected ? 'check-circle' : 'circle'}
                  size={20}
                  color={selected ? C.accent : C.subtle}
                />
              </View>
            </Pressable>
          );
        }}
      />
    </ModalPage>
  );
}
function FriendsPanel({ model, onNavigate, onBack }: PanelProps) {
  const { C, S } = useTheme();
  const [filter, setFilter] = useState<'all' | 'online' | 'saved'>('online'),
    [search, setSearch] = useState('');
  const { chat } = model,
    connected = chat.status === 'ready',
    busy = chat.status === 'connecting' || chat.status === 'authenticating';
  const saved = model.savedConversations.filter((c) => c.count > 0);
  const rows =
    filter === 'saved'
      ? saved.map((c) => ({
          subject: c.subject,
          friend: chat.friends.find((f) => f.subject === c.subject) ?? c.friend,
          count: c.count,
          unread: c.unread,
        }))
      : chat.friends
          .filter((f) => filter === 'all' || f.presence !== 'offline')
          .map((f) => ({
            subject: f.subject,
            friend: f,
            count: 0,
            unread: chat.unread[f.subject] ?? 0,
          }));
  const friends = rows.filter((row) =>
    `${row.friend?.name ?? 'Saved conversation'}#${row.friend?.tag ?? ''}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <ModalPage>
      <ModalHeader title="Chats" closeLabel="Back from friends" onClose={onBack} />
      <FlatList
        data={friends}
        keyExtractor={(row) => row.subject}
        contentContainerStyle={S.content}
        ListHeaderComponent={
          <View style={{ gap: 14, paddingBottom: 8 }}>
            <View style={S.card}>
              <View style={[S.between, { flexWrap: 'wrap', rowGap: 8 }]}>
                <Text style={[S.h2, { flexShrink: 1 }]}>Your Riot friends</Text>
                <Badge
                  text={connected ? 'CONNECTED' : busy ? 'CONNECTING' : 'OFFLINE'}
                  color={connected ? C.mint : C.gold}
                />
              </View>
              <Text style={S.body}>
                Messages are saved on this device, separately for each account. Connect to see live
                presence, send whispers or sync Riot history.
              </Text>
              {chat.error && <Text style={[S.body, { color: C.gold }]}>{chat.error}</Text>}
              <Button
                title={busy ? 'Connecting…' : connected ? 'Disconnect chat' : 'Connect Riot chat'}
                disabled={busy}
                icon={connected ? 'wifi-off' : 'message-circle'}
                onPress={() => (connected ? model.disconnectChat() : void model.connectChat())}
              />
            </View>
            {chat.storageError && (
              <Text accessibilityRole="alert" style={[S.body, { color: C.accent }]}>
                {chat.storageError}
              </Text>
            )}
            {model.active?.demo && (
              <Text style={S.small}>
                Demo conversations are simulated. No messages are sent to Riot.
              </Text>
            )}
            <Tabs
              value={filter}
              onChange={setFilter}
              items={[
                {
                  id: 'online',
                  label: `Online · ${chat.friends.filter((f) => f.presence !== 'offline').length}`,
                },
                { id: 'all', label: `All friends · ${chat.friends.length}` },
                { id: 'saved', label: `Saved · ${saved.length}` },
              ]}
            />
            <TextInput
              value={search}
              onChangeText={setSearch}
              accessibilityLabel="Search friends"
              placeholder="Search Riot ID"
              placeholderTextColor={C.subtle}
              autoCorrect={false}
              style={S.input}
            />
          </View>
        }
        renderItem={({ item: row }) => (
          <View style={[S.card, { marginBottom: 12 }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`View ${row.friend?.name ?? 'saved friend'} profile`}
              disabled={!connected || !chat.friends.some((f) => f.subject === row.subject)}
              onPress={() => row.friend && onNavigate({ type: 'player', player: row.friend })}
              style={S.between}
            >
              <PlayerAvatar card={row.friend?.card} catalog={model.catalog} size={44} />
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={S.h3}>
                  {row.friend?.name ?? 'Saved conversation'}
                  <Text style={{ color: C.subtle }}>
                    {row.friend?.tag ? ` #${row.friend.tag}` : ''}
                  </Text>
                </Text>
                <Text
                  style={[
                    S.small,
                    { color: connected && row.friend?.presence !== 'offline' ? C.mint : C.subtle },
                  ]}
                >
                  {connected && row.friend ? statusName[row.friend.presence] : 'Offline'}
                  {row.friend?.map ? ` · ${row.friend.map}` : ''}
                  {row.count ? ` · ${row.count} saved messages` : ''}
                </Text>
              </View>
              <Feather name="chevron-right" size={20} color={C.subtle} />
            </Pressable>
            <Button
              title={`Message${row.unread ? ` · ${row.unread} unread` : ''}`}
              secondary
              icon="message-circle"
              onPress={() => onNavigate({ type: 'chat', subject: row.subject })}
            />
          </View>
        )}
        ListEmptyComponent={
          <Empty
            title={
              filter === 'saved'
                ? model.historyLoading
                  ? 'Opening saved history…'
                  : 'No saved conversations yet'
                : connected
                  ? 'No friends in this view'
                  : busy
                    ? 'Connecting to Riot…'
                    : 'Connect to load friends'
            }
            detail={
              filter === 'saved'
                ? 'Messages you send, receive or sync are kept until you delete them or remove this account.'
                : connected
                  ? 'Try All friends or a different search.'
                  : 'Saved conversations remain available without connecting.'
            }
            icon="users"
          />
        }
      />
    </ModalPage>
  );
}
export function ExplorerModal({
  model,
  routes,
  onNavigate,
  onBack,
}: {
  model: AppModel;
  routes: ExplorerRoute[];
  onNavigate: Navigate;
  onBack(): void;
}) {
  const route = routes.at(-1),
    props = { model, onNavigate, onBack };
  return (
    <Modal visible={!!route} animationType="slide" onRequestClose={onBack}>
      {route?.type === 'bundle' && <BundlePanel {...props} id={route.id} />}
      {route?.type === 'item' && (
        <ItemModal key={route.item.id} model={model} item={route.item} onClose={onBack} embedded />
      )}
      {route?.type === 'player' && (
        <PlayerPanel key={`player:${route.player.subject}`} {...props} player={route.player} />
      )}
      {route?.type === 'match' && (
        <MatchReport
          key={`match:${route.subject}:${route.id}`}
          id={route.id}
          subject={route.subject}
          model={model}
          onNavigate={onNavigate}
          onClose={onBack}
          embedded
        />
      )}
      {route?.type === 'career' && (
        <CareerModal rank={route.rank} visible onClose={onBack} embedded />
      )}
      {route?.type === 'live' && <LivePanel {...props} />}
      {route?.type === 'live-loadout' && (
        <LiveEquipmentPanel
          key={`${route.matchId}:${route.subject}`}
          model={model}
          matchId={route.matchId}
          subject={route.subject}
          onBack={onBack}
        />
      )}
      {route?.type === 'presets' && <PresetsPanel model={model} onBack={onBack} />}
      {route?.type === 'identity' && (
        <IdentityPanel key={route.initialTab} {...props} initialTab={route.initialTab} />
      )}
      {route?.type === 'collection' && (
        <CollectionBrowser
          key={`${route.kind}:${route.scope}`}
          {...props}
          initialKind={route.kind}
          initialScope={route.scope}
        />
      )}
      {route?.type === 'equipped' && <EquippedPanel {...props} />}
      {route?.type === 'round' && (
        <RoundPanel
          key={`${route.detail.id}:${route.round}:${route.eventId}`}
          detail={route.detail}
          initialRound={route.round}
          eventId={route.eventId}
          ownId={model.active?.puuid}
          onBack={onBack}
          onNavigate={onNavigate}
        />
      )}
      {route?.type === 'friends' && <FriendsPanel {...props} />}
      {route?.type === 'chat-settings' && (
        <ModalPage>
          <ModalHeader
            title="Chat settings"
            closeLabel="Back from chat settings"
            onClose={onBack}
          />
          <ScrollView contentContainerStyle={{ padding: 16 }}>
            <ChatSettings model={model} subject={route.subject} />
          </ScrollView>
        </ModalPage>
      )}
      {route?.type === 'chat' && (
        <ChatPanel key={`chat:${route.subject}`} {...props} subject={route.subject} />
      )}
    </Modal>
  );
}
