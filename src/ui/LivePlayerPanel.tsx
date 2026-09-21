import { liveLoadoutRows, liveLoadoutCategories } from '../core/liveLoadoutView';
import React, { useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { AppModel } from '../state/useApp';
import type { Navigate } from './explorerTypes';
import type { LiveViewState } from '../core/livePresentation';
import { liveRank } from '../core/livePresentation';
import { hydrateItem } from '../core/catalog';
import { playerLabel } from '../core/playerNames';
import { useLiveRanks, useLiveLoadout } from '../state/useLiveMatchData';
import { useLivePolling } from '../state/useLivePolling';
import { Button, Empty, ModalHeader, ModalPage, Resource, Tabs } from './components';
import { Skeleton, SkeletonGroup, Bone } from './Skeleton';
import { Image } from './CachedImage';
import { FriendActions } from './FriendActions';
import { LiveWeaponRow } from './LiveWeaponRow';
import { useTheme } from './theme';

export function LivePlayerPanel({
  model,
  matchId,
  subject,
  view,
  onBack,
  onNavigate,
  allowSwitch = false,
}: {
  model: AppModel;
  matchId: string;
  subject?: string;
  view: LiveViewState;
  onBack(): void;
  onNavigate: Navigate;
  allowSwitch?: boolean;
}) {
  const { C, S } = useTheme(),
    [selected, setSelected] = useState(
      subject ?? (allowSwitch ? view.loadoutSubject : undefined) ?? model.active?.puuid,
    ),
    polling = useLivePolling(model);
  const game =
    model.snapshot?.liveGame.status === 'ready' ? model.snapshot.liveGame.data : undefined;
  const valid =
      view.accountId === model.active?.puuid &&
      view.matchId === matchId &&
      game?.matchId === matchId &&
      ['in_game', 'agent_select'].includes(game.state),
    players = valid ? (game.players ?? []).filter((p) => !p.hidden) : [];
  const player = players.find((p) => p.subject === selected),
    rankState = useLiveRanks(model, player ? [player] : [], view, true),
    loadout = useLiveLoadout(model, matchId, view, !!player);
  const rank = player ? rankState.ranks[player.subject] : undefined,
    current = player ? liveRank(player, rank, model.catalog) : undefined;
  const card = player?.card ? hydrateItem(model.catalog, player.card) : undefined,
    cover = card?.wideArt ?? card?.wallpaper ?? card?.image;
  const equipment =
    player && loadout.data?.status === 'ready'
      ? loadout.data.data.players.find((p) => p.subject === player.subject)
      : undefined;
  const [category, setCategory] = useState('All'),
    [query, setQuery] = useState('');
  const categories = liveLoadoutCategories(equipment?.weapons ?? [], model.catalog),
    activeCategory = categories.includes(category) ? category : 'All';
  const visibleWeapons = liveLoadoutRows(
    equipment?.weapons ?? [],
    model.catalog,
    activeCategory,
    query,
  );
  const label = player ? playerLabel(player, model.active?.puuid) : 'Player details';
  const refresh = () => {
    polling.refresh();
    rankState.refresh();
    loadout.refresh();
  };
  return (
    <ModalPage>
      <ModalHeader
        title={allowSwitch ? 'Match skins' : label}
        closeLabel={allowSwitch ? 'Back from match skins' : 'Back from player profile'}
        onClose={onBack}
      />
      <FlatList
        data={visibleWeapons}
        keyExtractor={(w) => w.weaponId}
        initialNumToRender={7}
        maxToRenderPerBatch={6}
        windowSize={5}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[S.content, { gap: 0 }]}
        refreshControl={
          <RefreshControl
            refreshing={polling.refreshing}
            onRefresh={refresh}
            tintColor={C.accent}
          />
        }
        ListHeaderComponent={
          <View style={{ gap: 13, paddingBottom: 10 }}>
            {allowSwitch && players.length > 0 && (
              <Tabs
                value={selected ?? ''}
                onChange={(id) => {
                  view.loadoutSubject = id;
                  setSelected(id);
                  setCategory('All');
                  setQuery('');
                }}
                items={players.map((p) => ({
                  id: p.subject,
                  label: playerLabel(p, model.active?.puuid),
                }))}
              />
            )}
            {!valid ? (
              <Empty
                title="This match is no longer current"
                detail="Return to Live match to see the current roster."
                icon="clock"
              />
            ) : !player ? (
              <Empty
                title="Player unavailable"
                detail="This player is no longer visible in the current roster."
                icon="lock"
              />
            ) : (
              <>
                <View
                  testID="live-player-cover"
                  style={{
                    width: '100%',
                    aspectRatio: 3.05,
                    borderRadius: 17,
                    backgroundColor: C.raised,
                    overflow: 'hidden',
                  }}
                >
                  {cover ? (
                    <Image
                      source={{ uri: cover }}
                      contentFit="cover"
                      style={{ width: '100%', height: '100%' }}
                    />
                  ) : (
                    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                      <Feather name="image" color={C.subtle} size={26} />
                    </View>
                  )}
                </View>
                <View style={{ flexDirection: 'row', gap: 11, alignItems: 'center' }}>
                  {player.agentImage && (
                    <Image
                      source={{ uri: player.agentImage }}
                      contentFit="contain"
                      style={{ width: 39, height: 44 }}
                    />
                  )}
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={S.h2}>
                      {label}
                      {player.tag && player.subject !== model.active?.puuid ? (
                        <Text style={{ color: C.subtle, fontWeight: '400' }}> #{player.tag}</Text>
                      ) : null}
                    </Text>
                    <Text style={S.small}>
                      {[
                        player.agent,
                        player.level != null && !player.hideLevel
                          ? `Level ${player.level}`
                          : undefined,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="View full player profile"
                    onPress={() => onNavigate({ type: 'player', player })}
                    style={{
                      width: 40,
                      height: 44,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Feather name="external-link" color={C.muted} size={18} />
                  </Pressable>
                </View>
                <View
                  style={{ backgroundColor: C.surface, borderRadius: 16, padding: 14, gap: 12 }}
                >
                  <View style={{ flexDirection: 'row', gap: 14 }}>
                    {[
                      {
                        label: current!.label,
                        name: current!.name,
                        image: current!.image,
                        detail: current!.rr != null ? `${current!.rr} RR` : '',
                      },
                      {
                        label: 'Peak',
                        name: rank?.peak?.name ?? 'Not reported',
                        image: rank?.peak?.image,
                        detail: rank?.peak?.seasonName ?? '',
                      },
                    ].map((r, index) => (
                      <View
                        key={index}
                        style={{
                          flex: 1,
                          alignItems: 'center',
                          gap: 5,
                          borderLeftWidth: index ? 0.5 : 0,
                          borderLeftColor: C.border,
                        }}
                      >
                        <Text style={[S.small, { fontSize: 11 }]}>{r.label}</Text>
                        {r.image ? (
                          <Image
                            source={{ uri: r.image }}
                            contentFit="contain"
                            style={{ width: 39, height: 40 }}
                          />
                        ) : rankState.loading ? (
                          <SkeletonGroup label="Loading player rank">
                            <Bone width={36} height={40} />
                          </SkeletonGroup>
                        ) : (
                          <Feather name="award" size={30} color={C.subtle} />
                        )}
                        <Text
                          testID={index === 0 ? 'live-player-rank' : undefined}
                          style={[S.h3, { fontSize: 13, textAlign: 'center' }]}
                        >
                          {rankState.loading && r.name === 'Not reported' ? 'Loading...' : r.name}
                        </Text>
                        {!!r.detail && (
                          <Text style={[S.small, { fontSize: 10, textAlign: 'center' }]}>
                            {r.detail}
                          </Text>
                        )}
                      </View>
                    ))}
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="View rank history"
                    disabled={!rank}
                    onPress={() => rank && onNavigate({ type: 'career', rank })}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      minHeight: 32,
                      borderTopWidth: 0.5,
                      borderTopColor: C.border,
                      paddingTop: 9,
                    }}
                  >
                    <Text style={[S.small, { color: rank ? C.ink : C.subtle }]}>Rank history</Text>
                    <Feather name="chevron-right" size={15} color={C.subtle} />
                  </Pressable>
                </View>
                <FriendActions model={model} player={player} />
                <View style={S.between}>
                  <Text style={S.h2}>Loadout</Text>
                  <Text style={S.small}>
                    {equipment ? `${equipment.weapons.length} slots` : ''}
                  </Text>
                </View>
                <Text style={[S.small, { fontSize: 11 }]}>
                  Equipped skins and buddies for this match.
                </Text>
                {!!equipment?.weapons.length && (
                  <>
                    <View
                      style={{
                        flexDirection: 'row',
                        gap: 8,
                        alignItems: 'center',
                        backgroundColor: C.surface,
                        paddingHorizontal: 11,
                        borderRadius: 11,
                      }}
                    >
                      <Feather name="search" color={C.subtle} size={15} />
                      <TextInput
                        accessibilityLabel="Search match loadout"
                        value={query}
                        onChangeText={setQuery}
                        placeholder="Find a weapon, skin or buddy"
                        placeholderTextColor={C.subtle}
                        style={[S.body, { flex: 1, minWidth: 0, minHeight: 42 }]}
                        autoCorrect={false}
                      />
                    </View>
                    <Tabs
                      value={activeCategory}
                      onChange={setCategory}
                      items={categories.map((id) => ({ id, label: id }))}
                    />
                  </>
                )}
                {(loadout.data?.status === 'error' ||
                  (loadout.data?.status === 'ready' && loadout.data.warning)) && (
                  <Resource title="Match loadout" section={loadout.data}>
                    {() => null}
                  </Resource>
                )}
              </>
            )}
          </View>
        }
        renderItem={({ item, index }) => (
          <View
            style={{
              backgroundColor: C.surface,
              borderTopLeftRadius: index === 0 ? 16 : 0,
              borderTopRightRadius: index === 0 ? 16 : 0,
              borderBottomLeftRadius: index === visibleWeapons.length - 1 ? 16 : 0,
              borderBottomRightRadius: index === visibleWeapons.length - 1 ? 16 : 0,
              overflow: 'hidden',
            }}
          >
            <LiveWeaponRow
              weapon={item}
              catalog={model.catalog}
              last={index === visibleWeapons.length - 1}
              onItem={(item) => onNavigate({ type: 'item', item })}
            />
          </View>
        )}
        ListEmptyComponent={
          valid && player ? (
            loadout.busy || !loadout.data ? (
              <Skeleton kind="loadout" count={4} label="Loading match skins" />
            ) : loadout.data.status === 'ready' ? (
              <Empty
                title={equipment?.weapons.length ? 'No matching equipment' : 'Loadout not reported'}
                detail={
                  equipment?.weapons.length
                    ? 'Try another category or search.'
                    : 'Riot did not return equipped cosmetics for this player.'
                }
                icon="crosshair"
              />
            ) : null
          ) : null
        }
      />
    </ModalPage>
  );
}
