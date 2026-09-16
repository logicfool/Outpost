import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import type { MatchDetail } from '../core/types';
import type { MatchEvent, RoundDetail } from '../core/matchTypes';
import { eventClock, eventPositions, mapPoint } from '../core/matchAnalysis';
import { playerLabel } from '../core/playerNames';
import { Image } from './CachedImage';
import { ModalHeader, ModalPage } from './components';
import { AgentPortrait, EventRow, ROUND_ICONS } from './MatchVisuals';
import type { Navigate } from './explorerTypes';
import { useTheme } from './theme';

export function RoundPanel({
  detail,
  initialRound,
  eventId,
  onBack,
  onNavigate,
  ownId,
}: {
  detail: MatchDetail;
  initialRound: number;
  eventId?: string;
  onBack(): void;
  onNavigate: Navigate;
  ownId?: string;
}) {
  const { C, S } = useTheme();
  const numbers = useMemo(
    () =>
      [
        ...new Set([
          ...detail.rounds.map((r) => r.number),
          ...(detail.analysis?.rounds.map((r) => r.number) ?? []),
        ]),
      ].sort((a, b) => a - b),
    [detail],
  );
  const [roundNumber, setRound] = useState(
    numbers.includes(initialRound) ? initialRound : (numbers[0] ?? 1),
  );
  const [selectedId, setSelectedId] = useState(eventId),
    [economyOpen, setEconomyOpen] = useState(false),
    [timelineWidth, setTimelineWidth] = useState(300),
    [mapRatio, setMapRatio] = useState(1);
  const data: RoundDetail = detail.analysis?.rounds.find((r) => r.number === roundNumber) ?? {
    number: roundNumber,
    events: [],
    economy: [],
    telemetry: false,
  };
  const summary = detail.rounds.find((r) => r.number === roundNumber),
    selected = data.events.find((e) => e.id === selectedId) ?? data.events[0];
  const map = detail.analysis?.minimap,
    byId = useMemo(() => new Map(detail.players.map((p) => [p.subject, p])), [detail.players]);
  const pins = selected
    ? eventPositions(data, selected)
        .map((pin) => ({ ...pin, point: mapPoint(pin.location, map) }))
        .filter((p) => p.point)
    : [];
  const current = numbers.indexOf(roundNumber),
    eventIndex = selected ? data.events.indexOf(selected) : -1;
  const times = data.events.filter((e) => e.atMs !== undefined),
    maximum = Math.max(1, ...times.map((e) => e.atMs!));
  const color = summary?.winningTeam === detail.teamId ? C.mint : C.accent;
  const navigateRound = (index: number) => {
    if (index < 0 || index >= numbers.length) return;
    setRound(numbers[index]!);
    setSelectedId(undefined);
  };
  const chooseTime = (x: number) => {
    if (!times.length || timelineWidth <= 0) return;
    const at = Math.max(0, Math.min(1, x / timelineWidth)) * maximum;
    const nearest = times.reduce(
      (best, e) => (Math.abs(e.atMs! - at) < Math.abs(best.atMs! - at) ? e : best),
      times[0]!,
    );
    setSelectedId(nearest.id);
  };
  const step = (delta: number) => {
    const event = data.events[eventIndex + delta];
    if (event) setSelectedId(event.id);
  };
  return (
    <ModalPage>
      <ModalHeader title={detail.map} closeLabel="Back from round details" onClose={onBack} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[S.content, { gap: 14 }]}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: C.surface,
            borderRadius: 18,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Previous round"
            disabled={current <= 0}
            onPress={() => navigateRound(current - 1)}
            style={{ padding: 14, opacity: current <= 0 ? 0.3 : 1 }}
          >
            <Feather name="chevron-left" size={20} color={C.ink} />
          </Pressable>
          <View style={{ flex: 1, alignItems: 'center', gap: 2 }}>
            <Text style={S.h3}>
              Round {roundNumber} / {numbers.length}
            </Text>
            {summary && (
              <Text style={[S.small, { color }]}>
                {summary.winningTeam === detail.teamId ? 'Won' : 'Lost'}
                {data.ceremony && data.ceremony !== 'Default' ? ' · ' + data.ceremony : ''}
              </Text>
            )}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next round"
            disabled={current >= numbers.length - 1}
            onPress={() => navigateRound(current + 1)}
            style={{ padding: 14, opacity: current >= numbers.length - 1 ? 0.3 : 1 }}
          >
            <Feather name="chevron-right" size={20} color={C.ink} />
          </Pressable>
        </View>
        <View
          style={{ backgroundColor: C.surface, borderRadius: 18, overflow: 'hidden', padding: 8 }}
        >
          {map?.minimap ? (
            <View testID="round-minimap" style={{ width: '100%', aspectRatio: mapRatio }}>
              <Image
                accessibilityLabel={`${detail.map} round minimap`}
                source={{ uri: map.minimap }}
                contentFit="contain"
                transition={0}
                style={{ position: 'absolute', inset: 0 }}
                onLoad={(e) => {
                  if (e.source.width > 0 && e.source.height > 0)
                    setMapRatio(e.source.width / e.source.height);
                }}
              />
              {pins.map((pin) => {
                const p = byId.get(pin.subject);
                return (
                  <Pressable
                    key={pin.subject}
                    testID={`map-player-${pin.subject}`}
                    accessibilityRole="button"
                    accessibilityLabel={`${p ? playerLabel(p, ownId) : 'Player'} - ${pin.lastDeath ? 'earlier death location' : 'reported position'}`}
                    disabled={!p || p.hidden}
                    onPress={() => p && onNavigate({ type: 'player', player: p })}
                    style={{
                      position: 'absolute',
                      left: `${pin.point!.x * 100}%`,
                      top: `${pin.point!.y * 100}%`,
                      width: 38,
                      height: 38,
                      marginLeft: -19,
                      marginTop: -19,
                      alignItems: 'center',
                      justifyContent: 'center',
                      zIndex: pin.subject === selected?.actor ? 3 : pin.lastDeath ? 1 : 2,
                    }}
                  >
                    <AgentPortrait
                      player={p}
                      size={26}
                      color={p?.teamId === detail.teamId ? C.mint : C.accent}
                      dead={pin.lastDeath}
                    />
                  </Pressable>
                );
              })}
              {selected?.kind !== 'kill' &&
                selected?.location &&
                (() => {
                  const p = mapPoint(selected.location, map);
                  return p ? (
                    <View
                      pointerEvents="none"
                      style={{
                        position: 'absolute',
                        left: `${p.x * 100}%`,
                        top: `${p.y * 100}%`,
                        marginLeft: -10,
                        marginTop: -10,
                        width: 20,
                        height: 20,
                        borderRadius: 5,
                        backgroundColor: C.gold,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <MaterialCommunityIcons
                        name={selected.kind === 'plant' ? 'bomb' : 'bomb-off'}
                        color={C.background}
                        size={15}
                      />
                    </View>
                  ) : null;
                })()}
            </View>
          ) : (
            <View style={{ padding: 28, alignItems: 'center', gap: 8 }}>
              <Feather name="map" size={28} color={C.subtle} />
              <Text style={S.small}>Minimap not available for this map.</Text>
            </View>
          )}
        </View>
        <Text style={S.small}>
          {pins.length
            ? 'Positions at this event. Crosses mark earlier deaths.'
            : selected
              ? 'Player locations were not returned for this event.'
              : 'No position events returned for this round.'}
        </Text>
        {selected && (
          <>
            <View
              accessibilityRole="adjustable"
              accessibilityLabel="Round event timeline"
              accessibilityValue={{
                min: 1,
                max: data.events.length,
                now: eventIndex + 1,
                text: eventClock(selected.atMs),
              }}
              accessibilityActions={[
                { name: 'increment', label: 'Next event' },
                { name: 'decrement', label: 'Previous event' },
              ]}
              onAccessibilityAction={(e) => step(e.nativeEvent.actionName === 'increment' ? 1 : -1)}
              onLayout={(e) => setTimelineWidth(e.nativeEvent.layout.width)}
              onStartShouldSetResponder={() => times.length > 0}
              onMoveShouldSetResponder={() => times.length > 0}
              onResponderGrant={(e) => chooseTime(e.nativeEvent.locationX)}
              onResponderMove={(e) => chooseTime(e.nativeEvent.locationX)}
              style={{ height: 40, justifyContent: 'center', marginHorizontal: 8 }}
            >
              <View style={{ height: 2, backgroundColor: C.border }} />
              {times.map((e) => (
                <View
                  key={e.id}
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    left: `${(e.atMs! / maximum) * 100}%`,
                    marginLeft: -4,
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor:
                      byId.get(e.actor ?? '')?.teamId === detail.teamId ? C.mint : C.accent,
                  }}
                />
              ))}
              {selected.atMs !== undefined && (
                <View
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    left: `${(selected.atMs / maximum) * 100}%`,
                    marginLeft: -7,
                    width: 14,
                    height: 14,
                    borderRadius: 7,
                    backgroundColor: C.ink,
                    borderWidth: 2,
                    borderColor: C.background,
                  }}
                />
              )}
            </View>
            <View style={S.between}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Previous event"
                disabled={eventIndex <= 0}
                onPress={() => step(-1)}
                style={{ padding: 12, opacity: eventIndex <= 0 ? 0.3 : 1 }}
              >
                <Feather name="skip-back" size={19} color={C.ink} />
              </Pressable>
              <View style={{ alignItems: 'center' }}>
                <Text style={[S.h2, { fontVariant: ['tabular-nums'] }]}>
                  {eventClock(selected.atMs)}
                </Text>
                <Text style={S.small}>
                  {eventIndex + 1} / {data.events.length} events
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Next event"
                disabled={eventIndex >= data.events.length - 1}
                onPress={() => step(1)}
                style={{ padding: 12, opacity: eventIndex >= data.events.length - 1 ? 0.3 : 1 }}
              >
                <Feather name="skip-forward" size={19} color={C.ink} />
              </Pressable>
            </View>
          </>
        )}
        <Text style={S.h3}>Events</Text>
        {data.events.map((e) => (
          <EventRow
            key={e.id}
            event={e}
            detail={detail}
            selected={selected?.id === e.id}
            ownId={ownId}
            onPress={() => setSelectedId(e.id)}
          />
        ))}
        {!data.events.length && (
          <Text style={S.body}>
            {data.telemetry
              ? 'No recorded eliminations or spike events.'
              : 'Riot returned the result without round events.'}
          </Text>
        )}
        {!!data.economy.length && (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Toggle round economy"
              accessibilityState={{ expanded: economyOpen }}
              onPress={() => setEconomyOpen((v) => !v)}
              style={[S.between, { paddingVertical: 14 }]}
            >
              <Text style={S.h3}>Round economy</Text>
              <Feather
                name={economyOpen ? 'chevron-up' : 'chevron-down'}
                size={18}
                color={C.subtle}
              />
            </Pressable>
            {economyOpen && (
              <View style={{ backgroundColor: C.surface, borderRadius: 16, padding: 12, gap: 12 }}>
                {data.economy.map((e) => {
                  const p = byId.get(e.subject);
                  return (
                    <View key={e.subject} style={S.row}>
                      <AgentPortrait player={p} size={26} />
                      <View style={{ flex: 1 }}>
                        <Text style={S.h3}>{p ? playerLabel(p, ownId) : 'Player'}</Text>
                        <Text style={S.small}>{e.weaponName ?? 'Weapon not returned'}</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={S.h3}>
                          {e.loadoutValue !== undefined ? e.loadoutValue.toLocaleString() : '-'}
                        </Text>
                        <Text style={S.small}>
                          {e.remaining !== undefined ? `${e.remaining.toLocaleString()} left` : ''}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </>
        )}
        {detail.analysis?.truncated && (
          <Text style={S.small}>This unusually large report has been shortened.</Text>
        )}
      </ScrollView>
    </ModalPage>
  );
}
