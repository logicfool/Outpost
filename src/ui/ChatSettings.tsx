import React, { useState } from 'react';
import { Text, View, Switch } from 'react-native';
import type { AppModel } from '../state/useApp';
import { safeError } from '../core/validation';
import { Button } from './components';
import { useTheme } from './theme';
export function ChatSettings({ model, subject }: { model: AppModel; subject?: string }) {
  const { C, S } = useTheme();
  const [working, setWorking] = useState(false),
    [result, setResult] = useState<string>(),
    [confirm, setConfirm] = useState(false);
  const erase = async () => {
    if (!subject || working) return;
    setWorking(true);
    try {
      await model.clearChatHistory(subject);
      setConfirm(false);
      setResult('Local messages deleted.');
    } catch (e) {
      setResult(safeError(e).message);
    } finally {
      setWorking(false);
    }
  };
  const sync = async () => {
    if (working) return;
    setWorking(true);
    setResult(undefined);
    try {
      if (subject) await model.syncChatHistory(subject);
      else await model.syncSavedChatHistory();
      setResult('History synced.');
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
          <Text style={S.small}>Sync the open conversation. Saved chats work offline.</Text>
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
      {model.chat.status !== 'ready' && <Text style={S.small}>Connect chat to sync.</Text>}
      {!subject && <Text style={S.small}>Checks up to 10 recent conversations.</Text>}
      {subject &&
        (confirm ? (
          <View style={{ gap: 10 }}>
            <Text style={S.body}>
              Delete the saved messages on this device? Riot history is unchanged.
            </Text>
            <Button title="Delete local messages" disabled={working} onPress={() => void erase()} />
            <Button
              title="Keep messages"
              secondary
              disabled={working}
              onPress={() => setConfirm(false)}
            />
          </View>
        ) : (
          <Button
            title="Delete saved conversation"
            secondary
            icon="trash-2"
            onPress={() => setConfirm(true)}
          />
        ))}
      {result && (
        <Text accessibilityRole="alert" style={S.body}>
          {result}
        </Text>
      )}
    </View>
  );
}
