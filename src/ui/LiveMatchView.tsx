import { isGauntlet } from '../core/gauntlet';
import { GauntletLiveHero, GauntletPicker } from './GauntletView';
import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from './CachedImage';
import { Bone, SkeletonGroup } from './Skeleton';
import { useTheme } from './theme';
import type { LiveGame, Ranked } from '../core/types';
import type { LivePlayer } from '../core/playerTypes';
import type { MatchProgress } from '../core/matchTypes';
import { liveTeams, liveRank } from '../core/livePresentation';
import { freshLiveStats } from '../core/liveStats';
import { queueName } from '../core/normalize';
import { playerLabel } from '../core/playerNames';
import { progressLabel, hasScorePair } from '../core/liveProgress';
const digits = { fontVariant: ['tabular-nums'] as 'tabular-nums'[] };
export function LiveMatchHero({
  game,
  progress,
  region,
  stale = false,
}: {
  game: LiveGame;
  progress?: MatchProgress;
  region?: string;
  stale?: boolean;
}) {
  const { C, S } = useTheme(),
    [detail, setDetail] = useState(false),
    active = game.state === 'in_game';
  if (isGauntlet(game)) return <GauntletLiveHero game={game} region={region} />;
  const score = hasScorePair(progress);
  const fresh = !!progressLabel(progress) && !stale,
    hasStats = active && game.players?.some((p) => !!freshLiveStats(p.stats));
  return (
    <View testID="live-match-hero" style={{ gap: 10 }}>
      <View
        style={{ height: 145, borderRadius: 18, overflow: 'hidden', backgroundColor: C.raised }}
      >
        {game.mapImage && (
          <Image
            source={{ uri: game.mapImage }}
            contentFit="cover"
            style={{ position: 'absolute', inset: 0 }}
          />
        )}
        <LinearGradient
          colors={['#0B101400', '#0B1014D9']}
          style={{ flex: 1, padding: 16, justifyContent: 'flex-end', gap: 3 }}
        >
          <Text style={{ color: '#FFFFFF', fontSize: 27, fontWeight: '800', letterSpacing: -0.7 }}>
            {game.map ?? 'Current match'}
          </Text>
          <Text style={{ color: '#E2E6EB', fontSize: 12 }}>
            {[game.queue ? queueName(game.queue) : 'VALORANT', region?.toUpperCase()]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </LinearGradient>
      </View>
      <View
        style={{
          backgroundColor: C.surface,
          borderRadius: 16,
          paddingHorizontal: 16,
          paddingVertical: 12,
          gap: 9,
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <View style={{ flex: 1, alignItems: 'flex-start' }}>
            <Text style={[S.small, { fontSize: 10, letterSpacing: 0.7 }]}>YOUR TEAM</Text>
            <Text
              testID="live-score-ally"
              style={[digits, { fontSize: 38, lineHeight: 45, fontWeight: '800', color: C.mint }]}
            >
              {score ? progress!.allyScore : '-'}
            </Text>
          </View>
          <View style={{ alignItems: 'center', gap: 6 }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 5,
                paddingHorizontal: 9,
                paddingVertical: 4,
                borderRadius: 10,
                backgroundColor: active && fresh ? `${C.accent}18` : C.raised,
              }}
            >
              <View
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: 3,
                  backgroundColor: active && fresh ? C.accent : C.gold,
                }}
              />
              <Text
                style={[
                  S.small,
                  { fontWeight: '800', fontSize: 10, color: active && fresh ? C.accent : C.muted },
                ]}
              >
                {active
                  ? score
                    ? !fresh
                      ? 'LAST REPORTED'
                      : 'LIVE'
                    : 'IN PROGRESS'
                  : 'AGENT SELECT'}
              </Text>
            </View>
            <Text style={[S.small, { fontSize: 11 }]}>
              {active && progress?.roundNumber
                ? `Round ${progress.roundEstimated ? '~' : ''}${progress.roundNumber}`
                : active
                  ? 'Waiting for score'
                  : 'Choose your agent'}
            </Text>
          </View>
          <View style={{ flex: 1, alignItems: 'flex-end' }}>
            <Text style={[S.small, { fontSize: 10, letterSpacing: 0.7 }]}>OPPONENTS</Text>
            <Text
              testID="live-score-enemy"
              style={[digits, { fontSize: 38, lineHeight: 45, fontWeight: '800', color: C.accent }]}
            >
              {score ? progress!.enemyScore : '-'}
            </Text>
          </View>
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Live data details"
        accessibilityState={{ expanded: detail }}
        onPress={() => setDetail((v) => !v)}
        style={{ minHeight: 28, flexDirection: 'row', gap: 6, alignItems: 'center' }}
      >
        <Feather name="activity" size={12} color={C.subtle} />
        <Text
          testID={!hasStats && active ? 'live-stats-unavailable' : undefined}
          style={[S.small, { fontSize: 11, flex: 1 }]}
        >
          {score
            ? `${fresh ? 'Score updated' : 'Last score'} ${new Date(progress!.observedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
            : active
              ? 'Score syncs from your game presence'
              : 'Roster updates automatically'}
        </Text>
        <Feather name={detail ? 'chevron-up' : 'chevron-down'} size={13} color={C.subtle} />
      </Pressable>
      {detail && (
        <View style={{ padding: 12, borderRadius: 12, backgroundColor: C.surface, gap: 5 }}>
          <Text testID="live-progress-source" style={S.small}>
            {progress
              ? `Score source: ${progress.source === 'match' ? 'match service' : progress.source === 'teammate-presence' ? 'same-match teammate' : progress.binding === 'party-context' ? 'shared party presence' : 'your presence'}`
              : 'Waiting for a score that can be linked to this match.'}
          </Text>
          {stale && (
            <Text style={S.small}>This is the last reported score, not a new live sample.</Text>
          )}
          {progress?.roundEstimated && (
            <Text style={S.small}>~ marks a round estimated from the reported score.</Text>
          )}
          {!hasStats && active && <Text style={S.small}>Live K/D/A has not been reported.</Text>}
          <Text style={S.small}>
            Only counters returned for this match are shown. Missing stats are not treated as zero.
          </Text>
        </View>
      )}
    </View>
  );
}
export function LiveRoster({
  game,
  ranks = {},
  ranksLoading = false,
  ownId,
  onPlayer,
  teamId,
  onTeamChange,
}: {
  game: LiveGame;
  ranks?: Record<string, Ranked>;
  ranksLoading?: boolean;
  ownId?: string;
  onPlayer(player: LivePlayer): void;
  teamId?: string;
  onTeamChange?(id: string): void;
}) {
  const { C, S } = useTheme(),
    teams = liveTeams(game, ownId),
    [selected, setSelected] = useState(teamId ?? teams[0]?.id);
  const group = teams.find((t) => t.id === (teamId ?? selected)) ?? teams[0],
    members = group?.players ?? [],
    accent = group?.friendly ? C.mint : C.accent;
  const statsEnabled = game.state === 'in_game' && members.some((p) => !!freshLiveStats(p.stats));
  return (
    <View testID="live-roster" style={{ gap: 8 }}>
      {isGauntlet(game) && (
        <GauntletPicker
          game={game}
          ownId={ownId}
          selected={group?.id}
          onSelect={(id) => {
            setSelected(id);
            onTeamChange?.(id);
          }}
        />
      )}
      {isGauntlet(game) && (
        <Text style={S.h3}>{group?.label ?? 'Team data not reported'} · Players</Text>
      )}
      {!isGauntlet(game) && teams.length > 1 && (
        <View
          accessibilityRole="tablist"
          style={{
            flexDirection: 'row',
            gap: 4,
            backgroundColor: C.surface,
            padding: 4,
            borderRadius: 14,
          }}
        >
          {teams.map((t) => (
            <Pressable
              key={t.id}
              accessibilityRole="tab"
              accessibilityLabel={t.label}
              aria-selected={t.id === group?.id}
              accessibilityState={{ selected: t.id === group?.id }}
              onPress={() => {
                setSelected(t.id);
                onTeamChange?.(t.id);
              }}
              style={{
                flex: 1,
                paddingVertical: 10,
                paddingHorizontal: 6,
                borderRadius: 11,
                alignItems: 'center',
                backgroundColor: t.id === group?.id ? C.raised : 'transparent',
              }}
            >
              <Text style={[S.h3, { fontSize: 12, color: t.id === group?.id ? C.ink : C.muted }]}>
                {t.label}
                <Text style={{ fontWeight: '400', color: C.subtle }}> {t.players.length}</Text>
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      {isGauntlet(game) && !members.length && (
        <Text style={S.small}>This duo has no players in the latest roster.</Text>
      )}
      {statsEnabled && (
        <View
          accessibilityLabel="Kills deaths assists columns"
          style={{ alignItems: 'flex-end', paddingRight: 12 }}
        >
          <View style={{ width: 84, flexDirection: 'row' }}>
            {['K', 'D', 'A'].map((label) => (
              <Text key={label} style={[S.small, { fontSize: 10, width: 28, textAlign: 'center' }]}>
                {label}
              </Text>
            ))}
          </View>
        </View>
      )}
      <View style={{ backgroundColor: C.surface, borderRadius: 16, overflow: 'hidden' }}>
        {members.map((p, index) => {
          const you = p.subject === ownId || p.self,
            rank = liveRank(p, ranks[p.subject]),
            stats = game.state === 'in_game' ? freshLiveStats(p.stats) : undefined;
          const agent =
            p.agent && p.agent !== 'Not selected'
              ? p.agent
              : game.state === 'in_game'
                ? 'Agent not reported'
                : 'Choosing agent';
          return (
            <Pressable
              key={p.subject}
              testID={`live-player-${p.subject}`}
              accessibilityRole="button"
              accessibilityLabel={`View ${playerLabel(p, ownId)} profile`}
              accessibilityState={{ disabled: !!p.hidden }}
              disabled={!!p.hidden}
              onPress={() => onPlayer(p)}
              style={({ pressed }) => ({
                opacity: pressed ? 0.72 : 1,
                minHeight: 74,
                paddingHorizontal: 12,
                paddingVertical: 11,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                borderTopWidth: index ? 0.5 : 0,
                borderTopColor: C.border,
                backgroundColor: you ? `${accent}0A` : C.surface,
              })}
            >
              <View
                style={{
                  width: 38,
                  height: 42,
                  borderRadius: 10,
                  backgroundColor: C.raised,
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                }}
              >
                {p.agentImage ? (
                  <Image
                    source={{ uri: p.agentImage }}
                    contentFit="contain"
                    style={{ width: 38, height: 42 }}
                    transition={0}
                  />
                ) : (
                  <Feather name="user" size={20} color={C.subtle} />
                )}
              </View>
              <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                <Text
                  numberOfLines={1}
                  style={[S.h3, { fontSize: 14, color: you ? accent : C.ink }]}
                >
                  {playerLabel(p, ownId)}
                  {!you && p.tag && !p.hidden ? (
                    <Text style={{ fontWeight: '400', color: C.subtle }}> #{p.tag}</Text>
                  ) : null}
                </Text>
                <Text numberOfLines={1} style={[S.small, { fontSize: 11 }]}>
                  {agent}
                  {p.hideLevel || p.level == null ? '' : ` · Lv ${p.level}`}
                  {game.state === 'agent_select' && p.selection?.toLowerCase() === 'locked'
                    ? ' · Locked'
                    : ''}
                </Text>
              </View>
              {statsEnabled ? (
                <View
                  testID={stats ? 'live-kda-value' : undefined}
                  accessibilityLabel={
                    stats
                      ? `Live kills ${stats.kills}, deaths ${stats.deaths}, assists ${stats.assists}`
                      : 'Stats not reported'
                  }
                  style={{ width: 84, flexDirection: 'row', justifyContent: 'center' }}
                >
                  {stats ? (
                    [stats.kills, stats.deaths, stats.assists].map((v, i) => (
                      <Text
                        key={i}
                        style={[
                          digits,
                          {
                            width: 28,
                            textAlign: 'center',
                            fontSize: 14,
                            fontWeight: '700',
                            color: i === 0 ? C.ink : C.muted,
                          },
                        ]}
                      >
                        {v}
                      </Text>
                    ))
                  ) : (
                    <Text style={[S.small, { fontSize: 10 }]}>Not reported</Text>
                  )}
                </View>
              ) : null}
              {!p.hidden && !statsEnabled && (
                <View style={{ alignItems: 'center', gap: 3, width: 60 }}>
                  {rank.image ? (
                    <Image
                      source={{ uri: rank.image }}
                      contentFit="contain"
                      style={{ width: 28, height: 29 }}
                      transition={0}
                    />
                  ) : ranksLoading && p.tier == null ? (
                    <SkeletonGroup label="Loading player rank">
                      <Bone width={26} height={27} />
                    </SkeletonGroup>
                  ) : (
                    <Feather name="award" size={23} color={C.subtle} />
                  )}
                  <Text numberOfLines={1} style={[S.small, { fontSize: 9, textAlign: 'center' }]}>
                    {rank.name === 'Not reported'
                      ? ranksLoading
                        ? 'Loading'
                        : 'Not reported'
                      : rank.name}
                  </Text>
                </View>
              )}
              {p.hidden ? (
                <Feather name="lock" size={14} color={C.subtle} />
              ) : (
                !statsEnabled && <Feather name="chevron-right" size={14} color={C.subtle} />
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
