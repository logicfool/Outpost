import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatDirectoryView, ChatFilter } from '../core/chatDirectory';
import type { ConversationRow } from '../core/conversations';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { AppModel } from '../state/useApp';
import type { Navigate } from './explorerTypes';
import { conversationRows, conversationSnippet, conversationTime } from '../core/conversations';
import { friendStatus } from '../core/friends';
import { PlayerAvatar } from './PlayerAvatar';
import { Button, Empty, ModalHeader, ModalPage, Tabs } from './components';
import { Skeleton } from './Skeleton';
import { useTheme } from './theme';
export function ChatsPanel({
  model,
  onBack,
  onNavigate,
  view,
}: {
  model: AppModel;
  onBack(): void;
  onNavigate: Navigate;
  view: ChatDirectoryView;
}) {
  const { C, S } = useTheme(),
    [filter, setFilter] = useState<ChatFilter>(view.filter),
    [query, setQuery] = useState(view.query);
  const list = useRef<FlatList<ConversationRow>>(null),
    initialOffset = useRef({ x: 0, y: view.offset });
  const restoring = useRef(view.offset > 0),
    frame = useRef<number | undefined>(undefined),
    size = useRef({ viewport: 0, content: 0 });
  const restore = () => {
    if (!restoring.current || !size.current.viewport || !size.current.content) return;
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const offset = Math.min(
        initialOffset.current.y,
        Math.max(0, size.current.content - size.current.viewport),
      );
      list.current?.scrollToOffset({ offset, animated: false });
      view.offset = offset;
      restoring.current = false;
    });
  };
  useEffect(
    () => () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    },
    [],
  );
  const resetScroll = () => {
    restoring.current = false;
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    list.current?.scrollToOffset({ offset: 0, animated: false });
  };
  const select = (next: ChatFilter) => {
    view.filter = next;
    view.offset = 0;
    setFilter(next);
    resetScroll();
  };
  const search = (next: string) => {
    view.query = next;
    view.offset = 0;
    setQuery(next);
    resetScroll();
  };
  const chat = model.chat,
    connected = chat.status === 'ready',
    busy = ['connecting', 'authenticating'].includes(chat.status);
  const rows = useMemo(
    () => conversationRows(chat, model.savedConversations, filter, query),
    [
      chat.friends,
      chat.messages,
      chat.unread,
      chat.status,
      model.savedConversations,
      filter,
      query,
    ],
  );
  return (
    <ModalPage>
      <ModalHeader title="Chats" closeLabel="Back from friends" onClose={onBack} />
      <FlatList
        ref={list}
        testID="chats-directory-list"
        contentOffset={initialOffset.current}
        onLayout={(event) => {
          size.current.viewport = event.nativeEvent.layout.height;
          restore();
        }}
        onContentSizeChange={(_width, height) => {
          size.current.content = height;
          restore();
        }}
        scrollEventThrottle={100}
        onScroll={(event) => {
          if (!restoring.current) view.offset = Math.max(0, event.nativeEvent.contentOffset.y);
        }}
        data={rows}
        keyExtractor={(r) => r.subject}
        initialNumToRender={12}
        maxToRenderPerBatch={8}
        windowSize={5}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={[S.content, { gap: 0 }]}
        ListHeaderComponent={
          <View style={{ gap: 12, paddingBottom: 10 }}>
            <Tabs
              value={filter}
              onChange={select}
              items={[
                { id: 'recent', label: 'Recent' },
                { id: 'all', label: 'All friends' },
                { id: 'online', label: 'Online' },
              ]}
            />
            <View
              style={[
                S.row,
                { borderRadius: 12, paddingHorizontal: 12, backgroundColor: C.surface },
              ]}
            >
              <Feather name="search" size={17} color={C.subtle} />
              <TextInput
                accessibilityLabel="Search chats"
                placeholder="Search chats"
                placeholderTextColor={C.subtle}
                value={query}
                onChangeText={search}
                style={[S.body, { flex: 1, minHeight: 44 }]}
                autoCorrect={false}
              />
            </View>
            {connected && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Disconnect chat"
                onPress={model.disconnectChat}
                style={{ alignSelf: 'flex-end', padding: 6 }}
              >
                <Text style={S.small}>Disconnect</Text>
              </Pressable>
            )}
            {!connected && (
              <>
                <Text style={S.small}>{chat.error ?? 'Saved messages are available offline.'}</Text>
                <Button
                  title={busy ? 'Connecting...' : 'Connect Riot chat'}
                  secondary
                  disabled={busy}
                  onPress={() => void model.connectChat()}
                />
              </>
            )}
            {chat.storageError && (
              <Text accessibilityRole="alert" style={[S.small, { color: C.gold }]}>
                {chat.storageError}
              </Text>
            )}
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            testID={`conversation-row-${item.subject}`}
            accessibilityRole="button"
            accessibilityLabel={`Open conversation with ${item.friend?.name ?? 'saved friend'}`}
            onPress={() => onNavigate({ type: 'chat', subject: item.subject })}
            style={({ pressed }) => ({
              opacity: pressed ? 0.75 : 1,
              flexDirection: 'row',
              gap: 12,
              paddingVertical: 14,
              borderBottomWidth: 0.5,
              borderBottomColor: C.border,
              minHeight: 76,
            })}
          >
            <PlayerAvatar
              card={item.friend?.card}
              catalog={model.catalog}
              size={44}
              status={
                connected && item.friend
                  ? item.friend.presence === 'offline'
                    ? 'offline'
                    : item.friend.presence === 'away'
                      ? 'away'
                      : 'online'
                  : 'unknown'
              }
            />
            <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
              <View style={S.between}>
                <Text
                  numberOfLines={1}
                  style={[S.h3, { flex: 1, fontWeight: item.unread ? '800' : '600' }]}
                >
                  {item.friend?.name ?? 'Saved conversation'}
                </Text>
                <Text style={[S.small, { fontSize: 11, color: item.unread ? C.accent : C.subtle }]}>
                  {conversationTime(item.lastAt)}
                </Text>
              </View>
              <View style={[S.row, { gap: 8 }]}>
                <Text
                  numberOfLines={1}
                  style={[S.small, { flex: 1, color: item.unread ? C.ink : C.muted }]}
                >
                  {item.lastMessage
                    ? conversationSnippet(item.lastMessage)
                    : item.friend
                      ? friendStatus(item.friend, connected)
                      : 'Start a conversation'}
                </Text>
                {!!item.unread && (
                  <View
                    style={{
                      minWidth: 21,
                      height: 21,
                      borderRadius: 11,
                      paddingHorizontal: 5,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: C.accent,
                    }}
                  >
                    <Text style={{ fontSize: 11, fontWeight: '800', color: '#FFFFFF' }}>
                      {item.unread > 99 ? '99+' : item.unread}
                    </Text>
                  </View>
                )}
              </View>
            </View>
          </Pressable>
        )}
        ListEmptyComponent={
          model.historyLoading || busy ? (
            <Skeleton kind="row" count={4} label="Loading conversations" />
          ) : (
            <Empty
              title={
                query
                  ? 'No matching chats'
                  : filter === 'recent'
                    ? 'No conversations yet'
                    : 'No friends in this view'
              }
              detail={
                filter === 'recent'
                  ? 'Choose All friends to start a chat.'
                  : 'Try a different filter.'
              }
              icon="message-circle"
            />
          )
        }
      />
    </ModalPage>
  );
}
