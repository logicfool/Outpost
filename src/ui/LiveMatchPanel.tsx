import React, { useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import type { AppModel } from '../state/useApp';
import type { Navigate } from './explorerTypes';
import type { Ranked } from '../core/types';
import { ownLiveProgress } from '../core/liveProgress';
import { useLivePolling } from '../state/useLivePolling';
import { LiveMatchHero, LiveRoster } from './LiveMatchView';
import { Button, Empty, ModalHeader, ModalPage, Resource } from './components';
import { useTheme } from './theme';
import { Feather } from '@expo/vector-icons';
export function LiveMatchPanel({
  model,
  onBack,
  onNavigate,
}: {
  model: AppModel;
  onBack(): void;
  onNavigate: Navigate;
}) {
  const { C, S } = useTheme(),
    polling = useLivePolling(model),
    section = model.snapshot?.liveGame;
  const game = section?.status === 'ready' ? section.data : undefined;
  const [ranks, setRanks] = useState<Record<string, Ranked>>({}),
    [ranksLoading, setRanksLoading] = useState(true);
  const progress = ownLiveProgress(
    game,
    model.chat.selfPresence,
    model.chat.status === 'ready',
    Date.now(),
    model.chat.friends,
  );
  const rosterKey = game?.players
    ?.filter((p) => !p.hidden)
    .map((p) => p.subject)
    .sort()
    .join(':');
  useEffect(() => {
    let current = true;
    setRanks({});
    setRanksLoading(true);
    void (async () => {
      try {
        for (const player of game?.players ?? []) {
          if (!current) return;
          if (player.hidden || player.tier != null) continue;
          try {
            const rank = await model.playerRank(player);
            if (current) setRanks((old) => ({ ...old, [player.subject]: rank }));
          } catch {
            return;
          }
        }
      } finally {
        if (current) setRanksLoading(false);
      }
    })();
    return () => {
      current = false;
    };
  }, [game?.matchId, rosterKey, model.playerRank, model.active?.puuid]);
  return (
    <ModalPage>
      <ModalHeader title="Live match" closeLabel="Back from live match" onClose={onBack} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={polling.refreshing}
            onRefresh={polling.refresh}
            tintColor={C.accent}
          />
        }
        contentContainerStyle={[S.content, { gap: 14 }]}
      >
        <Resource
          title="Live game"
          section={section}
          loading={polling.busy}
          skeleton="row"
          count={5}
        >
          {(value) => (
            <>
              {['idle', 'offline'].includes(value.state) ? (
                <Empty
                  title="No current match"
                  detail="Start a match in VALORANT. This view updates automatically."
                  icon="moon"
                />
              ) : (
                <LiveMatchHero game={value} progress={progress} region={model.active?.region} />
              )}
              {value.detailError && (
                <Empty
                  title="Waiting for match details"
                  detail={value.detailError.message}
                  icon="clock"
                />
              )}
              {!!value.players?.length && (
                <>
                  <View style={S.between}>
                    <Text style={[S.h3, { color: C.muted }]}>Players</Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Match skins"
                      onPress={() =>
                        value.matchId &&
                        onNavigate({ type: 'live-loadout', matchId: value.matchId })
                      }
                      style={{
                        minHeight: 44,
                        paddingHorizontal: 12,
                        borderRadius: 12,
                        backgroundColor: C.raised,
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <Feather name="crosshair" size={14} color={C.ink} />
                      <Text style={[S.h3, { fontSize: 12 }]}>Match skins</Text>
                    </Pressable>
                  </View>
                  <LiveRoster
                    game={value}
                    ranks={ranks}
                    ranksLoading={ranksLoading}
                    ownId={model.active?.puuid}
                    onPlayer={(player) => onNavigate({ type: 'player', player })}
                  />
                </>
              )}
            </>
          )}
        </Resource>
      </ScrollView>
    </ModalPage>
  );
}
