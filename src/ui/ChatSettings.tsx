import React, { useEffect, useRef, useState } from 'react';
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
  const mounted = useRef(true),
    locked = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const progress = model.chatHistorySync,
    running = model.syncingSavedHistory;
  const resumable =
    ['paused', 'cancelled'].includes(progress.status) && progress.checked < progress.total;
  const erase = async () => {
    if (!subject || locked.current) return;
    locked.current = true;
    setWorking(true);
    try {
      await model.clearChatHistory(subject);
      if (mounted.current) {
        setConfirm(false);
        setResult('Local messages deleted.');
      }
    } catch (error) {
      if (mounted.current) setResult(safeError(error).message);
    } finally {
      locked.current = false;
      if (mounted.current) setWorking(false);
    }
  };
  const sync = async () => {
    if (locked.current || running) return;
    locked.current = true;
    setResult(undefined);
    if (subject) setWorking(true);
    try {
      if (subject) {
        await model.syncChatHistory(subject);
        if (mounted.current) setResult('History synced.');
      } else await model.syncSavedChatHistory();
    } catch (error) {
      if (mounted.current) setResult(safeError(error).message);
    } finally {
      locked.current = false;
      if (mounted.current) setWorking(false);
    }
  };
  return (
    <View style={{ gap: 14 }}>
      <View style={S.row}>
        <View style={{ flex: 1, gap: 5 }}>
          <Text style={S.h3}>Automatic chat history</Text>
          <Text style={S.small}>Sync the open conversation.</Text>
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
          subject
            ? working
              ? 'Syncing history...'
              : 'Sync this conversation now'
            : running
              ? 'Syncing all friends...'
              : resumable
                ? 'Resume history sync'
                : 'Sync all chat history'
        }
        disabled={working || running || model.chat.status !== 'ready'}
        onPress={() => void sync()}
        icon="refresh-cw"
      />
      {model.chat.status !== 'ready' && <Text style={S.small}>Connect chat to sync.</Text>}
      {!subject && <Text style={S.small}>Checks every friend, one at a time.</Text>}
      {!subject && progress.status !== 'idle' && (
        <View testID="all-friends-sync-progress" style={{ gap: 8 }}>
          <View style={S.between}>
            <Text style={S.h3}>
              {progress.status === 'complete'
                ? 'Sync finished'
                : running
                  ? 'Syncing friends'
                  : progress.status === 'paused'
                    ? 'Sync paused'
                    : 'Sync stopped'}
            </Text>
            <Text style={S.small}>
              {progress.checked} / {progress.total}
            </Text>
          </View>
          <View
            accessibilityRole="progressbar"
            accessibilityLabel="Friends checked"
            accessibilityValue={{ min: 0, max: Math.max(1, progress.total), now: progress.checked }}
            style={{ height: 4, borderRadius: 2, backgroundColor: C.border, overflow: 'hidden' }}
          >
            <View
              style={{
                height: 4,
                backgroundColor: C.accent,
                width: `${progress.total ? (100 * progress.checked) / progress.total : 0}%`,
              }}
            />
          </View>
          {progress.current && (
            <Text numberOfLines={1} style={S.small}>
              Checking {progress.current}
            </Text>
          )}
          <Text style={S.small}>
            {progress.conversations} conversations · {progress.messages} messages returned
            {progress.failed ? ` · ${progress.failed} failed` : ''}
            {progress.skipped ? ` · ${progress.skipped} skipped` : ''}
          </Text>
          {progress.message && <Text style={[S.small, { color: C.gold }]}>{progress.message}</Text>}
          {progress.status === 'complete' && progress.empty > 0 && (
            <Text style={S.small}>{progress.empty} friends had no retained messages.</Text>
          )}
          {model.active?.demo && <Text style={S.small}>Demo - no Riot requests.</Text>}
        </View>
      )}
      {running && (
        <Button
          title="Stop history sync"
          secondary
          onPress={model.cancelChatHistorySync}
          icon="x"
        />
      )}
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
