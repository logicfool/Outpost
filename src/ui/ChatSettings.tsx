import React, { useState } from 'react';
import { Text, View, Switch } from 'react-native';
import type { AppModel } from '../state/useApp';
import { safeError } from '../core/validation';
import { Button } from './components';
import { useTheme } from './theme';
export function ChatSettings({ model, subject }: { model: AppModel; subject?: string }) {
  const { C, S } = useTheme();
  const [working, setWorking] = useState(false),
    [result, setResult] = useState<string>();
  const sync = async () => {
    if (working) return;
    setWorking(true);
    setResult(undefined);
    try {
      if (subject) await model.syncChatHistory(subject);
      else await model.syncSavedChatHistory();
      setResult('History sync completed. Only messages retained by Riot can be retrieved.');
    } catch (reason) {
      setResult(safeError(reason).message);
    } finally {
      setWorking(false);
    }
  };
  return (
    <View style={{ gap: 14 }}>
      <View style={S.row}>
        <View style={{ flex: 1, gap: 5 }}>
          <Text style={S.h3}>Automatic chat history</Text>
          <Text style={S.small}>
            Sync on opening and reconnecting, then at most once a minute while this conversation
            stays open. Saved messages remain available offline.
          </Text>
        </View>
        <Switch
          accessibilityLabel="Automatic chat history"
          value={model.settings.autoChatHistory !== false}
          onValueChange={(v) => void model.setAutoChatHistory(v)}
          trackColor={{ false: C.border, true: C.accent }}
          thumbColor="#FFFFFF"
        />
      </View>
      <Button
        secondary
        title={
          working
            ? 'Syncing history…'
            : subject
              ? 'Sync this conversation now'
              : 'Sync saved chat history'
        }
        disabled={working || model.syncingSavedHistory || model.chat.status !== 'ready'}
        onPress={() => void sync()}
        icon="refresh-cw"
      />
      {model.chat.status !== 'ready' && (
        <Text style={S.small}>
          Connect chat to sync. Local history is not deleted when you disconnect.
        </Text>
      )}
      {!subject && (
        <Text style={S.small}>
          Manual sync checks up to ten recent saved conversations with current friends. Opening any
          other conversation syncs it automatically.
        </Text>
      )}
      {result && (
        <Text accessibilityRole="alert" style={S.body}>
          {result}
        </Text>
      )}
    </View>
  );
}
