import React, { useEffect, useRef, useState } from 'react';
import { Modal, ScrollView, Switch, Text, View } from 'react-native';
import type { AppModel } from '../state/useApp';
import { backupCounts, decodeBackup, encodeBackup, type BackupFile } from '../core/backup';
import { backupHash, saveBackupFile, selectBackupFile } from '../platform/backupFile';
import { AppError, safeError } from '../core/validation';
import { Button, ModalHeader, ModalPage } from './components';
import { useTheme } from './theme';
export function BackupPanel({ model }: { model: AppModel }) {
  const { C, S } = useTheme();
  const [open, setOpen] = useState(false),
    [reports, setReports] = useState(true),
    [restoreSettings, setRestoreSettings] = useState(false);
  const [pending, setPending] = useState<BackupFile>(),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const alive = useRef(true),
    selected = useRef(model.active?.puuid),
    lock = useRef(false),
    generation = useRef(0);
  selected.current = model.active?.puuid;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      generation.current++;
    };
  }, []);
  useEffect(() => {
    generation.current++;
    setPending(undefined);
    setOpen(false);
    setMessage('');
  }, [model.active?.puuid]);
  const run = async (fn: (guard: () => void) => Promise<string>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    const id = selected.current,
      g = generation.current;
    const guard = () => {
      if (!alive.current || selected.current !== id || generation.current !== g)
        throw new AppError(
          'ACCOUNT_CHANGED',
          'The account changed. Start the backup operation again.',
        );
    };
    try {
      const text = await fn(guard);
      guard();
      setMessage(text);
    } catch (e) {
      if (alive.current) setMessage(safeError(e).message);
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const exportFile = () =>
    void run(async (guard) => {
      const data = await model.exportBackupData(reports);
      guard();
      const json = await encodeBackup(data, backupHash);
      guard();
      const name =
        'Outpost-backup-' +
        data.account.puuid.slice(0, 8) +
        '-' +
        new Date().toISOString().replace(/[:.]/g, '-') +
        '.json';
      return saveBackupFile(json, name, guard);
    });
  const chooseFile = () =>
    void run(async (guard) => {
      const text = await selectBackupFile(guard);
      if (text === null) return 'Restore cancelled.';
      const file = await decodeBackup(text, backupHash);
      guard();
      setPending(file);
      setRestoreSettings(false);
      return '';
    });
  const counts = pending ? backupCounts(pending.data) : null,
    matching = pending?.data.account.puuid === model.active?.puuid;
  return (
    <>
      <Button title="Backup & restore" secondary icon="save" onPress={() => setOpen(true)} />
      <Modal
        visible={open}
        animationType="slide"
        onRequestClose={() => {
          if (!busy) {
            setOpen(false);
            setPending(undefined);
          }
        }}
      >
        <ModalPage>
          <ModalHeader
            title="Backup & restore"
            closeLabel="Close backup and restore"
            onClose={() => {
              if (!busy) {
                setOpen(false);
                setPending(undefined);
              }
            }}
          />
          <ScrollView contentContainerStyle={S.content}>
            <Text style={S.h2}>
              {model.active?.gameName} #{model.active?.tagLine}
            </Text>
            {pending ? (
              <View style={S.card}>
                <Text style={S.h3}>
                  Restore {pending.data.account.gameName} #{pending.data.account.tagLine}?
                </Text>
                <Text style={S.small}>{new Date(pending.createdAt).toLocaleString()}</Text>
                <Text style={S.body}>
                  {counts?.loadouts} loadouts - {counts?.aimPresets} aim presets
                </Text>
                <Text style={S.body}>
                  {counts?.matches} matches - {counts?.reports} full reports
                </Text>
                <Text style={S.body}>
                  {counts?.nightMarkets} Night Markets - {counts?.storeRotations} daily stores -{' '}
                  {counts?.bundles} bundles
                </Text>
                <Text style={S.small}>
                  Merge saved data into this account. Existing entries win. No settings are sent to
                  Riot.
                </Text>
                {!matching && (
                  <Text style={[S.body, { color: C.gold }]}>
                    Switch to the Riot account named in this backup first.
                  </Text>
                )}
                <View style={S.between}>
                  <Text style={[S.body, { flex: 1 }]}>Restore app preferences</Text>
                  <Switch
                    accessibilityLabel="Restore app preferences"
                    value={restoreSettings}
                    onValueChange={setRestoreSettings}
                  />
                </View>
                <Text style={S.small}>Phone-purchase permission is not changed.</Text>
                <Button
                  title={busy ? 'Restoring...' : 'Confirm restore backup'}
                  disabled={busy || !matching}
                  onPress={() =>
                    void run(async (guard) => {
                      guard();
                      await model.restoreBackupData(pending.data, restoreSettings);
                      guard();
                      setPending(undefined);
                      return 'Backup restored. Existing entries and sign-in sessions were kept.';
                    })
                  }
                />
                <Button
                  title="Cancel restore"
                  secondary
                  disabled={busy}
                  onPress={() => setPending(undefined)}
                />
              </View>
            ) : (
              <>
                <View style={S.card}>
                  <Text style={S.h3}>Keep your data</Text>
                  <Text style={S.body}>
                    Loadouts, buddies, aim presets, wishlist, saved matches, profile and observed
                    store history.
                  </Text>
                  <View style={S.between}>
                    <Text style={[S.body, { flex: 1 }]}>Include full match reports</Text>
                    <Switch
                      accessibilityLabel="Include full match reports"
                      value={reports}
                      onValueChange={setReports}
                    />
                  </View>
                  <Button
                    title={busy ? 'Working...' : 'Export account backup'}
                    icon="download"
                    disabled={busy}
                    onPress={exportFile}
                  />
                </View>
                <View style={S.card}>
                  <Text style={S.h3}>Restore a backup</Text>
                  <Text style={S.body}>
                    Sign in to the same Riot account, then choose your backup file.
                  </Text>
                  <Button
                    title="Choose backup file"
                    secondary
                    icon="upload"
                    disabled={busy}
                    onPress={chooseFile}
                  />
                </View>
                <Text style={S.small}>
                  Save the file outside Outpost, such as Downloads or your private cloud drive, so
                  it survives uninstall. Backups are not encrypted. Sign-in tokens, cookies, chat
                  messages and pending purchases are not included.
                </Text>
              </>
            )}
            {message && (
              <Text accessibilityRole="alert" style={[S.body, { color: C.gold }]}>
                {message}
              </Text>
            )}
          </ScrollView>
        </ModalPage>
      </Modal>
    </>
  );
}
