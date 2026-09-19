import { ChatConnectionNotice } from './ChatConnectionNotice';
import { Skeleton } from './Skeleton';
import { useFriendPortraits } from '../state/useFriendPortraits';
import { useNavInset } from './NavInsets';
import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useDeferredValue,
} from 'react';
import {
  SectionList,
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { AppModel } from '../state/useApp';
import type { Friend } from '../core/chatTypes';
import type { Catalog } from '../core/types';
import type { Navigate } from './explorerTypes';
import { friendSections, friendStatus } from '../core/friends';
import { ownLiveProgress, progressLabel } from '../core/liveProgress';
import { playerLabel } from '../core/playerNames';
import { Image } from './CachedImage';
import { PlayerAvatar } from './PlayerAvatar';
import { Button } from './components';
import { useTheme, useThemedStyles, type Palette } from './theme';

const FriendRow = memo(function FriendRow({
  friend,
  catalog,
  connected,
  onOpen,
  onChat,
  now,
}: {
  now: number;
  friend: Friend;
  catalog: Catalog;
  connected: boolean;
  onOpen(friend: Friend): void;
  onChat(subject: string): void;
}) {
  const { C, S } = useTheme(),
    styles = useThemedStyles(makeStyles);
  const rank = friend.tier !== undefined ? catalog.tiers[String(friend.tier)] : undefined;
  const state = !connected
    ? 'unknown'
    : friend.presence === 'offline'
      ? 'offline'
      : friend.presence === 'away'
        ? 'away'
        : 'online';
  return (
    <View style={styles.row}>
      <Pressable
        style={styles.person}
        accessibilityRole="button"
        accessibilityLabel={`View ${playerLabel(friend)} profile`}
        disabled={!connected || !!friend.hidden}
        onPress={() => onOpen(friend)}
      >
        <PlayerAvatar card={friend.card} catalog={catalog} status={state} size={40} />
        <View style={styles.identity}>
          <Text style={S.h3} numberOfLines={1}>
            {playerLabel(friend)}
            {friend.tag ? (
              <Text style={{ fontWeight: '400', color: C.subtle }}> #{friend.tag}</Text>
            ) : null}
          </Text>
          <Text
            style={[
              S.small,
              {
                color:
                  connected && ['in_game', 'agent_select', 'queue'].includes(friend.presence)
                    ? C.mint
                    : C.muted,
              },
            ]}
            numberOfLines={2}
          >
            {friendStatus(friend, connected, now)}
          </Text>
        </View>
        {rank?.image && (
          <Image
            source={{ uri: rank.image }}
            transition={0}
            contentFit="contain"
            style={styles.rank}
            accessibilityLabel={`${rank.name}${!connected ? ' (last reported)' : ''}`}
          />
        )}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Chat with ${playerLabel(friend)}`}
        onPress={() => onChat(friend.subject)}
        style={styles.chat}
        hitSlop={3}
      >
        <Feather name="message-circle" size={19} color={C.muted} />
      </Pressable>
    </View>
  );
});
const friendKey = (friend: Friend) => friend.subject;
export function FriendsScreen({ model, onNavigate }: { model: AppModel; onNavigate: Navigate }) {
  const { C, S } = useTheme(),
    styles = useThemedStyles(makeStyles);
  const navInset = useNavInset();
  const portraits = useFriendPortraits(model);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const [query, setQuery] = useState(''),
    search = useDeferredValue(query);
  const connected = model.chat.status === 'ready',
    busy = ['connecting', 'authenticating'].includes(model.chat.status);
  const sections = useMemo(
    () => friendSections(model.chat.friends, model.savedConversations, connected, search),
    [model.chat.friends, model.savedConversations, connected, search],
  );
  const onOpen = useCallback(
    (friend: Friend) => onNavigate({ type: 'player', player: friend }),
    [onNavigate],
  );
  const onChat = useCallback(
    (subject: string) => onNavigate({ type: 'chat', subject }),
    [onNavigate],
  );
  const renderItem = useCallback(
    ({ item }: { item: Friend }) => (
      <FriendRow
        friend={item}
        catalog={model.catalog}
        connected={connected}
        now={now}
        onOpen={onOpen}
        onChat={onChat}
      />
    ),
    [model.catalog, connected, onOpen, onChat, now],
  );
  const ownCard =
    model.snapshot?.loadout.status === 'ready'
      ? model.snapshot.loadout.data.card
      : model.observedIdentity?.player.card;
  const rank = model.snapshot?.rank.status === 'ready' ? model.snapshot.rank.data : undefined;
  const game =
    model.snapshot?.liveGame.status === 'ready' ? model.snapshot.liveGame.data : undefined;
  const self = model.chat.selfPresence,
    selfFresh = connected && !!self?.updatedAt && now - self.updatedAt <= 180000;
  const reported = progressLabel(ownLiveProgress(game, self, connected, now), now);
  const ownStatus = selfFresh
    ? friendStatus(self!, connected, now)
    : reported
      ? reported
      : game?.observedAt && Date.now() - game.observedAt > 120000
        ? 'Status last checked earlier'
        : game?.state === 'in_game'
          ? `In game${game.map ? ' · ' + game.map : ''}`
          : game?.state === 'agent_select'
            ? 'Agent select'
            : 'Your account';
  return (
    <SectionList
      onViewableItemsChanged={portraits.onViewableItemsChanged}
      viewabilityConfig={portraits.viewabilityConfig}
      sections={sections}
      keyExtractor={friendKey}
      renderItem={renderItem}
      initialNumToRender={10}
      maxToRenderPerBatch={8}
      updateCellsBatchingPeriod={32}
      windowSize={5}
      stickySectionHeadersEnabled={false}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[styles.content, { paddingBottom: 24 + navInset }]}
      renderSectionHeader={({ section }) => (
        <Text style={styles.section}>
          {section.title} - {section.data.length}
        </Text>
      )}
      ListHeaderComponent={
        <View style={{ gap: 14 }}>
          <View style={S.between}>
            <Text style={S.title}>Friends</Text>
            <Pressable
              style={styles.headerAction}
              accessibilityRole="button"
              accessibilityLabel="Open chats"
              onPress={() => onNavigate({ type: 'friends' })}
            >
              <Feather name="message-square" color={C.ink} size={21} />
            </Pressable>
          </View>
          <Button
            title={
              'Friend requests (' +
              (model.chat.friendRequests ?? []).filter((r) => r.direction === 'incoming').length +
              ')'
            }
            secondary
            icon="user-plus"
            onPress={() => onNavigate({ type: 'friend-requests' })}
          />
          <View style={[styles.row, { marginBottom: 0 }]}>
            <PlayerAvatar card={ownCard ?? self?.card} catalog={model.catalog} size={40} />
            <View style={styles.identity}>
              <Text style={S.h3} numberOfLines={1}>
                {model.active?.gameName}
                <Text style={{ fontWeight: '400', color: C.subtle }}>
                  {' '}
                  #{model.active?.tagLine}
                </Text>
              </Text>
              <Text style={S.small}>{ownStatus}</Text>
            </View>
            <Text style={[S.small, { color: C.accent, fontWeight: '700' }]}>YOU</Text>
            {rank?.image && (
              <Image
                source={{ uri: rank.image }}
                contentFit="contain"
                style={styles.rank}
                transition={0}
              />
            )}
          </View>
          <View style={[S.row, styles.search]}>
            <Feather name="search" color={C.subtle} size={17} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              accessibilityLabel="Search friends directory"
              placeholder="Find a friend"
              placeholderTextColor={C.subtle}
              autoCorrect={false}
              style={{ color: C.ink, flex: 1, minWidth: 0, paddingVertical: 8 }}
            />
          </View>
          <ChatConnectionNotice chat={model.chat} />
        </View>
      }
      ListEmptyComponent={
        busy || model.historyLoading ? (
          <Skeleton kind="row" count={4} label="Loading friends" style={{ paddingTop: 16 }} />
        ) : (
          <Text style={[S.body, { paddingVertical: 24, textAlign: 'center' }]}>
            {search
              ? 'No matching friends.'
              : connected
                ? 'No friends returned by Riot.'
                : 'Friends will appear when the connection returns.'}
          </Text>
        )
      }
    />
  );
}
const makeStyles = (C: Palette) =>
  StyleSheet.create({
    content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 24 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: C.surface,
      borderRadius: 16,
      padding: 10,
      marginBottom: 8,
      minHeight: 68,
    },
    person: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12 },
    identity: { flex: 1, minWidth: 0, gap: 5 },
    rank: { width: 27, height: 32, flexShrink: 0 },
    chat: { width: 36, height: 44, alignItems: 'center', justifyContent: 'center' },
    section: {
      color: C.subtle,
      fontWeight: '600',
      fontSize: 12,
      letterSpacing: 0.8,
      paddingTop: 20,
      paddingBottom: 12,
    },
    search: { paddingHorizontal: 14, minHeight: 44, borderRadius: 14, backgroundColor: C.surface },
    headerAction: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: C.surface,
    },
  });
