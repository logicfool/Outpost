import React from 'react';
import { ActivityIndicator, Image, Pressable, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import type { Catalog } from '../core/types';
import type { PlayerRef } from '../core/playerTypes';
import type { AppModel } from '../state/useApp';
import { useLivePolling } from '../state/useLivePolling';
import { Button, ProgressBar, SectionHeader } from './components';
import { C, S } from './theme';

export function PlayerCover({
  player,
  catalog,
  xp,
  onEdit,
}: {
  player: PlayerRef;
  catalog: Catalog;
  xp?: number;
  onEdit?(): void;
}) {
  const card = player.card ? (catalog.items[player.card.id] ?? player.card) : undefined;
  const title = player.title ? (catalog.items[player.title.id] ?? player.title) : undefined;
  const image = card?.wideArt ?? card?.wallpaper ?? card?.image;
  return (
    <View
      style={{
        backgroundColor: C.surface,
        borderRadius: 24,
        borderWidth: 1,
        borderColor: C.border,
        overflow: 'hidden',
      }}
    >
      <View style={{ height: 170, backgroundColor: C.raised }}>
        {image ? (
          <Image
            accessibilityLabel={card?.name ?? 'Equipped player card'}
            source={{ uri: image }}
            resizeMode="cover"
            style={{ width: '100%', height: '100%' }}
          />
        ) : (
          <LinearGradient
            colors={[`${C.accent}30`, C.surface]}
            style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}
          >
            <Feather name="image" size={34} color={C.subtle} />
          </LinearGradient>
        )}
        {onEdit && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Change player card and title"
            onPress={onEdit}
            style={{
              position: 'absolute',
              top: 12,
              right: 12,
              backgroundColor: '#070B12CC',
              padding: 10,
              borderRadius: 18,
            }}
          >
            <Feather name="edit-2" size={18} color={C.ink} />
          </Pressable>
        )}
      </View>
      <View style={{ padding: 18, gap: 9 }}>
        <Text style={[S.h2, { fontSize: 25 }]} numberOfLines={2}>
          {player.hidden ? 'Hidden player' : player.name}
          {!player.hidden && player.tag ? (
            <Text style={{ color: C.subtle }}> #{player.tag}</Text>
          ) : null}
        </Text>
        {title && !title.name.startsWith('Unresolved') && (
          <Text style={[S.body, { color: C.gold }]}>{title.name}</Text>
        )}
        <View style={S.between}>
          <Text style={S.small}>
            {player.hideLevel
              ? 'Level hidden'
              : player.level != null
                ? `Level ${player.level}`
                : 'Level not returned'}
          </Text>
          {xp !== undefined && <Text style={S.small}>{xp.toLocaleString()} / 5,000 XP</Text>}
        </View>
        {xp !== undefined && <ProgressBar value={xp} max={5000} />}
        {!image && <Text style={S.small}>Equipped card artwork has not been returned yet.</Text>}
      </View>
    </View>
  );
}
export function LiveCard({ model, onOpen }: { model: AppModel; onOpen(): void }) {
  const polling = useLivePolling(model),
    section = model.snapshot?.liveGame;
  const game = section?.status === 'ready' ? section.data : undefined;
  const idle = !game || game.state === 'idle' || game.state === 'offline';
  const error = section?.status === 'error' ? section : game?.detailError;
  return (
    <View style={{ gap: 10 }}>
      <View style={S.between}>
        <SectionHeader title="Current game" />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh live game"
          onPress={polling.refresh}
          style={{ padding: 10 }}
        >
          {polling.busy ? (
            <ActivityIndicator color={C.accent} />
          ) : (
            <Feather name="refresh-cw" size={18} color={C.accent} />
          )}
        </Pressable>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="View live game details"
        onPress={onOpen}
        style={[S.card, { overflow: 'hidden', minHeight: 94 }]}
      >
        {game?.mapImage && (
          <Image
            source={{ uri: game.mapImage }}
            style={{ position: 'absolute', inset: 0, opacity: 0.22 }}
            resizeMode="cover"
          />
        )}
        <View style={S.row}>
          <Feather
            name={error ? 'alert-circle' : idle ? 'moon' : 'radio'}
            size={24}
            color={error ? C.gold : idle ? C.subtle : C.mint}
          />
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={S.h3}>
              {section?.status === 'error'
                ? 'Status unavailable'
                : !section
                  ? 'Checking current game…'
                  : game?.state === 'in_game'
                    ? 'In progress'
                    : game?.state === 'agent_select'
                      ? 'Agent selection'
                      : 'Not in a match'}
            </Text>
            <Text style={S.small}>
              {game?.map ??
                (error
                  ? error.message
                  : idle
                    ? 'Updates while this screen is open'
                    : 'Open to view roster and connection details')}
            </Text>
          </View>
          <Feather name="chevron-right" size={20} color={C.subtle} />
        </View>
        {game?.observedAt && (
          <Text style={S.small}>
            Checked{' '}
            {new Date(game.observedAt).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })}
          </Text>
        )}
      </Pressable>
      {error?.retryAt && (
        <Text style={S.small}>
          Retry allowed after {new Date(error.retryAt).toLocaleTimeString()}
        </Text>
      )}
    </View>
  );
}
