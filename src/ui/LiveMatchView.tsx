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
import { freshLiveStats } from '../core/liveStats';
import { queueName } from '../core/normalize';
import { playerLabel } from '../core/playerNames';
import { progressLabel } from '../core/liveProgress';
const numberStyle = { fontVariant: ['tabular-nums'] as 'tabular-nums'[] };
export function LiveMatchHero({
  game,
  progress,
  region,
}: {
  game: LiveGame;
  progress?: MatchProgress;
  region?: string;
}) {
  const { C, S } = useTheme(),
    [detail, setDetail] = useState(false),
    active = game.state === 'in_game';
  const score =
    progressLabel(progress) &&
    progress?.allyScore !== undefined &&
    progress?.enemyScore !== undefined;
  const hasStats = active && game.players?.some((p) => !!freshLiveStats(p.stats));
  return (
    <View testID="live-match-hero" style={{ gap: 10 }}>
      <View
        style={{
          borderRadius: 20,
          overflow: 'hidden',
          backgroundColor: C.raised,
          minHeight: 190,
          borderWidth: 1,
          borderColor: C.border,
        }}
      >
        {game.mapImage && (
          <Image
            source={{ uri: game.mapImage }}
            contentFit="cover"
            style={{ position: 'absolute', inset: 0 }}
          />
        )}
        <LinearGradient
          colors={['#0B10142B', '#0B1014E8']}
          style={{ padding: 18, gap: 18, minHeight: 190 }}
        >
          <View style={S.between}>
            <View style={{ flexDirection: 'row', gap: 7, alignItems: 'center' }}>
              <View
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: active ? '#7BE0B9' : '#F2C679',
                }}
              />
              <Text
                style={{ color: '#FFFFFF', fontSize: 10, fontWeight: '800', letterSpacing: 1.5 }}
              >
                {active ? 'LIVE MATCH' : 'AGENT SELECT'}
              </Text>
            </View>
            <Text style={{ color: '#D5DBE2', fontSize: 11 }}>
              {[game.queue ? queueName(game.queue) : undefined, region?.toUpperCase()]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
          <View>
            <Text
              style={{ color: '#FFFFFF', fontSize: 27, fontWeight: '800', letterSpacing: -0.6 }}
            >
              {game.map ?? 'Match in progress'}
            </Text>
            {score ? (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 25,
                  paddingTop: 8,
                }}
              >
                <View style={{ alignItems: 'center', minWidth: 65 }}>
                  <Text
                    style={{
                      color: '#7BE0B9',
                      fontSize: 10,
                      fontWeight: '700',
                      letterSpacing: 0.8,
                    }}
                  >
                    YOUR TEAM
                  </Text>
                  <Text
                    style={[
                      numberStyle,
                      { color: '#FFFFFF', fontSize: 42, fontWeight: '800', lineHeight: 50 },
                    ]}
                  >
                    {progress!.allyScore}
                  </Text>
                </View>
                <Text style={{ color: '#B6BEC8', fontSize: 20 }}>:</Text>
                <View style={{ alignItems: 'center', minWidth: 65 }}>
                  <Text
                    style={{
                      color: '#FF8B91',
                      fontSize: 10,
                      fontWeight: '700',
                      letterSpacing: 0.8,
                    }}
                  >
                    OPPONENTS
                  </Text>
                  <Text
                    style={[
                      numberStyle,
                      { color: '#FFFFFF', fontSize: 42, fontWeight: '800', lineHeight: 50 },
                    ]}
                  >
                    {progress!.enemyScore}
                  </Text>
                </View>
              </View>
            ) : (
              <Text style={{ color: '#CED5DF', fontSize: 12, marginTop: 8 }}>
                {active
                  ? 'Score updates appear as they are reported'
                  : 'Choose your agent in VALORANT'}
              </Text>
            )}
          </View>
          <View
            style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <Text style={{ color: '#E6EBF1', fontSize: 11 }}>
              {progress?.roundNumber
                ? `Round ${progress.roundEstimated ? '~' : ''}${progress.roundNumber}`
                : active
                  ? 'In progress'
                  : 'Preparing match'}
            </Text>
            <Text style={{ color: '#C3CBD6', fontSize: 10 }}>
              {game.observedAt
                ? `Updated ${new Date(game.observedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
                : ''}
            </Text>
          </View>
        </LinearGradient>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Live data details"
        accessibilityState={{ expanded: detail }}
        onPress={() => setDetail((v) => !v)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 28 }}
      >
        <Feather name="info" color={C.subtle} size={13} />
        <Text
          testID={!hasStats && active ? 'live-stats-unavailable' : undefined}
          style={[S.small, { flex: 1, fontSize: 11 }]}
        >
          {active
            ? hasStats
              ? 'Current-match stats'
              : 'Live K/D/A not reported'
            : 'The roster updates automatically.'}
        </Text>
        <Feather name={detail ? 'chevron-up' : 'chevron-down'} color={C.subtle} size={14} />
      </Pressable>
      {detail && (
        <View style={{ gap: 4, padding: 12, borderRadius: 12, backgroundColor: C.surface }}>
          <Text testID="live-progress-source" style={S.small}>
            {progress
              ? `Score source: ${progress.source === 'match' ? 'match service' : progress.source === 'teammate-presence' ? 'teammate presence' : 'your presence'}`
              : 'The match service has not supplied a score.'}
          </Text>
          {progress?.roundEstimated && (
            <Text style={S.small}>~ marks a round estimated from the reported score.</Text>
          )}
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
}: {
  game: LiveGame;
  ranks?: Record<string, Ranked>;
  ranksLoading?: boolean;
  ownId?: string;
  onPlayer(player: LivePlayer): void;
}) {
  const { C, S } = useTheme(),
    players = game.players ?? [],
    ownTeam = players.find((p) => p.subject === ownId || p.self)?.teamId;
  const teams = [...new Set(players.map((p) => p.teamId))].sort(
    (a, b) => Number(b === ownTeam) - Number(a === ownTeam),
  );
  const statsEnabled = game.state === 'in_game' && players.some((p) => !!freshLiveStats(p.stats));
  return (
    <View testID="live-roster" style={{ gap: 16 }}>
      {teams.map((team) => {
        const members = players.filter((p) => p.teamId === team),
          friendly = team === ownTeam,
          accent = friendly ? C.mint : C.accent;
        const label =
          teams.length === 1
            ? 'Players'
            : friendly
              ? 'Your team'
              : teams.length === 2
                ? 'Opponents'
                : `${team || 'Other'} team`;
        return (
          <View
            key={team}
            style={{
              borderRadius: 16,
              overflow: 'hidden',
              borderWidth: 1,
              borderColor: C.border,
              backgroundColor: C.surface,
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                padding: 12,
                gap: 8,
                backgroundColor: C.raised,
              }}
            >
              <View style={{ width: 3, height: 13, borderRadius: 2, backgroundColor: accent }} />
              <Text style={[S.h3, { flex: 1, fontSize: 12 }]}>
                {label}{' '}
                <Text style={{ color: C.subtle, fontWeight: '400' }}> {members.length}</Text>
              </Text>
              {statsEnabled && (
                <View
                  accessibilityLabel="Kills deaths assists columns"
                  style={{ width: 84, flexDirection: 'row' }}
                >
                  {['K', 'D', 'A'].map((k) => (
                    <Text
                      key={k}
                      style={[
                        S.small,
                        { width: 28, textAlign: 'center', fontSize: 10, fontWeight: '700' },
                      ]}
                    >
                      {k}
                    </Text>
                  ))}
                </View>
              )}
            </View>
            {members.map((p) => {
              const stats = game.state === 'in_game' ? freshLiveStats(p.stats) : undefined,
                you = p.subject === ownId || p.self;
              const rank = ranks[p.subject],
                rankName = p.tierName ?? rank?.name,
                rankImage = p.tierImage ?? rank?.image;
              const selection = p.selection?.toLowerCase(),
                agent = p.agent && p.agent !== 'Not selected' ? p.agent : 'Choosing agent';
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
                    paddingHorizontal: 12,
                    paddingVertical: 12,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 9,
                    minHeight: 76,
                    borderTopWidth: 0.5,
                    borderTopColor: C.border,
                    backgroundColor: you ? `${C.mint}0C` : C.surface,
                  })}
                >
                  <View
                    style={{
                      width: 36,
                      height: 42,
                      borderRadius: 9,
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
                        style={{ width: 36, height: 42 }}
                        transition={0}
                      />
                    ) : (
                      <Feather name="user" size={21} color={C.subtle} />
                    )}
                  </View>
                  <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                      <Text
                        numberOfLines={1}
                        style={[S.h3, { flexShrink: 1, fontSize: 13, color: you ? C.mint : C.ink }]}
                      >
                        {playerLabel(p, ownId)}
                      </Text>
                      {p.hidden && <Feather name="lock" color={C.subtle} size={10} />}
                    </View>
                    <Text numberOfLines={1} style={[S.small, { fontSize: 11 }]}>
                      {agent}
                      {game.state === 'agent_select' && selection
                        ? ` · ${selection === 'locked' ? 'Locked in' : 'Selecting'}`
                        : p.hideLevel
                          ? ''
                          : p.level != null
                            ? ` · Lv ${p.level}`
                            : ''}
                    </Text>
                    {!p.hidden &&
                      (rankName ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                          {rankImage && (
                            <Image
                              source={{ uri: rankImage }}
                              contentFit="contain"
                              style={{ width: 15, height: 15 }}
                              transition={0}
                            />
                          )}
                          <Text numberOfLines={1} style={[S.small, { fontSize: 10 }]}>
                            {rankName}
                            {rank && !rank.currentSeason ? ' · previous' : ''}
                          </Text>
                        </View>
                      ) : ranksLoading && p.tier == null ? (
                        <SkeletonGroup label="Loading player rank">
                          <Bone width={68} height={9} />
                        </SkeletonGroup>
                      ) : null)}
                  </View>
                  {statsEnabled ? (
                    <View
                      testID={stats ? 'live-kda-value' : undefined}
                      accessibilityLabel={
                        stats
                          ? `Live kills ${stats.kills}, deaths ${stats.deaths}, assists ${stats.assists}`
                          : 'Stats not reported'
                      }
                      style={{ width: 84, flexDirection: 'row', alignItems: 'center' }}
                    >
                      {stats ? (
                        [stats.kills, stats.deaths, stats.assists].map((value, index) => (
                          <Text
                            key={index}
                            style={[
                              numberStyle,
                              {
                                width: 28,
                                textAlign: 'center',
                                fontSize: 14,
                                fontWeight: '700',
                                color: index === 0 ? C.ink : C.muted,
                              },
                            ]}
                          >
                            {value}
                          </Text>
                        ))
                      ) : (
                        <Text style={[S.small, { width: 84, textAlign: 'center', fontSize: 10 }]}>
                          Not reported
                        </Text>
                      )}
                    </View>
                  ) : (
                    <Feather
                      name={p.hidden ? 'lock' : 'chevron-right'}
                      size={15}
                      color={C.subtle}
                    />
                  )}
                </Pressable>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}
