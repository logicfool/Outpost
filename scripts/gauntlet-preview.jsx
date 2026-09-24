// Browser-only fixture app copied into an isolated temporary Expo project by the test runner.
import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, useTheme } from './src/ui/theme';
import { LiveMatchHero, LiveRoster } from './src/ui/LiveMatchView';
import { MatchReport } from './src/ui/screens';
import { mergeGauntletLive } from './src/core/gauntlet';
import fixture from './fixture.json';
function fresh(game) {
  const now = Date.now(),
    next = JSON.parse(JSON.stringify(game));
  next.observedAt = now;
  next.gauntlet.observedAt = now;
  for (const t of next.gauntlet.teams) {
    t.seenAt = now;
    if (t.evidenceAt !== undefined) t.evidenceAt = now;
  }
  return next;
}
export default function Preview() {
  const [theme, setTheme] = useState('dark');
  return (
    <SafeAreaProvider>
      <ThemeProvider preference={theme}>
        <Content setTheme={setTheme} />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
function Content({ setTheme }) {
  const { C, S } = useTheme(),
    [game, setGame] = useState(() => fresh(fixture.game));
  const [mode, setMode] = useState('live'),
    [player, setPlayer] = useState('');
  const [selected, setSelected] = useState('Duo1');
  const command = (label, action) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={action}
      style={{ padding: 10, backgroundColor: C.surface }}
    >
      <Text style={S.small}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, padding: 8 }}>
        {command('Dark', () => setTheme('dark'))}
        {command('Light', () => setTheme('light'))}
        {command('Live', () => setMode('live'))}
        {command('Report', () => setMode('report'))}
        {command('Eliminate duo 2', () => {
          const next = fresh(game);
          next.gauntlet.teams[1].health = 0;
          next.gauntlet.teams[1].eliminated = true;
          setGame(next);
        })}
        {command('Unknown health', () => setGame(fresh(fixture.unknown)))}
        {command('Partial update', () => {
          const next = fresh(fixture.unknown);
          next.players = next.players.filter((p) => !['Duo7', 'Duo8'].includes(p.teamId));
          next.gauntlet.teams = next.gauntlet.teams.slice(0, 6);
          setGame(mergeGauntletLive(game, next));
        })}
      </View>
      {mode === 'report' ? (
        <MatchReport
          id={fixture.report.id}
          embedded
          model={{
            active: { puuid: fixture.ownId },
            catalog: fixture.catalog,
            matchDetail: async () => fixture.report,
          }}
          onClose={() => setMode('live')}
          onNavigate={(route) => setPlayer(route.player?.name ?? 'opened')}
        />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 12, gap: 12 }}>
          <LiveMatchHero game={game} region="ap" />
          <LiveRoster
            game={game}
            ownId={fixture.ownId}
            teamId={selected}
            onTeamChange={setSelected}
            onPlayer={(p) => setPlayer(p.name)}
          />
          <Text testID="opened-player" style={S.body}>
            {player}
          </Text>
        </ScrollView>
      )}
    </View>
  );
}
