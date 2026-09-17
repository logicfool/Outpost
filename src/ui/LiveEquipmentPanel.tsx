import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import type { AppModel } from '../state/useApp';
import type { Section } from '../core/types';
import type { LiveEquipment } from '../core/matchTypes';
import { safeError } from '../core/validation';
import { keepCached } from '../core/refreshPolicy';
import { Bone, Skeleton, SkeletonGroup } from './Skeleton';
import { playerLabel } from '../core/playerNames';
import { hydrateItem } from '../core/catalog';
import { ItemArt, ModalHeader, ModalPage, Resource, Tabs } from './components';
import { AgentPortrait } from './MatchVisuals';
import { useTheme } from './theme';

export function LiveEquipmentPanel({
  model,
  matchId,
  subject,
  onBack,
}: {
  model: AppModel;
  matchId: string;
  subject?: string;
  onBack(): void;
}) {
  const { C, S } = useTheme(),
    [data, setData] = useState<Section<LiveEquipment>>(),
    [busy, setBusy] = useState(true),
    [revision, setRevision] = useState(0),
    [selected, setSelected] = useState(subject ?? model.active?.puuid);
  const game =
    model.snapshot?.liveGame.status === 'ready' ? model.snapshot.liveGame.data : undefined;
  const players = useMemo(
    () => (game?.matchId === matchId ? (game.players ?? []).filter((p) => !p.hidden) : []),
    [game, matchId],
  );
  useEffect(() => {
    let alive = true;
    setBusy(true);
    model
      .liveEquipment(matchId)
      .then((result) => {
        if (alive)
          setData((old) =>
            old?.status === 'ready' && old.data.matchId === matchId
              ? keepCached(old, result)
              : result,
          );
      })
      .catch((e) => {
        const error = safeError(e);
        if (alive)
          setData((old) =>
            keepCached(old, {
              status: 'error',
              code: error.code,
              message: error.message,
              retryAt: error.retryAt,
            }),
          );
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [matchId, model.liveEquipment, revision]);
  const player = players.find((p) => p.subject === selected) ?? players[0],
    equipment =
      data?.status === 'ready' && data.data.matchId === matchId && player
        ? data.data.players.find((p) => p.subject === player.subject)
        : undefined;
  return (
    <ModalPage>
      <ModalHeader title="Match skins" closeLabel="Back from match skins" onClose={onBack} />
      <FlatList
        data={equipment?.weapons ?? []}
        keyExtractor={(w) => w.weaponId}
        initialNumToRender={7}
        windowSize={5}
        contentContainerStyle={S.content}
        refreshControl={
          <RefreshControl
            refreshing={busy}
            onRefresh={() => setRevision((v) => v + 1)}
            tintColor={C.accent}
          />
        }
        ListHeaderComponent={
          <View style={{ gap: 12 }}>
            <Text style={S.small}>Equipped cosmetics, not the weapon currently held.</Text>
            {!!players.length && (
              <Tabs
                value={player?.subject ?? ''}
                onChange={setSelected}
                items={players.map((p) => ({
                  id: p.subject,
                  label: playerLabel(p, model.active?.puuid),
                }))}
              />
            )}
            {player && (
              <View style={[S.row, { paddingVertical: 6 }]}>
                <AgentPortrait player={player} size={32} color={C.mint} />
                <View style={{ flex: 1 }}>
                  <Text style={S.h3}>{playerLabel(player, model.active?.puuid)}</Text>
                  <Text style={S.small}>{player.agent}</Text>
                </View>
                {!data ? (
                  <SkeletonGroup label="Loading weapon slots">
                    <Bone width={36} height={12} />
                  </SkeletonGroup>
                ) : (
                  <Text style={S.small}>
                    {equipment ? `${equipment.weapons.length} slots` : ''}
                  </Text>
                )}
              </View>
            )}
            {(data?.status === 'error' || (data?.status === 'ready' && data.warning)) && (
              <Resource title="Match skins" section={data}>
                {() => null}
              </Resource>
            )}
            {data?.status === 'ready' && (
              <Text style={S.small}>
                Checked{' '}
                {new Date(data.data.observedAt).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                . One shared check per minute.
              </Text>
            )}
          </View>
        }
        renderItem={({ item }) => (
          <View style={[S.card, S.row, { padding: 12, gap: 10 }]}>
            {item.skin && (
              <ItemArt
                item={hydrateItem(model.catalog, item.skin)}
                size={65}
                style={{ width: 114 }}
              />
            )}
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={S.small}>{item.weapon}</Text>
              <Text style={S.h3}>{item.skin?.name ?? 'Skin not returned'}</Text>
              {item.buddy && <Text style={S.small}>{item.buddy.name}</Text>}
            </View>
          </View>
        )}
        ListEmptyComponent={
          !busy && data?.status === 'ready' ? (
            <Text style={[S.body, { textAlign: 'center', paddingVertical: 20 }]}>
              {players.length
                ? 'Riot did not expose skins for this player.'
                : 'This live roster is no longer available.'}
            </Text>
          ) : !data ? (
            <Skeleton kind="loadout" count={4} label="Loading match skins" />
          ) : null
        }
      />
    </ModalPage>
  );
}
