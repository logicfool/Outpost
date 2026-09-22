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
      style={{
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        paddingHorizontal: 11,
        paddingVertical: 7,
        borderRadius: 999,
        backgroundColor: C.raised,
        maxWidth: '100%',
      }}
    >
      {busy && <ActivityIndicator size="small" color={C.subtle} />}
      <Text style={[S.small, { flexShrink: 1 }]}>{chatConnectionLabel(chat)}</Text>
    </View>
  );
}
