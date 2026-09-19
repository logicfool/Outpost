import { ChatConnectionNotice } from './ChatConnectionNotice';
import React, { useMemo, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import type { AppModel } from '../state/useApp';
import { FriendActions } from './FriendActions';
import { PlayerAvatar } from './PlayerAvatar';
import { Button, Empty, ModalHeader, ModalPage, Tabs } from './components';
import { Skeleton } from './Skeleton';
import { useTheme } from './theme';
export function FriendRequestsPanel({ model, onBack }: { model: AppModel; onBack(): void }) {
  const { C, S } = useTheme(),
    [filter, setFilter] = useState<'incoming' | 'outgoing'>('incoming');
  const rows = useMemo(
    () => (model.chat.friendRequests ?? []).filter((r) => r.direction === filter),
    [model.chat.friendRequests, filter],
  );
  const connected = model.chat.status === 'ready',
    busy = ['connecting', 'authenticating'].includes(model.chat.status);
  return (
    <ModalPage>
      <ModalHeader
        title="Friend requests"
        closeLabel="Back from friend requests"
        onClose={onBack}
      />
      <FlatList
        data={rows}
        keyExtractor={(r) => r.subject}
        initialNumToRender={8}
        windowSize={5}
        contentContainerStyle={S.content}
        ListHeaderComponent={
          <View style={{ gap: 10 }}>
            <Tabs
              value={filter}
              onChange={setFilter}
              items={[
                {
                  id: 'incoming',
                  label: `Incoming (${(model.chat.friendRequests ?? []).filter((r) => r.direction === 'incoming').length})`,
                },
                {
                  id: 'outgoing',
                  label: `Sent (${(model.chat.friendRequests ?? []).filter((r) => r.direction === 'outgoing').length})`,
                },
              ]}
            />
            <ChatConnectionNotice chat={model.chat} />
          </View>
        }
        renderItem={({ item }) => (
          <View style={[S.card, { padding: 12, gap: 12 }]}>
            <View style={S.row}>
              <PlayerAvatar card={item.card} catalog={model.catalog} size={40} />
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={S.h3}>
                  {item.name}
                  {item.tag ? <Text style={{ color: C.subtle }}> #{item.tag}</Text> : null}
                </Text>
                <Text style={S.small}>
                  {item.direction === 'incoming' ? 'Wants to be friends' : 'Waiting for acceptance'}
                </Text>
              </View>
            </View>
            <FriendActions model={model} player={item} />
          </View>
        )}
        ListEmptyComponent={
          busy ? (
            <Skeleton kind="row" count={3} label="Loading friend requests" />
          ) : (
            <Empty
              title={filter === 'incoming' ? 'No incoming requests' : 'No sent requests'}
              detail={
                connected
                  ? 'Requests update through your Riot chat connection.'
                  : 'Requests update when the connection returns.'
              }
              icon="user-plus"
            />
          )
        }
      />
    </ModalPage>
  );
}
