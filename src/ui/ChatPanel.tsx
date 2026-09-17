import { Skeleton } from './Skeleton';
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { AppModel } from '../state/useApp';
import type { ChatMessage } from '../core/chatTypes';
import type { Navigate } from './explorerTypes';
import { safeError } from '../core/validation';
import { friendStatus } from '../core/friends';
import { playerLabel } from '../core/playerNames';
import { useConversationSync } from '../state/useConversationSync';
import { PlayerAvatar } from './PlayerAvatar';
import { Button, Empty, IconButton, ModalPage } from './components';
import { useTheme } from './theme';
const EMPTY: ChatMessage[] = [];
const key = (m: ChatMessage) => `${m.direction}:${m.id}`;
const MessageBubble = memo(function MessageBubble({
  message,
  day,
}: {
  message: ChatMessage;
  day?: string;
}) {
  const { C, S } = useTheme();
  return (
    <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
      {day && <Text style={[S.small, { textAlign: 'center', marginBottom: 12 }]}>{day}</Text>}
      <View
        style={{
          alignSelf: message.direction === 'outgoing' ? 'flex-end' : 'flex-start',
          maxWidth: '88%',
          backgroundColor: message.direction === 'outgoing' ? `${C.accent}18` : C.surface,
          borderRadius: 18,
          borderWidth: 1,
          borderColor: C.border,
          padding: 14,
          gap: 6,
        }}
      >
        <Text selectable style={[S.body, { color: C.ink }]}>
          {message.body}
        </Text>
        <Text style={S.small}>
          {new Date(message.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          {message.serverStored
            ? ' · Riot history'
            : message.source === 'riot-client'
              ? ' · Riot client'
              : message.direction === 'outgoing'
                ? ` · ${message.state === 'sent' ? 'Sent' : message.state === 'failed' ? 'Unconfirmed - not retried' : 'Sending…'}`
                : ''}
        </Text>
      </View>
    </View>
  );
});
export function ChatPanel({
  subject,
  model,
  onBack,
  onNavigate,
}: {
  subject: string;
  model: AppModel;
  onBack(): void;
  onNavigate: Navigate;
}) {
  const { C, S } = useTheme();
  const liveFriend = model.chat.friends.find((f) => f.subject === subject);
  const friend = liveFriend ?? model.savedConversations.find((c) => c.subject === subject)?.friend;
  const messages = model.chat.messages[subject] ?? EMPTY,
    archive = model.chat.archive?.[subject];
  const [body, setBody] = useState(''),
    [error, setError] = useState<string>(),
    [sending, setSending] = useState(false),
    [more, setMore] = useState(false),
    [confirm, setConfirm] = useState(false),
    [opening, setOpening] = useState(true);
  const list = useRef<FlatList<ChatMessage>>(null),
    mounted = useRef(true),
    follow = useRef(true),
    loadingPage = useRef(false);
  useConversationSync(model, subject);
  useEffect(() => {
    mounted.current = true;
    model.markChatRead(subject);
    setOpening(true);
    void model
      .loadChatMessages(subject)
      .catch((reason) => {
        if (mounted.current) setError(safeError(reason).message);
      })
      .finally(() => {
        if (mounted.current) setOpening(false);
      });
    return () => {
      mounted.current = false;
      model.markChatRead();
    };
  }, [subject, model.markChatRead, model.loadChatMessages]);
  useEffect(() => {
    model.markChatRead(subject);
  }, [messages.length, subject, model.markChatRead]);
  const reversed = useMemo(() => [...messages].reverse(), [messages]);
  const latest = reversed[0] ? key(reversed[0]) : '';
  useEffect(() => {
    if (follow.current) list.current?.scrollToOffset({ offset: 0, animated: false });
  }, [latest]);
  const send = async () => {
    if (sending || !body.trim()) return;
    setSending(true);
    setError(undefined);
    const sent = body;
    follow.current = true;
    try {
      await model.sendChat(subject, sent);
      if (mounted.current) setBody((old) => (old === sent ? '' : old));
    } catch (reason) {
      if (mounted.current) setError(safeError(reason).message);
    } finally {
      if (mounted.current) setSending(false);
    }
  };
  const cursor = model.historyCursors[subject];
  const older = useCallback(async () => {
    if (!cursor || loadingPage.current) return;
    loadingPage.current = true;
    setMore(true);
    follow.current = false;
    try {
      await model.loadChatMessages(subject, cursor);
    } finally {
      loadingPage.current = false;
      if (mounted.current) setMore(false);
    }
  }, [cursor, subject, model.loadChatMessages]);
  const erase = async () => {
    setConfirm(false);
    try {
      await model.clearChatHistory(subject);
    } catch (reason) {
      if (mounted.current) setError(safeError(reason).message);
    }
  };
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    follow.current = event.nativeEvent.contentOffset.y < 80;
  }, []);
  const renderItem = useCallback(
    ({ item, index }: { item: ChatMessage; index: number }) => {
      const previous = reversed[index + 1],
        day = new Date(item.at).toDateString();
      return (
        <MessageBubble
          message={item}
          day={
            !previous || new Date(previous.at).toDateString() !== day
              ? new Date(item.at).toLocaleDateString()
              : undefined
          }
        />
      );
    },
    [reversed],
  );
  return (
    <ModalPage>
      <View
        style={[
          S.row,
          {
            paddingHorizontal: 16,
            paddingVertical: 10,
            borderBottomWidth: 1,
            borderBottomColor: C.border,
          },
        ]}
      >
        <Pressable
          style={[S.row, { flex: 1, minWidth: 0 }]}
          accessibilityRole="button"
          accessibilityLabel="View chat participant profile"
          disabled={!liveFriend || model.chat.status !== 'ready'}
          onPress={() => liveFriend && onNavigate({ type: 'player', player: liveFriend })}
        >
          <PlayerAvatar card={friend?.card} catalog={model.catalog} size={40} />
          <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
            <Text style={S.h3} numberOfLines={1}>
              {friend ? playerLabel(friend) : 'Saved conversation'}
              {friend?.tag ? (
                <Text style={{ color: C.subtle, fontWeight: '400' }}> #{friend.tag}</Text>
              ) : null}
            </Text>
            <Text style={S.small} numberOfLines={1}>
              {archive?.status === 'loading'
                ? 'Syncing history…'
                : model.chat.status === 'ready' && liveFriend
                  ? friendStatus(liveFriend)
                  : 'Saved on this device'}
            </Text>
          </View>
        </Pressable>
        <IconButton
          icon="settings"
          label="Conversation settings"
          onPress={() => onNavigate({ type: 'chat-settings', subject })}
        />
        <IconButton icon="x" label="Back from conversation" onPress={onBack} />
      </View>
      <KeyboardAvoidingView style={S.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {model.chat.status !== 'ready' && (
          <View style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
            <Button
              title={
                ['connecting', 'authenticating'].includes(model.chat.status)
                  ? 'Connecting…'
                  : 'Reconnect chat'
              }
              secondary
              disabled={['connecting', 'authenticating'].includes(model.chat.status)}
              onPress={() => void model.connectChat()}
            />
          </View>
        )}
        {archive?.status === 'error' && (
          <Text style={[S.small, { paddingHorizontal: 16, paddingVertical: 6, color: C.gold }]}>
            {archive.message}
          </Text>
        )}
        <FlatList
          ref={list}
          data={reversed}
          inverted={messages.length > 0}
          keyExtractor={key}
          renderItem={renderItem}
          initialNumToRender={16}
          maxToRenderPerBatch={8}
          updateCellsBatchingPeriod={32}
          windowSize={7}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          onScroll={onScroll}
          scrollEventThrottle={64}
          maintainVisibleContentPosition={{ minIndexForVisible: 0, autoscrollToTopThreshold: 40 }}
          contentContainerStyle={{ paddingVertical: 16, flexGrow: 1 }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={{ padding: 16 }}>
              {opening || archive?.status === 'loading' ? (
                <Skeleton kind="chat" label="Loading conversation" />
              ) : (
                <Empty
                  title="No messages saved yet"
                  detail={
                    model.settings.autoChatHistory !== false
                      ? 'Available Riot history syncs automatically when connected.'
                      : 'Automatic sync is off. You can enable it in Settings.'
                  }
                  icon="message-circle"
                />
              )}
            </View>
          }
          ListFooterComponent={
            cursor ? (
              <View style={{ padding: 16 }}>
                <Button
                  title={more ? 'Loading saved messages…' : 'Load older saved messages'}
                  secondary
                  disabled={more}
                  onPress={() => void older()}
                />
              </View>
            ) : null
          }
        />
        {(error || model.chat.storageError) && (
          <Text
            accessibilityRole="alert"
            style={[S.body, { paddingHorizontal: 16, color: C.gold }]}
          >
            {error ?? model.chat.storageError}
          </Text>
        )}
        {confirm ? (
          <View style={{ padding: 16, gap: 10 }}>
            <Text style={S.body}>
              Delete this conversation from this device? Riot’s copy is unchanged.
            </Text>
            <Button title="Delete local messages" onPress={() => void erase()} />
            <Button title="Keep messages" secondary onPress={() => setConfirm(false)} />
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Delete saved conversation"
            onPress={() => setConfirm(true)}
            style={{ paddingHorizontal: 16, paddingVertical: 8 }}
          >
            <Text style={S.small}>Delete saved conversation</Text>
          </Pressable>
        )}
        <View
          style={[
            S.row,
            { padding: 14, alignItems: 'flex-end', borderTopWidth: 1, borderTopColor: C.border },
          ]}
        >
          <TextInput
            value={body}
            onChangeText={setBody}
            maxLength={2000}
            multiline
            accessibilityLabel="Message text"
            placeholder="Write a message…"
            placeholderTextColor={C.subtle}
            style={[S.input, { flex: 1, maxHeight: 130 }]}
          />
          <Button
            title={sending ? '…' : 'Send'}
            disabled={sending || !body.trim() || !liveFriend || model.chat.status !== 'ready'}
            onPress={() => void send()}
            icon="send"
          />
        </View>
      </KeyboardAvoidingView>
    </ModalPage>
  );
}
