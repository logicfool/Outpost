import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import type { MatchDetail, MatchPlayer, RoundOutcome } from '../core/types';
import type { MatchEvent } from '../core/matchTypes';
import { duelGrid, eventClock, isEnemyKill } from '../core/matchAnalysis';
import { playerLabel } from '../core/playerNames';
import type { Navigate } from './explorerTypes';
import { Image } from './CachedImage';
import { Button } from './components';
import { useTheme } from './theme';

export function AgentPortrait({
  player,
  size = 28,
  color,
  dead = false,
}: {
  player?: Partial<Pick<MatchPlayer, 'agentImage' | 'agent'>>;
  size?: number;
  color?: string;
  dead?: boolean;
}) {
  const { C } = useTheme();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: C.raised,
        borderWidth: color ? 2 : 0,
        borderColor: color,
        overflow: 'hidden',
        opacity: dead ? 0.6 : 1,
      }}
    >
      {player?.agentImage ? (
        <Image
          source={{ uri: player.agentImage }}
          transition={0}
          contentFit="cover"
          style={{ width: '100%', height: '100%' }}
        />
      ) : (
        <Feather
          name="user"
          size={size * 0.6}
          color={C.subtle}
          style={{ alignSelf: 'center', marginTop: size * 0.15 }}
        />
      )}
      {dead && (
        <View
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: '#00000055',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Feather name="x" size={size * 0.72} color="#FFFFFF" />
        </View>
      )}
    </View>
  );
}
export const ROUND_ICONS: Record<
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
export function RoundOverview({
  detail,
  onNavigate,
}: {
  detail: MatchDetail;
  onNavigate: Navigate;
}) {
  const { C, S } = useTheme();
  const byId = useMemo(() => new Map(detail.players.map((p) => [p.subject, p])), [detail.players]);
  const rows = useMemo(
    () =>
      detail.rounds.map((round) => {
        const data = detail.analysis?.rounds.find((r) => r.number === round.number);
        const kills = (data?.events ?? []).filter((e) => isEnemyKill(e, detail.players));
        return {
          round,
          own: kills.filter((e) => byId.get(e.actor!)?.teamId === detail.teamId),
          other: kills.filter((e) => byId.get(e.actor!)?.teamId !== detail.teamId),
          available: !!data?.telemetry || !!data?.events.length,
        };
      }),
    [detail, byId],
  );
  const max = Math.min(8, Math.max(1, ...rows.flatMap((r) => [r.own.length, r.other.length]))),
    stackHeight = max * 25 + 8;
  return (
    <View style={{ gap: 14 }}>
      <View style={S.between}>
        <Text style={[S.small, { color: C.mint }]}>PLAYER'S TEAM</Text>
        <Text style={[S.small, { color: C.accent }]}>OPPONENTS</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} testID="round-kill-chart">
        <View style={{ flexDirection: 'row', gap: 5 }}>
          {rows.map(({ round, own, other, available }) => (
            <Pressable
              key={round.number}
              accessibilityRole="button"
              accessibilityLabel={`Open round ${round.number} details`}
              onPress={() => onNavigate({ type: 'round', detail, round: round.number })}
              style={{ width: 44, gap: 5 }}
            >
              <View
                style={{
                  height: stackHeight,
                  justifyContent: 'flex-end',
                  alignItems: 'center',
                  gap: 3,
                }}
              >
                {own.slice(0, 8).map((e) => (
                  <AgentPortrait key={e.id} player={byId.get(e.actor!)} size={22} color={C.mint} />
                ))}
                {own.length > 8 && <Text style={S.small}>+{own.length - 8}</Text>}
              </View>
              <View
                style={{
                  height: 43,
                  backgroundColor:
                    round.winningTeam === detail.teamId ? `${C.mint}24` : `${C.accent}24`,
                  borderRadius: 9,
                  justifyContent: 'center',
                  alignItems: 'center',
                  gap: 1,
                }}
              >
                <Text
                  style={[S.h3, { color: round.winningTeam === detail.teamId ? C.mint : C.accent }]}
                >
                  {round.number}
                </Text>
                <MaterialCommunityIcons
                  name={ROUND_ICONS[round.outcome]}
                  size={13}
                  color={round.winningTeam === detail.teamId ? C.mint : C.accent}
                />
              </View>
              <View style={{ height: stackHeight, alignItems: 'center', gap: 3 }}>
                {other.slice(0, 8).map((e) => (
                  <AgentPortrait
                    key={e.id}
                    player={byId.get(e.actor!)}
                    size={22}
                    color={C.accent}
                  />
                ))}
                {other.length > 8 && <Text style={S.small}>+{other.length - 8}</Text>}
                {!available && <Text style={S.small}>-</Text>}
              </View>
            </Pressable>
          ))}
        </View>
      </ScrollView>
      <Text style={S.small}>One portrait per elimination. Tap a round.</Text>
      <Button
        secondary
        title="Details by round"
        icon="map"
        onPress={() => onNavigate({ type: 'round', detail, round: detail.rounds[0]?.number ?? 1 })}
      />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {(['elimination', 'detonate', 'defuse', 'time'] as const).map((kind) => (
          <View key={kind} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <MaterialCommunityIcons name={ROUND_ICONS[kind]} color={C.subtle} size={14} />
            <Text style={S.small}>
              {kind === 'detonate'
                ? 'Spike detonated'
                : kind === 'defuse'
                  ? 'Spike defused'
                  : kind === 'time'
                    ? 'Time expired'
                    : 'Elimination'}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
export function EventRow({
  event,
  detail,
  selected,
  onPress,
  ownId,
}: {
  event: MatchEvent;
  detail: MatchDetail;
  selected?: boolean;
  onPress(): void;
  ownId?: string;
}) {
  const { C, S } = useTheme(),
    actor = detail.players.find((p) => p.subject === event.actor),
    victim = detail.players.find((p) => p.subject === event.victim);
  const tone = actor?.teamId === detail.teamId ? C.mint : actor ? C.accent : C.gold;
  const action =
    event.kind === 'plant'
      ? `Plant${event.site ? ' ' + event.site : ''}`
      : event.kind === 'defuse'
        ? 'Defuse'
        : (event.weaponName ?? event.damageType ?? 'Elimination');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Round ${event.round} event ${eventClock(event.atMs)} ${actor ? playerLabel(actor, ownId) : 'Environment'} ${action}${victim ? ' vs ' + playerLabel(victim, ownId) : ''}`}
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      style={{
        minHeight: 64,
        borderRadius: 14,
        paddingHorizontal: 12,
        paddingVertical: 10,
        backgroundColor: selected ? `${tone}30` : `${tone}15`,
        borderWidth: 1,
        borderColor: selected ? tone : 'transparent',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 9,
      }}
    >
      <Text style={[S.small, { color: tone, width: 34, fontVariant: ['tabular-nums'] }]}>
        {eventClock(event.atMs)}
      </Text>
      <AgentPortrait player={actor} size={30} color={actor ? tone : undefined} />
      <View style={{ flex: 1, alignItems: 'center', gap: 3 }}>
        {event.weaponImage ? (
          <Image
            source={{ uri: event.weaponImage }}
            contentFit="contain"
            style={{ width: 68, height: 22 }}
          />
        ) : (
          <Feather
            name={event.kind === 'kill' ? 'crosshair' : 'target'}
            size={17}
            color={C.muted}
          />
        )}
        <Text style={S.small} numberOfLines={1}>
          {action}
        </Text>
      </View>
      {victim ? (
        <AgentPortrait
          player={victim}
          size={30}
          color={victim.teamId === detail.teamId ? C.mint : C.accent}
        />
      ) : (
        <Text style={[S.small, { width: 30, textAlign: 'center' }]}>{event.site ?? ''}</Text>
      )}
      <Feather name="chevron-right" size={13} color={C.subtle} />
    </Pressable>
  );
}
export function DuelMatrix({
  detail,
  onNavigate,
  ownId,
}: {
  detail: MatchDetail;
  onNavigate: Navigate;
  ownId?: string;
}) {
  const { C, S } = useTheme(),
    grid = useMemo(() => duelGrid(detail), [detail]);
  const [width, setWidth] = useState(340),
    [pair, setPair] = useState<{ a: string; b: string }>();
  const cell = Math.max(
    44,
    Math.min(64, (width - 43 - grid.enemies.length * 5) / Math.max(1, grid.enemies.length)),
  );
  const selected = pair
    ? grid.cells.find((c) => c.ally.subject === pair.a && c.enemy.subject === pair.b)
    : undefined;
  const events = selected
    ? grid.events.filter(
        (e) =>
          (e.actor === selected.ally.subject && e.victim === selected.enemy.subject) ||
          (e.actor === selected.enemy.subject && e.victim === selected.ally.subject),
      )
    : [];
  if (!detail.analysis?.available)
    return <Text style={S.body}>Elimination details were not returned for this match.</Text>;
  if (!grid.allies.length || !grid.enemies.length || detail.teams.length !== 2)
    return (
      <View style={{ gap: 10 }}>
        <Text style={S.h3}>Your duels</Text>
        {detail.duels.map((d) => (
          <View key={d.subject} style={[S.card, S.row, { padding: 12 }]}>
            <AgentPortrait player={{ agent: '', agentImage: d.agentImage }} />
            <Text style={[S.h3, { flex: 1 }]}>{d.name}</Text>
            <Text style={S.h3}>
              {d.kills}:{d.deaths}
            </Text>
          </View>
        ))}
      </View>
    );
  const summaries = [
    {
      label: 'Biggest rivalry',
      value: grid.rivalry ? `${grid.rivalry.kills}:${grid.rivalry.deaths}` : '-',
      players: grid.rivalry ? [grid.rivalry.ally, grid.rivalry.enemy] : [],
    },
    {
      label: 'Best matchup',
      value: grid.strongest ? `${grid.strongest.kills}:${grid.strongest.deaths}` : '-',
      players: grid.strongest ? [grid.strongest.ally, grid.strongest.enemy] : [],
    },
    {
      label: 'Assist partner',
      value: grid.assists ? `${grid.assists.count} plays` : '-',
      players: grid.assists ? [grid.assists.player] : [],
    },
  ];
  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{ gap: 17 }}
      testID="duel-matrix"
    >
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {summaries.map((summary) => (
          <View
            key={summary.label}
            style={{
              flex: 1,
              minWidth: 0,
              padding: 10,
              borderRadius: 16,
              backgroundColor: C.surface,
              gap: 7,
              alignItems: 'center',
            }}
          >
            <View style={{ flexDirection: 'row', gap: 2, height: 26 }}>
              {summary.players.map((p) => (
                <AgentPortrait key={p.subject} player={p} size={26} />
              ))}
            </View>
            <Text style={S.h3}>{summary.value}</Text>
            <Text style={[S.small, { textAlign: 'center' }]} numberOfLines={2}>
              {summary.label}
            </Text>
          </View>
        ))}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', gap: 5, marginLeft: 43 }}>
            {grid.enemies.map((p) => (
              <Pressable
                key={p.subject}
                accessibilityRole="button"
                accessibilityLabel={`View ${playerLabel(p, ownId)} profile`}
                disabled={p.hidden}
                onPress={() => onNavigate({ type: 'player', player: p })}
                style={{ width: cell, height: 44, alignItems: 'center', justifyContent: 'center' }}
              >
                <AgentPortrait player={p} size={28} />
              </Pressable>
            ))}
          </View>
          {grid.allies.map((a) => (
            <View key={a.subject} style={{ flexDirection: 'row', gap: 5, alignItems: 'center' }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`View ${playerLabel(a, ownId)} profile`}
                disabled={a.hidden}
                onPress={() => onNavigate({ type: 'player', player: a })}
                style={{ width: 38, height: 48, justifyContent: 'center' }}
              >
                <AgentPortrait player={a} size={28} />
              </Pressable>
              {grid.enemies.map((b) => {
                const c = grid.cells.find((c) => c.ally === a && c.enemy === b)!;
                const tone = c.kills > c.deaths ? C.mint : c.kills < c.deaths ? C.accent : C.muted;
                const chosen = pair?.a === a.subject && pair?.b === b.subject;
                return (
                  <Pressable
                    key={b.subject}
                    accessibilityRole="button"
                    accessibilityLabel={`Duels ${a.agent} against ${b.agent}: ${c.kills} kills ${c.deaths} deaths`}
                    accessibilityState={{ selected: chosen }}
                    onPress={() => setPair({ a: a.subject, b: b.subject })}
                    style={{
                      width: cell,
                      height: 48,
                      borderRadius: 9,
                      backgroundColor: c.kills + c.deaths ? `${tone}22` : C.surface,
                      borderWidth: 1,
                      borderColor: chosen ? tone : 'transparent',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text style={[S.h3, { color: tone, fontVariant: ['tabular-nums'] }]}>
                      {c.kills + c.deaths ? `${c.kills}:${c.deaths}` : '-'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>
      <Text style={S.small}>Row player kills : deaths. Tap a cell for events.</Text>
      {selected && (
        <View style={{ gap: 8 }}>
          <View style={S.between}>
            <Text style={[S.h3, { flex: 1 }]}>
              {selected.ally.agent} vs {selected.enemy.agent}
            </Text>
            <Text style={S.small}>{events.length} events</Text>
          </View>
          {events.length ? (
            events.map((e) => (
              <EventRow
                key={e.id}
                event={e}
                detail={detail}
                ownId={ownId}
                onPress={() =>
                  onNavigate({ type: 'round', detail, round: e.round || 1, eventId: e.id })
                }
              />
            ))
          ) : (
            <Text style={S.small}>No direct eliminations.</Text>
          )}
        </View>
      )}
    </View>
  );
}
