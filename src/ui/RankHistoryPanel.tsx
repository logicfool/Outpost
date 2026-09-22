import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { AppModel } from '../state/useApp';
import { Image } from './CachedImage';
import { Badge, Empty, ModalHeader, ModalPage } from './components';
import { useNavInset } from './NavInsets';
import { useTheme } from './theme';

export function RankHistoryPanel({ model, onBack }: { model: AppModel; onBack(): void }) {
  const { C, S } = useTheme();
  const bottom = useNavInset();
  const rank = model.snapshot?.rank.status === 'ready' ? model.snapshot.rank.data : undefined;
  const acts = rank?.career?.find((entry) => entry.queue === 'competitive')?.acts ?? [];
  return (
    <ModalPage>
      <ModalHeader title="Rank History" closeLabel="Back from rank history" onClose={onBack} />
      <ScrollView contentContainerStyle={[S.content, { paddingBottom: bottom + 24 }]}>
        {acts.length ? (
          acts.map((act) => {
            const losses = Math.max(0, act.games - act.wins);
            return (
              <View
                key={act.seasonId}
                style={[S.card, act.current && { borderColor: C.accent, borderWidth: 1.5 }]}
              >
                <View style={S.between}>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={S.h2}>{act.name}</Text>
                    <Text style={S.small}>
                      {act.wins}W / {losses}L ·{' '}
                      {act.games ? `${((act.wins * 100) / act.games).toFixed(1)}%` : '-'} win rate
                    </Text>
                  </View>
                  {act.current ? <Badge text="CURRENT" color={C.accent} /> : null}
                </View>
                <View style={[S.row, { alignItems: 'stretch' }]}>
                  <View style={{ flex: 1, alignItems: 'center', gap: 5 }}>
                    <Text style={S.small}>END OF ACT</Text>
                    {act.image ? (
                      <Image
                        source={{ uri: act.image }}
                        contentFit="contain"
                        style={{ width: 62, height: 62 }}
                      />
                    ) : (
                      <Feather name="award" size={42} color={C.subtle} />
                    )}
                    <Text style={S.h3}>{act.tierName}</Text>
                    <Text style={S.small}>{act.rr ?? '-'} RR</Text>
                  </View>
                  <View style={{ width: 1, backgroundColor: C.border }} />
                  <View style={{ flex: 1, alignItems: 'center', gap: 5 }}>
                    <Text style={S.small}>ACT PEAK</Text>
                    {(act.peakImage ?? act.image) ? (
                      <Image
                        source={{ uri: act.peakImage ?? act.image }}
                        contentFit="contain"
                        style={{ width: 62, height: 62 }}
                      />
                    ) : (
                      <Feather name="trending-up" size={42} color={C.subtle} />
                    )}
                    <Text style={S.h3}>{act.peakName ?? act.tierName}</Text>
                    <Text style={S.small}>Peak rank</Text>
                  </View>
                </View>
                {(act.smallArt ?? act.peakSmallArt) ? (
                  <Image
                    accessibilityLabel={`${act.name} act rank badge`}
                    source={{ uri: act.peakSmallArt ?? act.smallArt }}
                    contentFit="contain"
                    style={{ width: '100%', height: 70 }}
                  />
                ) : null}
              </View>
            );
          })
        ) : (
          <Empty
            title="No rank history yet"
            detail="Complete ranked matches to build an act history."
            icon="award"
          />
        )}
      </ScrollView>
    </ModalPage>
  );
}
