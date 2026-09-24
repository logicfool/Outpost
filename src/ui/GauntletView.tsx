import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from './CachedImage';
import { useTheme } from './theme';
import type { LiveGame, MatchDetail, MatchPlayer } from '../core/types';
import { playerLabel } from '../core/playerNames';
import {
  gauntletForGame,
  gauntletForReport,
  gauntletGroups,
  gauntletCounts,
  duoStatus,
  duoLabel,
  teamStale,
  type GauntletState,
  type GauntletTeam,
} from '../core/gauntlet';

export function DuoBadge({ team, state }: { team: GauntletTeam; state: GauntletState }) {
  const { C, S } = useTheme(),
    status = duoStatus(team, state);
  const color = status === 'winner' ? C.gold : status === 'active' ? C.mint : C.muted;
  const label = {
    active: 'Still in',
    eliminated: 'Eliminated',
    winner: 'Winner',
    unknown: 'Status not reported',
  }[status];
  return (
    <View style={{ gap: 4 }}>
      <Text style={[S.small, { color, fontWeight: '700' }]}>{label}</Text>
      {team.placement !== undefined && <Text style={S.small}>Placed #{team.placement}</Text>}
      <Text style={[S.small, { fontVariant: ['tabular-nums'] }]}>
        {team.health !== undefined
          ? `${team.health}${team.maxHealth ? ' / ' + team.maxHealth : ''} team HP`
          : 'Team HP not reported'}
      </Text>
      {team.health !== undefined && !!team.maxHealth && (
        <View
          accessibilityLabel={`Team health ${team.health} of ${team.maxHealth}`}
          style={{ height: 4, backgroundColor: C.raised, borderRadius: 3 }}
        >
          <View
            style={{
              height: 4,
              borderRadius: 3,
              backgroundColor: color,
              width: `${Math.min(100, (team.health / team.maxHealth) * 100)}%`,
            }}
          />
        </View>
      )}
      {team.evidenceAt !== undefined && teamStale(team, state) && (
        <Text style={[S.small, { fontSize: 10 }]}>Last reported</Text>
      )}
    </View>
  );
}
export function GauntletSummary({ state }: { state: GauntletState }) {
  const { C, S } = useTheme(),
    counts = gauntletCounts(state);
  return (
    <View
      testID="gauntlet-summary"
      style={{ padding: 14, gap: 6, backgroundColor: C.surface, borderRadius: 16 }}
    >
      <Text style={S.eyebrow}>8 DUOS · 2 PLAYERS PER TEAM</Text>
      <Text style={[S.h2, { fontSize: 23 }]}>
        {state.complete
          ? 'Final team results'
          : counts.remaining === undefined
            ? 'Duo survival'
            : `${counts.remaining} of 8 duos remaining`}
      </Text>
      <Text style={S.small}>
        {counts.reported} duos reported · {counts.eliminated} confirmed eliminated
      </Text>
      {counts.unknown > 0 && (
        <Text style={S.small}>{counts.unknown} team statuses not reported.</Text>
      )}
      {counts.stale && !counts.unknown && (
        <Text style={S.small}>Showing last reported team status.</Text>
      )}
      {!state.complete && (
        <Text style={S.small}>
          Losing a round costs team health. Zero team health means elimination, not a single round
          loss.
        </Text>
      )}
    </View>
  );
}
export function GauntletLiveHero({ game, region }: { game: LiveGame; region?: string }) {
  const { C, S } = useTheme(),
    state = gauntletForGame(game);
  return (
    <View testID="gauntlet-live-hero" style={{ gap: 10 }}>
      <View
        style={{ height: 145, borderRadius: 18, overflow: 'hidden', backgroundColor: C.raised }}
      >
        {!!game.mapImage && (
          <Image
            source={{ uri: game.mapImage }}
            contentFit="cover"
            style={{ position: 'absolute', inset: 0 }}
          />
        )}
        <LinearGradient
          colors={['#0B101400', '#0B1014D9']}
          style={{ flex: 1, justifyContent: 'flex-end', padding: 16, gap: 5 }}
        >
          <Text style={{ color: '#FFFFFF', fontSize: 26, fontWeight: '800' }}>
            Gauntlet: Glitched
          </Text>
          <Text style={{ color: '#E2E6EB', fontSize: 12 }}>
            {[game.map, region?.toUpperCase()].filter(Boolean).join(' · ')}
          </Text>
        </LinearGradient>
      </View>
      {!!state && <GauntletSummary state={state} />}
      <Text style={S.small}>
        Team health and elimination require team-specific data. A missing player, a round loss or a
        kill count is not an elimination signal.
      </Text>
    </View>
  );
}
export function GauntletPicker({
  game,
  ownId,
  selected,
  onSelect,
}: {
  game: LiveGame;
  ownId?: string;
  selected?: string;
  onSelect(id: string): void;
}) {
  const { C, S } = useTheme(),
    state = gauntletForGame(game);
  if (!state) return null;
  return (
    <View
      testID="gauntlet-duo-picker"
      accessibilityRole="tablist"
      style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}
    >
      {gauntletGroups(game, ownId).map((group) => (
        <Pressable
          key={group.id}
          testID={`gauntlet-duo-${group.id}`}
          accessibilityRole="tab"
          accessibilityLabel={`${group.label}${group.friendly ? ', your duo' : ''}`}
          accessibilityState={{ selected: selected === group.id }}
          aria-selected={selected === group.id}
          onPress={() => onSelect(group.id)}
          style={{
            flexBasis: '47%',
            flexGrow: 1,
            minWidth: 130,
            backgroundColor: C.surface,
            borderColor: selected === group.id ? C.accent : C.border,
            borderWidth: selected === group.id ? 2 : 1,
            borderRadius: 14,
            padding: 12,
            gap: 7,
          }}
        >
          <Text
            numberOfLines={2}
            style={[S.h3, { fontSize: 13, color: group.friendly ? C.mint : C.ink }]}
          >
            {group.label}
          </Text>
          {group.friendly && (
            <Text style={[S.small, { color: C.mint, fontWeight: '700' }]}>Your duo</Text>
          )}
          {group.team && <DuoBadge team={group.team} state={state} />}
          <View style={{ gap: 3 }}>
            {group.players.map((player) => (
              <Text key={player.subject} numberOfLines={1} style={[S.small, { color: C.ink }]}>
                {playerLabel(player, ownId)}
              </Text>
            ))}
            {group.team && group.players.length < group.team.members.length && (
              <Text style={S.small}>Some members no longer in the latest roster</Text>
            )}
            {!group.players.length && <Text style={S.small}>Roster not returned</Text>}
          </View>
        </Pressable>
      ))}
    </View>
  );
}
export function GauntletReportTeams({
  detail,
  ownId,
  renderPlayer,
}: {
  detail: MatchDetail;
  ownId?: string;
  renderPlayer(player: MatchPlayer, friendly: boolean): React.ReactNode;
}) {
  const { C, S } = useTheme(),
    state = gauntletForReport(detail);
  if (!state) return null;
  const groups = [...state.teams].sort(
    (a, b) =>
      (a.placement ?? 99) - (b.placement ?? 99) ||
      Number(b.won === true) - Number(a.won === true) ||
      a.id.localeCompare(b.id),
  );
  const ownTeam = detail.players.find((p) => p.subject === ownId)?.teamId;
  return (
    <View testID="gauntlet-report-teams" style={{ gap: 14 }}>
      <GauntletSummary state={state} />
      {groups.map((team) => {
        const friendly = team.id.toLowerCase() === (detail.teamId ?? '').toLowerCase();
        const members = detail.players.filter(
          (p) => p.teamId.toLowerCase() === team.id.toLowerCase(),
        );
        return (
          <View key={team.id} testID={`gauntlet-report-duo-${team.id}`} style={{ gap: 8 }}>
            <View style={{ backgroundColor: C.surface, borderRadius: 12, padding: 12, gap: 6 }}>
              <Text style={[S.h3, { color: friendly ? C.mint : C.ink }]}>
                {duoLabel(team, state.teams)}
                {friendly
                  ? team.id.toLowerCase() === ownTeam?.toLowerCase()
                    ? ' · Your duo'
                    : ' · Player’s duo'
                  : ''}
              </Text>
              <DuoBadge team={team} state={state} />
            </View>
            {members.map((p) => (
              <React.Fragment key={p.subject}>{renderPlayer(p, friendly)}</React.Fragment>
            ))}
            {!members.length && (
              <Text style={S.small}>No player details returned for this duo.</Text>
            )}
          </View>
        );
      })}
      {detail.players
        .filter((p) => !p.teamId.trim())
        .map((p) => (
          <React.Fragment key={p.subject}>{renderPlayer(p, false)}</React.Fragment>
        ))}
    </View>
  );
}
