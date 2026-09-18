import React, { useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { AppModel } from '../state/useApp';
import type { AimEdit, AimPreset, Sensitivity } from '../core/aimTypes';
import {
  defaultCrosshair,
  importCrosshairCode,
  validateCrosshair,
  type Crosshair,
} from '../core/crosshair';
import { validateSensitivity } from '../core/aimSettings';
import { safeError, AppError } from '../core/validation';
import { CrosshairPreview } from './CrosshairPreview';
import { CrosshairFields, SensitivityFields, sensitivityText, readSensitivity } from './AimEditor';
import { Badge, Button, Empty, ModalHeader, ModalPage, Tabs } from './components';
import { Skeleton } from './Skeleton';
import { useTheme } from './theme';
export type AimTab = 'crosshairs' | 'sensitivity' | 'presets';
type Editor = {
  profile: Crosshair;
  index?: number;
  revision: string;
  preset: boolean;
  presetId?: string;
  name: string;
  sensi: ReturnType<typeof sensitivityText>;
};
export function AimPanel({
  model,
  initialTab = 'crosshairs',
  onBack,
}: {
  model: AppModel;
  initialTab?: AimTab;
  onBack(): void;
}) {
  const { C, S } = useTheme(),
    state = model.aimState,
    snapshot = state.snapshot;
  const [tab, setTab] = useState(initialTab),
    [editor, setEditor] = useState<Editor>(),
    [importing, setImporting] = useState(false),
    [code, setCode] = useState(''),
    [importName, setImportName] = useState('Imported crosshair');
  const [sensi, setSensi] = useState(sensitivityText(snapshot?.sensitivity)),
    dirty = useRef(false),
    sensRevision = useRef(snapshot?.revision ?? '');
  const [confirm, setConfirm] = useState<AimEdit>(),
    [closed, setClosed] = useState(false),
    [deleting, setDeleting] = useState<AimPreset>(),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const alive = useRef(true),
    lock = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!dirty.current) {
      setSensi(sensitivityText(snapshot?.sensitivity));
      sensRevision.current = snapshot?.revision ?? '';
    }
  }, [snapshot?.revision]);
  const run = async (work: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await work();
    } catch (e) {
      if (alive.current) setError(safeError(e).message);
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const refresh = () =>
    void run(async () => {
      await model.syncAim('manual');
    });
  const editCrosshair = (profile: Crosshair, index?: number) => {
    setError('');
    setMessage('');
    setEditor({
      profile: structuredCloneSafe(profile),
      index,
      revision: snapshot?.revision ?? '',
      preset: false,
      name: profile.profileName,
      sensi: sensitivityText(snapshot?.sensitivity),
    });
  };
  const editPreset = (preset?: AimPreset) => {
    setError('');
    setEditor({
      profile: structuredCloneSafe(
        preset?.profile ??
          snapshot?.crosshairs.find((p) => p.index === snapshot.current)?.profile ??
          defaultCrosshair('Precision'),
      ),
      revision: snapshot?.revision ?? '',
      preset: true,
      presetId: preset?.id,
      name: preset?.name ?? '',
      sensi: sensitivityText(preset?.sensitivity ?? snapshot?.sensitivity),
    });
  };
  const requestApply = (edit: AimEdit) => {
    try {
      if (!snapshot) throw new AppError('AIM_SYNC', 'Sync Riot aim settings before applying.');
      if (edit.sensitivity) validateSensitivity(edit.sensitivity);
      if (edit.crosshair) validateCrosshair(edit.crosshair.profile);
      setConfirm(edit);
      setClosed(false);
      setError('');
    } catch (e) {
      setError(safeError(e).message);
    }
  };
  const applyPreset = (p: AimPreset) => {
    if (!snapshot) {
      setError('Pull down to sync Riot settings first.');
      return;
    }
    const name = ('Outpost - ' + p.name).slice(0, 48),
      matches = snapshot.crosshairs.filter((c) => c.name === name);
    if (matches.length > 1) {
      setError('Two Riot crosshairs have this preset name. Rename one before applying.');
      return;
    }
    requestApply({
      expectedRevision: snapshot.revision,
      sensitivity: p.sensitivity,
      crosshair: {
        profile: { ...p.profile, profileName: name },
        index: matches[0]?.index,
        select: true,
      },
    });
  };
  const apply = () =>
    void run(async () => {
      if (!confirm) return;
      const result = await model.applyAim(confirm, closed || !!model.active?.demo);
      if (!alive.current) return;
      setConfirm(undefined);
      if (result.error) {
        setError(result.error.message);
        return;
      }
      dirty.current = false;
      setEditor(undefined);
      setMessage(
        model.active?.demo
          ? 'Demo aim settings applied.'
          : 'Saved to Riot. Start VALORANT to load the settings.',
      );
    });
  const back = () => {
    if (busy) return;
    if (confirm) {
      setConfirm(undefined);
      return;
    }
    if (deleting) {
      setDeleting(undefined);
      return;
    }
    if (importing) {
      setImporting(false);
      return;
    }
    if (editor) {
      setEditor(undefined);
      return;
    }
    onBack();
  };
  const header = (
    <ModalHeader
      title={
        confirm
          ? 'Apply aim settings'
          : deleting
            ? 'Delete aim preset'
            : importing
              ? 'Import crosshair'
              : editor
                ? editor.preset
                  ? 'Edit aim preset'
                  : 'Edit crosshair'
                : 'Aim settings'
      }
      closeLabel={
        confirm ? 'Cancel aim apply' : editor ? 'Back from aim editor' : 'Back from aim settings'
      }
      onClose={back}
    />
  );
  if (confirm)
    return (
      <ModalPage>
        {header}
        <ScrollView contentContainerStyle={S.content}>
          <View style={S.card}>
            <Text style={S.h2}>
              {model.active?.gameName} #{model.active?.tagLine}
            </Text>
            {confirm.crosshair && (
              <>
                <CrosshairPreview profile={confirm.crosshair.profile} />
                <Text style={S.h3}>{confirm.crosshair.profile.profileName}</Text>
                <Text style={S.small}>Save into</Text>
                <Tabs
                  value={
                    confirm.crosshair.index === undefined ? 'new' : String(confirm.crosshair.index)
                  }
                  onChange={(target) =>
                    setConfirm({
                      ...confirm,
                      crosshair: {
                        ...confirm.crosshair!,
                        index: target === 'new' ? undefined : Number(target),
                      },
                    })
                  }
                  items={[
                    ...(snapshot!.crosshairs.length < 15
                      ? [{ id: 'new', label: 'New Riot slot' }]
                      : []),
                    ...snapshot!.crosshairs.map((p) => ({ id: String(p.index), label: p.name })),
                  ]}
                />
                <Text style={S.small}>
                  {confirm.crosshair.index === undefined
                    ? 'Adds and selects a new crosshair.'
                    : 'Replaces the selected Riot crosshair. Other slots stay unchanged.'}
                </Text>
              </>
            )}
            {confirm.sensitivity && (
              <Text style={S.body}>
                Sensitivity {confirm.sensitivity.hipfire} - ADS {confirm.sensitivity.ads} - Scoped{' '}
                {confirm.sensitivity.scoped}
              </Text>
            )}
            <Text style={S.body}>
              Close VALORANT first. The game loads these cloud settings on its next start.
            </Text>
            {!model.active?.demo && (
              <View style={S.between}>
                <Text style={[S.body, { flex: 1 }]}>VALORANT is closed</Text>
                <Switch
                  accessibilityLabel="VALORANT is closed"
                  value={closed}
                  onValueChange={setClosed}
                />
              </View>
            )}
            {error && (
              <Text accessibilityRole="alert" style={[S.small, { color: C.gold }]}>
                {error}
              </Text>
            )}
            <Button
              title={
                busy
                  ? 'Saving...'
                  : model.active?.demo
                    ? 'Confirm apply demo aim'
                    : 'Confirm apply to Riot'
              }
              disabled={
                busy ||
                (!closed && !model.active?.demo) ||
                (!!confirm.crosshair &&
                  confirm.crosshair.index === undefined &&
                  (snapshot?.crosshairs.length ?? 0) >= 15)
              }
              onPress={apply}
            />
            <Button
              secondary
              title="Cancel aim change"
              disabled={busy}
              onPress={() => setConfirm(undefined)}
            />
          </View>
        </ScrollView>
      </ModalPage>
    );
  if (deleting)
    return (
      <ModalPage>
        {header}
        <View style={S.content}>
          <Text style={S.h2}>Delete {deleting.name}?</Text>
          <Text style={S.small}>Only the saved preset in Outpost is removed.</Text>
          <Button
            title="Delete aim preset"
            disabled={busy}
            onPress={() =>
              void run(async () => {
                await model.deleteAimPreset(deleting.id);
                if (alive.current) setDeleting(undefined);
              })
            }
          />
          <Button secondary title="Keep aim preset" onPress={() => setDeleting(undefined)} />
          {error && <Text style={S.small}>{error}</Text>}
        </View>
      </ModalPage>
    );
  if (importing)
    return (
      <ModalPage>
        {header}
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={S.content}>
          <TextInput
            accessibilityLabel="Imported crosshair name"
            value={importName}
            maxLength={48}
            onChangeText={setImportName}
            style={S.input}
            placeholder="Name"
            placeholderTextColor={C.subtle}
          />
          <TextInput
            accessibilityLabel="Import crosshair code"
            value={code}
            onChangeText={setCode}
            maxLength={4096}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="0;P;..."
            placeholderTextColor={C.subtle}
            style={[S.input, { minHeight: 110, textAlignVertical: 'top' }]}
          />
          {error && (
            <Text accessibilityRole="alert" style={[S.small, { color: C.gold }]}>
              {error}
            </Text>
          )}
          <Button
            title="Preview imported crosshair"
            icon="crosshair"
            onPress={() => {
              try {
                const profile = importCrosshairCode(code, importName);
                editCrosshair(profile);
                setImporting(false);
              } catch (e) {
                setError(safeError(e).message);
              }
            }}
          />
          <Text style={S.small}>Importing does not change Riot settings.</Text>
        </ScrollView>
      </ModalPage>
    );
  if (editor)
    return (
      <ModalPage>
        {header}
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={S.content}>
          {editor.preset && (
            <TextInput
              accessibilityLabel="Aim preset name"
              value={editor.name}
              onChangeText={(name) => setEditor({ ...editor, name })}
              maxLength={48}
              style={S.input}
              placeholder="Preset name"
              placeholderTextColor={C.subtle}
            />
          )}
          <CrosshairFields
            profile={editor.profile}
            onChange={(profile) => setEditor({ ...editor, profile })}
          />
          {editor.preset && (
            <View style={S.card}>
              <Text style={S.h3}>Sensitivity</Text>
              <SensitivityFields
                value={editor.sensi}
                onChange={(sensi) => setEditor({ ...editor, sensi })}
              />
            </View>
          )}
          {error && (
            <Text accessibilityRole="alert" style={[S.small, { color: C.gold }]}>
              {error}
            </Text>
          )}
          {editor.preset ? (
            <Button
              title="Save aim preset"
              disabled={busy}
              onPress={() =>
                void run(async () => {
                  await model.saveAimPreset(
                    editor.name,
                    editor.profile,
                    readSensitivity(editor.sensi),
                    editor.presetId,
                  );
                  if (alive.current) {
                    setEditor(undefined);
                    setTab('presets');
                    setMessage('Aim preset saved on this device.');
                  }
                })
              }
            />
          ) : (
            <>
              <Button
                title="Use this crosshair"
                disabled={busy || model.aimLoading || !snapshot || !!state.pending}
                onPress={() =>
                  requestApply({
                    expectedRevision: editor.revision,
                    crosshair: { profile: editor.profile, index: editor.index, select: true },
                  })
                }
              />
              <Button
                title="Save with sensitivity as preset"
                secondary
                onPress={() =>
                  setEditor({ ...editor, preset: true, name: editor.profile.profileName })
                }
              />
            </>
          )}
        </ScrollView>
      </ModalPage>
    );
  const rows: (
    | { kind: 'crosshair'; index: number; name: string; profile?: Crosshair; issue?: string }
    | { kind: 'preset'; preset: AimPreset }
  )[] =
    tab === 'crosshairs'
      ? (snapshot?.crosshairs ?? []).map((p) => ({ kind: 'crosshair', ...p }))
      : tab === 'presets'
        ? model.aimPresets.map((preset) => ({ kind: 'preset', preset }))
        : [];
  return (
    <ModalPage>
      {header}
      <FlatList
        data={rows}
        keyExtractor={(row) => (row.kind === 'preset' ? row.preset.id : String(row.index))}
        initialNumToRender={6}
        windowSize={5}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={S.content}
        refreshControl={
          <RefreshControl
            refreshing={busy || (model.aimLoading && !!snapshot)}
            onRefresh={refresh}
            tintColor={C.accent}
          />
        }
        ListHeaderComponent={
          <View style={{ gap: 14 }}>
            <Tabs
              value={tab}
              onChange={setTab}
              items={[
                { id: 'crosshairs', label: 'Crosshairs' },
                { id: 'sensitivity', label: 'Sensitivity' },
                { id: 'presets', label: 'Aim presets' },
              ]}
            />
            <Text style={S.small}>
              {snapshot
                ? `Synced ${new Date(snapshot.fetchedAt).toLocaleString()}`
                : 'Pull down to sync Riot settings'}
            </Text>
            {(error || state.error) && (
              <Text accessibilityRole="alert" style={[S.small, { color: C.gold }]}>
                {error || state.error?.message}
              </Text>
            )}
            {message && (
              <Text accessibilityRole="alert" style={[S.small, { color: C.mint }]}>
                {message}
              </Text>
            )}
            {state.pending && (
              <View style={S.card}>
                <Text style={S.h3}>Check the last change</Text>
                <Text style={S.small}>
                  Pull down after a minute to check Riot. No change is automatically resent.
                </Text>
                <Button
                  secondary
                  title="Keep current Riot settings"
                  onPress={() =>
                    void run(async () => {
                      await model.acceptAimServerState();
                    })
                  }
                />
              </View>
            )}
            {tab === 'crosshairs' && (
              <View style={S.row}>
                <View style={{ flex: 1 }}>
                  <Button
                    title="New crosshair"
                    icon="plus"
                    onPress={() => editCrosshair(defaultCrosshair())}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    secondary
                    title="Import code"
                    icon="download"
                    onPress={() => {
                      setImporting(true);
                      setError('');
                    }}
                  />
                </View>
              </View>
            )}
            {tab === 'presets' && (
              <Button title="Create aim preset" icon="plus" onPress={() => editPreset()} />
            )}
            {tab === 'sensitivity' &&
              (model.aimLoading && !snapshot ? (
                <Skeleton kind="progress" label="Loading sensitivity" />
              ) : (
                <View style={S.card}>
                  <Text style={S.h3}>Mouse sensitivity</Text>
                  <SensitivityFields
                    value={sensi}
                    onChange={(value) => {
                      dirty.current = true;
                      setSensi(value);
                    }}
                  />
                  <Text style={S.small}>
                    Mouse DPI is a hardware setting and is not changed here.
                  </Text>
                  <Button
                    title="Apply sensitivity"
                    disabled={busy || model.aimLoading || !snapshot || !!state.pending}
                    onPress={() => {
                      try {
                        requestApply({
                          expectedRevision: sensRevision.current,
                          sensitivity: readSensitivity(sensi),
                        });
                      } catch (e) {
                        setError(safeError(e).message);
                      }
                    }}
                  />
                </View>
              ))}
          </View>
        }
        ListEmptyComponent={
          tab === 'crosshairs' ? (
            model.aimLoading && !snapshot ? (
              <Skeleton kind="row" count={3} label="Loading crosshairs" />
            ) : (
              <Empty
                title={snapshot ? 'No Riot crosshairs returned' : 'Aim settings not synced'}
                detail="Pull down to refresh. You can still create or import a preset."
                icon="crosshair"
              />
            )
          ) : tab === 'presets' ? (
            <Empty
              title="Keep your aim setups together"
              detail="Pair a crosshair with sensitivity, ADS and scoped multipliers."
              icon="sliders"
            />
          ) : null
        }
        renderItem={({ item }) =>
          item.kind === 'crosshair' ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Edit crosshair ${item.name}`}
              disabled={!item.profile}
              onPress={() => item.profile && editCrosshair(item.profile, item.index)}
              style={[S.card, S.row, { padding: 12, gap: 12 }]}
            >
              {item.profile ? (
                <CrosshairPreview compact profile={item.profile} />
              ) : (
                <Feather name="alert-circle" size={26} color={C.subtle} />
              )}
              <View style={{ flex: 1, gap: 5 }}>
                <Text style={S.h3}>{item.name}</Text>
                {item.issue ? (
                  <Text style={S.small}>{item.issue}</Text>
                ) : snapshot?.current === item.index ? (
                  <Badge text="ACTIVE" color={C.mint} />
                ) : (
                  <Text style={S.small}>Riot profile {item.index + 1}</Text>
                )}
              </View>
              <Feather name="chevron-right" size={18} color={C.subtle} />
            </Pressable>
          ) : (
            <View style={[S.card, { padding: 12, gap: 10 }]}>
              <View style={S.row}>
                <CrosshairPreview compact profile={item.preset.profile} />
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={S.h3}>{item.preset.name}</Text>
                  <Text style={S.small}>
                    Sensi {item.preset.sensitivity.hipfire} - ADS {item.preset.sensitivity.ads} -
                    Scope {item.preset.sensitivity.scoped}
                  </Text>
                </View>
              </View>
              <View style={S.row}>
                <View style={{ flex: 1 }}>
                  <Button
                    secondary
                    title="Edit"
                    label={`Edit aim preset ${item.preset.name}`}
                    onPress={() => editPreset(item.preset)}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    title="Apply"
                    label={`Apply aim preset ${item.preset.name}`}
                    disabled={busy || model.aimLoading || !snapshot || !!state.pending}
                    onPress={() => applyPreset(item.preset)}
                  />
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Delete aim preset ${item.preset.name}`}
                  onPress={() => setDeleting(item.preset)}
                  style={{ padding: 12 }}
                >
                  <Feather name="trash-2" size={18} color={C.subtle} />
                </Pressable>
              </View>
            </View>
          )
        }
      />
    </ModalPage>
  );
}
function structuredCloneSafe(profile: Crosshair): Crosshair {
  return JSON.parse(JSON.stringify(profile));
}
