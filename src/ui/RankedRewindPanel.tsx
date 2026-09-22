import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { groupRankedRewind, type RewindDay } from '../core/rankedRewind';
import type { AppModel } from '../state/useApp';
import { Empty, ListGroup, ListRow, ModalHeader, ModalPage } from './components';
import type { Navigate } from './explorerTypes';
import { useNavInset } from './NavInsets';
import { useTheme } from './theme';

const signed = (value: number) => `${value >= 0 ? '+' : ''}${value}`;
const dayLabel = (day: RewindDay, now = Date.now()) => {
  const date = new Date(day.startedAt);
  const today = new Date(now);
  const yesterday = new Date(now - 86400000);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
};

export function RankedRewindPanel({
  model,
  onBack,
  onNavigate,
}: {
  model: AppModel;
  onBack(): void;
  onNavigate: Navigate;
}) {
  const { C, S } = useTheme();
  const bottom = useNavInset();
  const matches = model.snapshot?.matches.status === 'ready' ? model.snapshot.matches.data : [];
  const days = useMemo(
    () => groupRankedRewind(matches, model.catalog.tiers),
    [matches, model.catalog.tiers],
  );
  const [open, setOpen] = useState<string | null>(days[0]?.key ?? null);
  return (
    <ModalPage>
      <ModalHeader title="Ranked Rewind" closeLabel="Back from ranked rewind" onClose={onBack} />
      <ScrollView contentContainerStyle={[S.content, { paddingBottom: bottom + 24 }]}>
        {days.length ? (
          days.map((day) => {
            const expanded = open === day.key;
            const transition =
              day.startRank && day.endRank
                ? `${day.startRank.name} ${day.startRank.rr} RR to ${day.endRank.name} ${day.endRank.rr} RR`
                : 'Rank transition unavailable';
            return (
              <View key={day.key} style={{ gap: 8 }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded }}
                  accessibilityLabel={`${dayLabel(day)} ${signed(day.netRr)} RR`}
                  onPress={() => setOpen(expanded ? null : day.key)}
                  style={({ pressed }) => [
                    S.card,
                    { opacity: pressed ? 0.72 : 1, paddingVertical: 14 },
                  ]}
                >
                  <View style={S.between}>
                    <View style={{ flex: 1, gap: 3 }}>
                      <Text style={S.h2}>{dayLabel(day)}</Text>
                      <Text style={S.small}>
                        {day.wins}W / {day.losses}L · {day.matches.length}{' '}
                        {day.matches.length === 1 ? 'match' : 'matches'}
                      </Text>
                      <Text style={S.small}>{transition}</Text>
                    </View>
                    <Text
                      style={[
                        S.h2,
                        {
                          color: day.netRr >= 0 ? C.mint : C.accent,
                          fontVariant: ['tabular-nums'],
                        },
                      ]}
                    >
                      {signed(day.netRr)} RR
                    </Text>
                    <Feather
                      name={expanded ? 'chevron-up' : 'chevron-down'}
                      size={18}
                      color={C.subtle}
                    />
                  </View>
                </Pressable>
                {expanded ? (
                  <ListGroup>
                    {day.matches.map((match, index) => (
                      <ListRow
                        key={match.id}
                        icon="crosshair"
                        title={match.map}
                        subtitle={new Date(match.startedAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                        value={`${signed(match.rrChange ?? 0)} RR`}
                        onPress={() => onNavigate({ type: 'match', id: match.id })}
                        last={index === day.matches.length - 1}
                      />
                    ))}
                  </ListGroup>
                ) : null}
              </View>
            );
          })
        ) : (
          <Empty
            title="No ranked matches yet"
            detail="Ranked matches will be grouped here after your next history refresh."
            icon="trending-up"
          />
        )}
      </ScrollView>
    </ModalPage>
  );
}
