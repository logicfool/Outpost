import { Bone, Skeleton, SkeletonGroup } from './Skeleton';
import { ArtworkBoundary } from './ArtworkBoundary';
import { PlayerAvatar } from './PlayerAvatar';
import { Image } from './CachedImage';
import { ownLiveProgress, progressLabel } from '../core/liveProgress';
import React, { useState } from 'react';
import { playerLabel } from '../core/playerNames';
import { hydrateItem } from '../core/catalog';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import type { Catalog } from '../core/types';
import type { PlayerRef } from '../core/playerTypes';
import type { AppModel } from '../state/useApp';
import { useLivePolling } from '../state/useLivePolling';
import { Button, ProgressBar, SectionHeader } from './components';
import { useTheme, type Palette } from './theme';

export function PlayerCover({
  player,
  catalog,
  xp,
  onEdit,
  ownId,
  note,
}: {
  player: PlayerRef;
  catalog: Catalog;
  xp?: number;
  onEdit?(): void;
  ownId?: string;
  note?: string;
}) {
  const { C, S, isDark } = useTheme();

  const card = player.card ? hydrateItem(catalog, player.card) : undefined;
  const title = player.title ? hydrateItem(catalog, player.title) : undefined;
  const image = card?.wideArt ?? card?.wallpaper ?? card?.image;
  const [expanded, setExpanded] = useState(false);
  const you = player.subject === ownId;
  return (
    <View
      style={{
        width: '100%',
        backgroundColor: C.surface,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: C.border,
        overflow: 'hidden',
      }}
    >
      <View
        style={
          image
            ? { width: '100%', aspectRatio: 3.1, backgroundColor: C.raised }
            : { height: 56, backgroundColor: C.raised }
        }
      >
        {image ? (
          <ArtworkBoundary
            identity={`cover-${player.subject}-${image}`}
            urls={[image]}
            placeholder={
              <SkeletonGroup label="Loading player card artwork">
                <Bone height="auto" radius={0} style={{ aspectRatio: 3.1 }} />
              </SkeletonGroup>
            }
          >
            <Image
              key={image}
              accessibilityLabel={card?.name ?? 'Equipped player card'}
              source={{ uri: image }}
              contentFit="cover"
              priority="high"
              style={{ width: '100%', aspectRatio: 3.1 }}
            />
          </ArtworkBoundary>
        ) : (
          <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 16 }}>
            <Text style={S.small}>Player card not available</Text>
          </View>
        )}
        {onEdit && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Change player card and title"
            onPress={onEdit}
            style={{
              position: 'absolute',
              top: 8,
              right: 8,
              backgroundColor: `${C.surface}EE`,
              padding: 11,
              borderRadius: 22,
            }}
          >
            <Feather name="edit-2" size={18} color={C.ink} />
          </Pressable>
        )}
      </View>
      <View style={{ padding: 16, gap: 8 }}>
        <View style={S.row}>
          <PlayerAvatar card={card} catalog={catalog} size={42} />
          <View style={{ flex: 1 }}>
            <Text style={[S.h2, { fontSize: 23 }]} numberOfLines={2}>
              {ownId ? playerLabel(player, ownId) : player.hidden ? 'Hidden player' : player.name}
              {!player.hidden && !you && player.tag ? (
                <Text style={{ color: C.muted, fontSize: 17 }}> #{player.tag}</Text>
              ) : null}
            </Text>
          </View>
        </View>
        {title && !title.name.startsWith('Unresolved') && (
          <Text style={[S.body, { color: C.gold }]}>{title.name}</Text>
        )}
        <View style={[S.between, { flexWrap: 'wrap', gap: 4 }]}>
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
        {note && <Text style={S.small}>{note}</Text>}
        {card?.wallpaper && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Toggle full player card"
            onPress={() => setExpanded((v) => !v)}
            style={{ paddingVertical: 4 }}
          >
            <Text style={[S.small, { color: C.muted }]}>
              {expanded ? 'Hide full artwork ↑' : 'View full artwork ↓'}
            </Text>
          </Pressable>
        )}
        {expanded && card?.wallpaper && (
          <Image
            source={{ uri: card.wallpaper }}
            contentFit="contain"
            style={{ width: '100%', height: 340 }}
          />
        )}
      </View>
    </View>
  );
}
export function LiveCard({ model, onOpen }: { model: AppModel; onOpen(): void }) {
  const { C, S, isDark } = useTheme();

  const polling = useLivePolling(model),
    section = model.snapshot?.liveGame;
  const game = section?.status === 'ready' ? section.data : undefined;
  const progress = ownLiveProgress(game, model.chat.selfPresence, model.chat.status === 'ready');
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
      {!game && polling.busy ? (
        <Skeleton kind="row" label="Loading current game" />
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="View live game details"
          onPress={onOpen}
          style={[S.card, { overflow: 'hidden', minHeight: 78, padding: 12 }]}
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
                      ? (progressLabel(progress) ?? 'In progress')
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
      )}
      {error?.retryAt && (
        <Text style={S.small}>
          Retry allowed after {new Date(error.retryAt).toLocaleTimeString()}
        </Text>
      )}
    </View>
  );
}
