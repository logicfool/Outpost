import React from 'react';
import { Text, View } from 'react-native';
import type { MatchProgress } from '../core/matchTypes';
import type { LiveStats } from '../core/liveStats';
import { useTheme } from './theme';
export function LiveDataStatus({
  progress,
  hasStats,
}: {
  progress?: MatchProgress;
  hasStats: boolean;
}) {
  const { S } = useTheme();
  const source =
    progress?.source === 'match'
      ? 'Match service'
      : progress?.source === 'teammate-presence'
        ? 'Teammate presence'
        : 'Your presence';
  return (
    <View style={{ gap: 4 }}>
      <Text testID="live-progress-source" style={S.small}>
        {progress
          ? `${source} - ${new Date(progress.observedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
          : 'Score and round are not currently reported.'}
      </Text>
      {!hasStats && (
        <Text testID="live-stats-unavailable" style={S.small}>
          Riot has not provided live K/D/A. Match reports include final stats after the game.
        </Text>
      )}
    </View>
  );
}
export function LiveStatsLine({ stats }: { stats?: LiveStats }) {
  const { C, S } = useTheme();
  const fresh =
    stats && Date.now() - stats.observedAt <= 180000 && Date.now() >= stats.observedAt - 60000;
  return (
    <Text
      testID="live-kda-value"
      accessibilityLabel={
        fresh
          ? `Live kills ${stats.kills}, deaths ${stats.deaths}, assists ${stats.assists}`
          : 'Live K/D/A unavailable'
      }
      style={[S.small, { color: fresh ? C.ink : C.subtle, fontVariant: ['tabular-nums'] }]}
    >
      {fresh ? `K/D/A ${stats.kills} / ${stats.deaths} / ${stats.assists}` : 'K/D/A - / - / -'}
    </Text>
  );
}
