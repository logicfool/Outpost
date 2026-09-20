import { FriendActions } from './FriendActions';
import { FriendRequestsPanel } from './FriendRequestsPanel';
import { ChatsPanel } from './ChatsPanel';
import { BrowseMemory } from '../core/browseMemory';
import { ChatDirectoryMemory } from '../core/chatDirectory';
import { MarketHistoryPanel } from './MarketHistoryPanel';
import { LiveMatchPanel } from './LiveMatchPanel';
import { AimPanel } from './AimPanel';
import { IdentityPanel } from './IdentityPanel';
import { Bone, Skeleton, SkeletonGroup } from './Skeleton';
import { BuddiesPanel } from './BuddiesPanel';
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
    [checking, setChecking] = useState(true),
    [finished, setFinished] = useState(false);
  const previews = useMatchPreviews(model, player.subject),
    details = previews.details;
  const generation = useRef(0);
  useEffect(() => {
    const stamp = ++generation.current;
    setChecking(true);
    setError(null);
    setFinished(false);
    setLoading(false);
    let freshArrived = false;
    void model
      .cachedPlayerProfile(player)
      .then((value) => {
        if (value && generation.current === stamp && !freshArrived) setData(value);
      })
      .catch(() => {});
    model
      .playerProfile(player)
      .then((value) => {
        freshArrived = true;
        if (generation.current === stamp) setData(value);
      })
      .catch((e) => {
        if (generation.current === stamp) setError(safeError(e).message);
      })
      .finally(() => {
        if (generation.current === stamp) setChecking(false);
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
        <HistoryRow match={item} detail={details[item.id]} issue={previews.issue} onOpen={open} />
      </View>
    ),
    [details, previews.issue, open],
  );
  return (
    <ModalPage>
      <ModalHeader title="Player profile" closeLabel="Back from player profile" onClose={onBack} />
      <FlatList
        refreshControl={
          <RefreshControl
            refreshing={checking && !!data}
            onRefresh={() => {
              if (!checking) setVersion((v) => v + 1);
            }}
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
            <>
              {!data && !player.card && checking ? (
                <Skeleton kind="profile" label="Loading player profile" />
              ) : (
                <PlayerCover
                  player={data?.player ?? player}
                  ownId={model.active?.puuid}
                  catalog={model.catalog}
                />
              )}
            </>
            <FriendActions model={model} player={data?.player ?? player} />
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

            <Resource
              title="Rank"
              section={
                checking && data?.rank.status === 'error' && data.rank.code === 'RANK_NOT_CACHED'
                  ? undefined
                  : (data?.rank ??
                    (error
                      ? { status: 'error', code: 'PROFILE_UNAVAILABLE', message: error }
                      : undefined))
              }
            >
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
              <Resource
                title="Match history"
                section={
                  data?.matches ??
                  (error
                    ? { status: 'error', code: 'PROFILE_UNAVAILABLE', message: error }
                    : undefined)
                }
              >
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
            <View style={{ gap: 12 }}>
              {loading && <Skeleton kind="match" count={2} label="Loading older matches" />}
              <Button
                title="Load older matches"
                secondary
                disabled={loading}
                onPress={() => void more()}
              />
            </View>
          ) : null
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
  const chatViews = useRef(new ChatDirectoryMemory()).current;
  const browseViews = useRef(new BrowseMemory()).current;
  browseViews.syncAccount(model.active?.puuid);
  const collectionView =
    route?.type === 'collection'
      ? browseViews.collection(model.active?.puuid, route, route.kind, route.scope)
      : undefined;
  const marketView =
    route?.type === 'market-history' ? browseViews.markets(model.active?.puuid, route) : undefined;
  const chatView =
    route?.type === 'friends' ? chatViews.forRoute(model.active?.puuid, route) : undefined;
  return (
    <Modal visible={!!route} animationType="slide" onRequestClose={onBack}>
      {route?.type === 'market-history' && (
        <MarketHistoryPanel
          key={`${model.active?.puuid}:${marketView?.navigationId}`}
          {...props}
          view={marketView}
        />
      )}
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
      {route?.type === 'live' && <LiveMatchPanel {...props} />}
      {route?.type === 'live-loadout' && (
        <LiveEquipmentPanel
          key={`${route.matchId}:${route.subject}`}
          model={model}
          matchId={route.matchId}
          subject={route.subject}
          onBack={onBack}
        />
      )}
      {route?.type === 'aim' && (
        <AimPanel key={model.active?.puuid} model={model} initialTab={route.tab} onBack={onBack} />
      )}
      {route?.type === 'buddies' && (
        <BuddiesPanel key={model.active?.puuid} model={model} onBack={onBack} />
      )}
      {route?.type === 'presets' && (
        <PresetsPanel key={model.active?.puuid} model={model} onBack={onBack} />
      )}
      {route?.type === 'identity' && (
        <IdentityPanel
          key={`${model.active?.puuid}:${route.initialTab}`}
          {...props}
          initialTab={route.initialTab}
        />
      )}
      {route?.type === 'collection' && (
        <CollectionBrowser
          key={`${model.active?.puuid}:${collectionView?.navigationId}`}
          {...props}
          initialKind={route.kind}
          initialScope={route.scope}
          view={collectionView}
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
      {route?.type === 'friends' && (
        <ChatsPanel
          key={`chats:${model.active?.puuid}:${routes.length}`}
          {...props}
          view={chatView!}
        />
      )}
      {route?.type === 'friend-requests' && <FriendRequestsPanel model={model} onBack={onBack} />}
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
