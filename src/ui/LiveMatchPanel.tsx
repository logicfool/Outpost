import React, { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { AppModel } from '../state/useApp';
import type { Navigate } from './explorerTypes';
import type { LiveViewState } from '../core/livePresentation';
import { liveTeams } from '../core/livePresentation';
import { useLivePolling } from '../state/useLivePolling';
import { useLiveRanks, useLiveScore } from '../state/useLiveMatchData';
import { LiveMatchHero, LiveRoster } from './LiveMatchView';
import { Empty, ModalHeader, ModalPage, Resource } from './components';
import { useTheme } from './theme';
export function LiveMatchPanel({
  model,
  onBack,
  onNavigate,
  view,
}: {
  model: AppModel;
  onBack(): void;
  onNavigate: Navigate;
  view: LiveViewState;
}) {
  const { C, S } = useTheme(),
    polling = useLivePolling(model),
    section = model.snapshot?.liveGame;
  const game = section?.status === 'ready' ? section.data : undefined,
    score = useLiveScore(model, view);
  const [teamId, setTeamId] = useState(view.teamId);
  const teams = game ? liveTeams(game, model.active?.puuid) : [],
    selected = teams.find((t) => t.id === teamId) ?? teams[0];
  const rankState = useLiveRanks(model, selected?.players ?? [], view);
  const selectTeam = (id: string) => {
    view.teamId = id;
    setTeamId(id);
  };
  return (
    <ModalPage>
      <ModalHeader title="Live match" closeLabel="Back from live match" onClose={onBack} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={polling.refreshing}
            onRefresh={() => {
              polling.refresh();
              rankState.refresh();
            }}
            tintColor={C.accent}
          />
        }
        contentContainerStyle={[S.content, { gap: 12 }]}
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
                <LiveMatchHero
                  game={value}
                  progress={score.progress}
                  stale={!score.live}
                  region={model.active?.region}
                />
              )}
              {value.detailError && (
                <Text style={[S.small, { color: C.gold }]}>{value.detailError.message}</Text>
              )}
              {!!value.players?.length && (
                <>
                  <View style={S.between}>
                    <Text style={[S.h3, { color: C.muted, fontSize: 13 }]}>Match roster</Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Match skins"
                      onPress={() =>
                        value.matchId &&
                        onNavigate({ type: 'live-loadout', matchId: value.matchId })
                      }
                      style={{
                        minHeight: 36,
                        paddingHorizontal: 10,
                        borderRadius: 10,
                        backgroundColor: C.surface,
                        flexDirection: 'row',
                        gap: 6,
                        alignItems: 'center',
                      }}
                    >
                      <Feather name="crosshair" size={13} color={C.ink} />
                      <Text style={[S.small, { color: C.ink }]}>Match skins</Text>
                    </Pressable>
                  </View>
                  <LiveRoster
                    game={value}
                    ownId={model.active?.puuid}
                    teamId={selected?.id}
                    onTeamChange={selectTeam}
                    ranks={rankState.ranks}
                    ranksLoading={rankState.loading}
                    onPlayer={(player) =>
                      value.matchId &&
                      onNavigate({
                        type: 'live-player',
                        matchId: value.matchId,
                        subject: player.subject,
                      })
                    }
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
