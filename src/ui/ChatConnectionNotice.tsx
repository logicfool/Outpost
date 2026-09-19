import React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import type { ChatState } from '../core/chatTypes';
import { chatConnectionLabel } from '../core/chatReconnect';
import { useTheme } from './theme';
export function ChatConnectionNotice({ chat }: { chat: ChatState }) {
  const { C, S } = useTheme();
  if (chat.status === 'ready') return null;
  const busy = chat.status === 'connecting' || chat.status === 'authenticating';
  return (
    <View
      testID="chat-auto-connection"
      accessibilityLiveRegion="polite"
      style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 }}
    >
      {busy && <ActivityIndicator size="small" color={C.subtle} />}
      <Text style={[S.small, { flex: 1 }]}>{chatConnectionLabel(chat)}</Text>
    </View>
  );
}
