import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
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
import { CareerModal, MatchCard, MatchReport } from './screens';
import { PlayerCover } from './profileViews';
import { C, S } from './theme';

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
  const [data, setData] = useState<PlayerProfile | null>(null),
    [error, setError] = useState<string | null>(null),
    [version, setVersion] = useState(0);
  const [queue, setQueue] = useState('all'),
    [loading, setLoading] = useState(false),
    [finished, setFinished] = useState(false);
  const [details, setDetails] = useState<Record<string, MatchDetail>>({});
  const generation = useRef(0);
  useEffect(() => {
    const stamp = ++generation.current;
    setData(null);
    setError(null);
    setDetails({});
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
  const matches = data?.matches.status === 'ready' ? data.matches.data : [];
  useEffect(() => {
    let alive = true;
    (async () => {
      for (const entry of matches.slice(0, 40)) {
        if (!alive) return;
        if (details[entry.id]) continue;
        try {
          const detail = await model.matchDetail(entry.id, player.subject);
          if (alive) setDetails((old) => ({ ...old, [entry.id]: detail }));
        } catch {
          return;
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [data?.matches, player.subject, model.matchDetail]);
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
  const queues = ['all', ...new Set(matches.map((m) => m.queue))];
  return (
    <ModalPage>
      <ModalHeader title="Player profile" closeLabel="Back from player profile" onClose={onBack} />
      <ScrollView contentContainerStyle={S.content}>
        <PlayerCover player={data?.player ?? player} catalog={model.catalog} />
        <Text style={S.small}>
          {data?.identitySource === 'friend'
            ? 'Identity from your friend’s reported presence.'
            : 'Card and level as reported in the selected match. Private fields are not requested.'}
        </Text>
        {error && (
          <Empty title="Some profile data is unavailable" detail={error} icon="alert-circle" />
        )}
        <Button
          title="Refresh profile"
          icon="refresh-cw"
          secondary
          onPress={() => setVersion((v) => v + 1)}
        />
        <Resource title="Rank" section={data?.rank}>
          {(rank) => (
            <RankSummary rank={rank} onCareer={() => onNavigate({ type: 'career', rank })} />
          )}
        </Resource>
        <SectionHeader title="Match history" />
        <Resource title="Match history" section={data?.matches}>
          {() => (
            <>
              <Tabs
                value={queue}
                onChange={setQueue}
                items={queues.map((id) => ({ id, label: id === 'all' ? 'All' : queueName(id) }))}
              />
              {matches
                .filter((m) => queue === 'all' || m.queue === queue)
                .map((match) => (
                  <MatchCard
                    key={match.id}
                    match={match}
                    detail={details[match.id]}
                    onPress={() =>
                      onNavigate({ type: 'match', id: match.id, subject: player.subject })
                    }
                  />
                ))}
              {!matches.length && (
                <Empty
                  title="No matches returned"
                  detail="History may be unavailable for this account or region."
                />
              )}
              {!!matches.length && !finished && matches.length < 1000 && !model.active?.demo && (
                <Button
                  title={loading ? 'Loading…' : 'Load older matches'}
                  secondary
                  disabled={loading}
                  onPress={() => void more()}
                />
              )}
            </>
          )}
        </Resource>
      </ScrollView>
    </ModalPage>
  );
}
function LivePanel({ model, onBack, onNavigate }: PanelProps) {
  const polling = useLivePolling(model),
    section = model.snapshot?.liveGame;
  const [ranks, setRanks] = useState<Record<string, Ranked>>({});
  const gameData = section?.status === 'ready' ? section.data : undefined;
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
      <ScrollView contentContainerStyle={S.content}>
        <Button
          title={polling.busy ? 'Checking…' : 'Refresh live game'}
          icon="refresh-cw"
          secondary
          disabled={polling.busy}
          onPress={polling.refresh}
        />
        <Resource title="Live game" section={section}>
          {(game) => (
            <>
              {game.mapImage && (
                <Image
                  source={{ uri: game.mapImage }}
                  style={{ width: '100%', height: 185, borderRadius: 24 }}
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
                <Text style={S.small}>
                  {game.players.length} players returned. Agent select may expose only your team.
                  Tap a visible player for their profile; hidden identities stay hidden.
                </Text>
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
                        accessibilityLabel={`View ${p.name} profile`}
                        style={[S.card, S.row]}
                      >
                        {p.agentImage ? (
                          <Image source={{ uri: p.agentImage }} style={{ width: 48, height: 48 }} />
                        ) : (
                          <Feather name="crosshair" size={30} color={C.subtle} />
                        )}
                        <View style={{ flex: 1, gap: 4 }}>
                          <Text style={[S.h3, p.self && { color: C.gold }]}>
                            {p.name}
                            {p.tag ? ` #${p.tag}` : ''}
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

function IdentityPanel({ model, onBack }: PanelProps) {
  const [base, setBase] = useState<Loadout | null>(null),
    [tab, setTab] = useState<'card' | 'title'>('card');
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
              Select an owned player card to change both its banner and full artwork. Applying also
              changes your identity in VALORANT. There is no separate profile photo.
            </Text>
            {card?.wallpaper && (
              <View style={S.card}>
                <Text style={S.small}>FULL PLAYER CARD ARTWORK</Text>
                <Image
                  source={{ uri: card.wallpaper }}
                  style={{ width: '100%', height: 260 }}
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
            title={base ? 'No matching owned items' : 'Loading equipped identity'}
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
  const [filter, setFilter] = useState<'all' | 'online'>('online'),
    [search, setSearch] = useState('');
  const { chat } = model,
    connected = chat.status === 'ready',
    busy = chat.status === 'connecting' || chat.status === 'authenticating';
  const friends = chat.friends.filter(
    (f) =>
      (filter === 'all' || f.presence !== 'offline') &&
      `${f.name}#${f.tag}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <ModalPage>
      <ModalHeader title="Friends & chat" closeLabel="Back from friends" onClose={onBack} />
      <FlatList
        data={friends}
        keyExtractor={(f) => f.subject}
        contentContainerStyle={S.content}
        ListHeaderComponent={
          <View style={{ gap: 14, paddingBottom: 8 }}>
            <View style={S.card}>
              <View style={S.between}>
                <Text style={S.h2}>Your Riot friends</Text>
                <Badge
                  text={connected ? 'CONNECTED' : busy ? 'CONNECTING' : 'DISCONNECTED'}
                  color={connected ? C.mint : C.gold}
                />
              </View>
              <Text style={S.body}>
                Connect to see friends’ presence and send direct messages from your phone. Chat
                works while Outpost is open; closing the app does not keep a chat connection alive.
              </Text>
              {chat.error && <Text style={[S.body, { color: C.gold }]}>{chat.error}</Text>}
              <Button
                title={busy ? 'Connecting…' : connected ? 'Disconnect chat' : 'Connect Riot chat'}
                disabled={busy}
                icon={connected ? 'wifi-off' : 'message-circle'}
                onPress={() => (connected ? model.disconnectChat() : void model.connectChat())}
              />
            </View>
            {model.active?.demo && (
              <Text style={S.small}>
                Demo friends and messages are simulated. Nothing is sent to Riot.
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
        renderItem={({ item: friend }) => (
          <View style={[S.card, { marginBottom: 12 }]}>
            {friend.card?.wideArt && (
              <Image
                source={{ uri: friend.card.wideArt }}
                style={{ width: '100%', height: 75, borderRadius: 12, opacity: 0.85 }}
                resizeMode="cover"
              />
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`View ${friend.name} profile`}
              onPress={() => onNavigate({ type: 'player', player: friend })}
              style={S.between}
            >
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={S.h3}>
                  {friend.name}
                  <Text style={{ color: C.subtle }}> #{friend.tag}</Text>
                </Text>
                <Text
                  style={[S.small, { color: friend.presence === 'offline' ? C.subtle : C.mint }]}
                >
                  {statusName[friend.presence]}
                  {friend.map ? ` · ${friend.map}` : ''}
                </Text>
              </View>
              <Feather name="chevron-right" size={20} color={C.subtle} />
            </Pressable>
            <Button
              title={`Message${chat.unread[friend.subject] ? ` · ${chat.unread[friend.subject]} unread` : ''}`}
              secondary
              icon="message-circle"
              onPress={() => onNavigate({ type: 'chat', subject: friend.subject })}
            />
          </View>
        )}
        ListEmptyComponent={
          <Empty
            title={
              connected
                ? 'No friends in this view'
                : busy
                  ? 'Connecting to Riot…'
                  : 'Connect to load friends'
            }
            detail={
              connected
                ? 'Try All friends or a different search.'
                : 'Your friends will appear after Riot chat connects.'
            }
            icon="users"
          />
        }
      />
    </ModalPage>
  );
}
function ChatPanel({ subject, model, onBack, onNavigate }: PanelProps & { subject: string }) {
  const friend = model.chat.friends.find((f) => f.subject === subject),
    messages = model.chat.messages[subject] ?? [];
  const [body, setBody] = useState(''),
    [error, setError] = useState<string | null>(null),
    [sending, setSending] = useState(false);
  const scroll = useRef<ScrollView>(null),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    model.markChatRead(subject);
    return () => {
      mounted.current = false;
      model.markChatRead();
    };
  }, [subject, model.markChatRead]);
  useEffect(() => {
    model.markChatRead(subject);
  }, [messages.length, subject, model.markChatRead]);
  const send = async () => {
    if (sending || !body.trim()) return;
    setSending(true);
    setError(null);
    const sent = body;
    try {
      await model.sendChat(subject, sent);
      if (mounted.current) setBody((previous) => (previous === sent ? '' : previous));
    } catch (e) {
      if (mounted.current) setError(safeError(e).message);
    } finally {
      if (mounted.current) setSending(false);
    }
  };
  return (
    <ModalPage>
      <ModalHeader
        title={friend ? `${friend.name} #${friend.tag}` : 'Conversation'}
        detail={friend ? statusName[friend.presence] : undefined}
        closeLabel="Back from conversation"
        onClose={onBack}
      />
      <KeyboardAvoidingView style={S.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ paddingHorizontal: 18, paddingVertical: 10, gap: 8 }}>
          <Text style={S.small}>
            Messages are kept only in memory. “Sent” means written to the connection, not a delivery
            or read receipt.
          </Text>
          {friend && (
            <Button
              title="View player profile"
              secondary
              onPress={() => onNavigate({ type: 'player', player: friend })}
            />
          )}
          {model.chat.status !== 'ready' && (
            <Button title="Reconnect chat" secondary onPress={() => void model.connectChat()} />
          )}
        </View>
        <ScrollView
          ref={scroll}
          contentContainerStyle={{ padding: 18, gap: 12, flexGrow: 1 }}
          onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
        >
          {!messages.length && (
            <Empty
              title="Start a conversation"
              detail="Only messages received during this app session appear here."
              icon="message-circle"
            />
          )}
          {messages.map((message) => (
            <View
              key={`${message.direction}:${message.id}`}
              style={{
                alignSelf: message.direction === 'outgoing' ? 'flex-end' : 'flex-start',
                maxWidth: '88%',
                backgroundColor: message.direction === 'outgoing' ? `${C.accent}22` : C.surface,
                borderRadius: 18,
                padding: 14,
                gap: 6,
              }}
            >
              <Text selectable style={[S.body, { color: C.ink }]}>
                {message.body}
              </Text>
              <Text style={S.small}>
                {time(message.at)}
                {message.direction === 'outgoing'
                  ? ` · ${message.state === 'sent' ? 'Sent' : message.state === 'failed' ? 'Unconfirmed - not retried' : 'Sending…'}`
                  : ''}
              </Text>
            </View>
          ))}
        </ScrollView>
        {error && <Text style={[S.body, { paddingHorizontal: 18, color: C.gold }]}>{error}</Text>}
        <View
          style={[
            S.row,
            { padding: 14, alignItems: 'flex-end', borderTopWidth: 1, borderTopColor: C.border },
          ]}
        >
          <TextInput
            value={body}
            onChangeText={setBody}
            maxLength={2000}
            multiline
            accessibilityLabel="Message text"
            placeholder="Write a message…"
            placeholderTextColor={C.subtle}
            style={[S.input, { flex: 1, maxHeight: 130 }]}
          />
          <Button
            title={sending ? '…' : 'Send'}
            disabled={sending || !body.trim() || !friend || model.chat.status !== 'ready'}
            onPress={() => void send()}
            icon="send"
          />
        </View>
      </KeyboardAvoidingView>
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
      {route?.type === 'identity' && <IdentityPanel {...props} />}
      {route?.type === 'friends' && <FriendsPanel {...props} />}
      {route?.type === 'chat' && (
        <ChatPanel key={`chat:${route.subject}`} {...props} subject={route.subject} />
      )}
    </Modal>
  );
}
