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
}: {
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
        <PlayerAvatar card={friend.card} catalog={catalog} status={state} />
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
            {friendStatus(friend, connected)}
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
  const [query, setQuery] = useState(''),
    search = useDeferredValue(query);
  const connected = model.chat.status === 'ready',
    busy = ['connecting', 'authenticating'].includes(model.chat.status);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (model.chat.status === 'disconnected') void model.connectChat();
  }, [model.chat.status, model.connectChat]);
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
        onOpen={onOpen}
        onChat={onChat}
      />
    ),
    [model.catalog, connected, onOpen, onChat],
  );
  const ownCard =
    model.snapshot?.loadout.status === 'ready'
      ? model.snapshot.loadout.data.card
      : model.observedIdentity?.player.card;
  const rank = model.snapshot?.rank.status === 'ready' ? model.snapshot.rank.data : undefined;
  const game =
    model.snapshot?.liveGame.status === 'ready' ? model.snapshot.liveGame.data : undefined;
  const ownStatus =
    game?.observedAt && Date.now() - game.observedAt > 120000
      ? 'Status last checked earlier'
      : game?.state === 'in_game'
        ? `In game${game.map ? ' · ' + game.map : ''}`
        : game?.state === 'agent_select'
          ? 'Agent select'
          : 'Your account';
  return (
    <SectionList
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
          <View style={[styles.row, { marginBottom: 0 }]}>
            <PlayerAvatar card={ownCard} catalog={model.catalog} />
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
          {!connected && (
            <View style={{ gap: 8 }}>
              {busy ? (
                <View style={S.row}>
                  <ActivityIndicator color={C.accent} size="small" />
                  <Text style={S.small}>Connecting to Riot…</Text>
                </View>
              ) : (
                <>
                  <Text style={S.small}>
                    {model.chat.error ??
                      'Saved friends are shown until a live connection is available.'}
                  </Text>
                  <Button
                    secondary
                    title="Connect friends"
                    onPress={() => void model.connectChat()}
                  />
                </>
              )}
            </View>
          )}
        </View>
      }
      ListEmptyComponent={
        <Text style={[S.body, { paddingVertical: 24, textAlign: 'center' }]}>
          {busy
            ? 'Loading friends…'
            : search
              ? 'No matching friends.'
              : connected
                ? 'No friends returned by Riot.'
                : 'Connect to load your friends.'}
        </Text>
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
      borderRadius: 18,
      padding: 12,
      marginBottom: 10,
      minHeight: 80,
    },
    person: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12 },
    identity: { flex: 1, minWidth: 0, gap: 5 },
    rank: { width: 33, height: 38, flexShrink: 0 },
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
