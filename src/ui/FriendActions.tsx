import { ChatConnectionNotice } from './ChatConnectionNotice';
import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import type { AppModel } from '../state/useApp';
import type { PlayerRef } from '../core/playerTypes';
import type { FriendAction } from '../core/chatTypes';
import { safeError } from '../core/validation';
import { Button, Badge } from './components';
import { useTheme } from './theme';
export function FriendActions({ model, player }: { model: AppModel; player: PlayerRef }) {
  const { C, S } = useTheme();
  const [confirm, setConfirm] = useState<FriendAction>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const mounted = useRef(true),
    locked = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    setConfirm(undefined);
    setError('');
  }, [player.subject, model.active?.puuid]);
  if (player.hidden || player.subject === model.active?.puuid) return null;
  const connected = model.chat.status === 'ready',
    friend = model.chat.friends.some((f) => f.subject === player.subject);
  const request = model.chat.friendRequests?.find((r) => r.subject === player.subject),
    operation = model.chat.friendActions?.[player.subject];
  const active = busy || operation?.state === 'sending' || operation?.state === 'awaiting';
  const perform = async () => {
    if (!confirm || locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      await model.changeFriend(confirm, player);
      if (mounted.current) setConfirm(undefined);
    } catch (reason) {
      if (mounted.current) {
        setConfirm(undefined);
        setError(safeError(reason).message);
      }
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  if (friend) return <Badge text="FRIENDS" color={C.mint} />;
  return (
    <View style={{ gap: 8 }}>
      {confirm ? (
        <View style={[S.card, { padding: 12, gap: 10 }]}>
          <Text style={S.h3}>
            {confirm === 'add'
              ? 'Send a friend request to'
              : confirm === 'accept'
                ? 'Accept'
                : 'Decline'}{' '}
            {player.name}
            {player.tag ? ' #' + player.tag : ''}?
          </Text>
          <Text style={S.small}>
            From {model.active?.gameName} #{model.active?.tagLine}
          </Text>
          <Button
            title={
              active
                ? 'Waiting for Riot...'
                : confirm === 'add'
                  ? 'Confirm send request'
                  : confirm === 'accept'
                    ? 'Confirm accept request'
                    : 'Confirm decline request'
            }
            disabled={active || !connected}
            onPress={() => void perform()}
          />
          <Button
            title="Cancel friend action"
            secondary
            disabled={active}
            onPress={() => setConfirm(undefined)}
          />
        </View>
      ) : request?.direction === 'outgoing' ? (
        <Text style={[S.small, { color: C.muted }]}>Request sent</Text>
      ) : request?.direction === 'incoming' ? (
        <View style={S.row}>
          <View style={{ flex: 1 }}>
            <Button
              title="Accept"
              label={`Accept request from ${player.name}`}
              disabled={active || !connected}
              onPress={() => setConfirm('accept')}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              secondary
              title="Decline"
              label={`Decline request from ${player.name}`}
              disabled={active || !connected}
              onPress={() => setConfirm('decline')}
            />
          </View>
        </View>
      ) : (
        <Button
          title={active ? 'Waiting for Riot...' : 'Add friend'}
          icon="user-plus"
          secondary
          disabled={active || !connected}
          onPress={() => setConfirm('add')}
        />
      )}
      <ChatConnectionNotice chat={model.chat} />
      {(error || operation?.message) && (
        <Text accessibilityRole="alert" style={[S.small, { color: C.gold }]}>
          {error || operation?.message}
        </Text>
      )}
    </View>
  );
}
