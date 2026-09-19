import React from 'react';
import { Platform, Switch, Text, View } from 'react-native';
import type { AppModel } from '../state/useApp';
import { useTheme } from './theme';
export function HistoryBackgroundOption({ model }: { model: AppModel }) {
  const { C, S } = useTheme();
  return (
    <View style={{ gap: 8 }}>
      {Platform.OS === 'android' && (
        <View style={S.row}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={S.h3}>Continue in background</Text>
            <Text style={S.small}>Shows a quiet progress notification.</Text>
          </View>
          <Switch
            accessibilityLabel="Continue history sync in background"
            disabled={model.syncingSavedHistory || model.historySyncStarting}
            value={model.settings.backgroundChatHistory !== false}
            onValueChange={(v) => void model.setBackgroundChatHistory(v)}
            trackColor={{ false: C.border, true: C.accent }}
            thumbColor="#FFFFFF"
          />
        </View>
      )}
      {model.historyBackground?.active && (
        <Text testID="background-history-active" style={[S.small, { color: C.mint }]}>
          Background sync active. You can use other apps.
        </Text>
      )}
      {model.historyBackground?.note && <Text style={S.small}>{model.historyBackground.note}</Text>}
    </View>
  );
}
