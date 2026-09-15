import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { AppModel } from '../state/useApp';
import type { LoadoutPreset, LoadoutEditor, WeaponChoice } from '../core/presets';
import { safeError } from '../core/validation';
import { Button, ModalHeader, ModalPage, ItemArt, Empty, Tabs } from './components';
import { useTheme } from './theme';
export function PresetsPanel({ model, onBack }: { model: AppModel; onBack(): void }) {
  const { C, S } = useTheme();
  const [list, setList] = useState<LoadoutPreset[]>([]),
    [editor, setEditor] = useState<LoadoutEditor | null>(null),
    [weapons, setWeapons] = useState<WeaponChoice[]>([]),
    [name, setName] = useState(''),
    [id, setId] = useState<string>(),
    [slot, setSlot] = useState<string>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>(),
    [confirm, setConfirm] = useState<{ preset: LoadoutPreset; remove?: boolean }>();
  const reload = async () => {
    setBusy(true);
    try {
      setList(await model.listPresets());
    } catch (e) {
      setError(safeError(e).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void reload();
  }, [model.active?.puuid]);
  const begin = async (preset?: LoadoutPreset) => {
    setBusy(true);
    setError(undefined);
    try {
      const data = await model.editLoadout();
      setEditor(data);
      setWeapons(preset?.weapons ?? data.current);
      setName(preset?.name ?? 'New loadout');
      setId(preset?.id);
    } catch (e) {
      setError(safeError(e).message);
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    setBusy(true);
    try {
      await model.savePreset(name, weapons, id);
      setEditor(null);
      await reload();
    } catch (e) {
      setError(safeError(e).message);
    } finally {
      setBusy(false);
    }
  };
  const execute = async () => {
    if (!confirm) return;
    setBusy(true);
    setError(undefined);
    try {
      if (confirm.remove) await model.deletePreset(confirm.preset.id);
      else await model.applyPreset(confirm.preset);
      setError(
        confirm.remove
          ? 'Preset deleted.'
          : model.active?.demo
            ? 'Demo preset selected. No Riot account changed.'
            : 'Riot confirmed every selected weapon skin.',
      );
      setConfirm(undefined);
      await reload();
    } catch (e) {
      setError(safeError(e).message);
    } finally {
      setBusy(false);
    }
  };
  const selected = weapons.find((w) => w.weaponId === slot),
    skin = selected ? model.catalog.items[selected.skinId] : undefined;
  const items = useMemo(() => {
    if (!selected || !editor) return [];
    const unique = new Map();
    for (const item of Object.values(model.catalog.items))
      if (
        item.kind === 'skin' &&
        item.id === item.canonicalId &&
        (item.weaponId === selected.weaponId ||
          (model.active?.demo && item.weapon === skin?.weapon)) &&
        (item.canonicalId === selected.skinId ||
          item.levels?.some((l) => editor.ownedLevels.includes(l.id)))
      )
        unique.set(item.id, item);
    return [...unique.values()] as (typeof skin)[];
  }, [slot, weapons, editor, model.catalog]);
  const update = (values: Partial<WeaponChoice>) =>
    setWeapons((old) => old.map((w) => (w.weaponId === slot ? { ...w, ...values } : w)));
  return (
    <ModalPage>
      <ModalHeader
        title={slot ? 'Choose weapon skin' : editor ? 'Edit loadout' : 'Saved loadouts'}
        closeLabel={
          slot ? 'Back to preset' : editor ? 'Cancel preset editing' : 'Back from loadouts'
        }
        onClose={() => {
          if (busy) return;
          if (slot) setSlot(undefined);
          else if (editor) setEditor(null);
          else onBack();
        }}
      />
      {error && (
        <Text accessibilityRole="alert" style={[S.body, { padding: 16, color: C.gold }]}>
          {error}
        </Text>
      )}
      {slot && selected && editor ? (
        <ScrollView contentContainerStyle={S.content}>
          <Text style={S.h2}>{skin?.weapon ?? 'Weapon'}</Text>
          <Text style={S.small}>
            Only owned skins and unlocked upgrades are available. Buddies stay as currently
            equipped.
          </Text>
          {skin && <ItemArt item={skin} size={110} />}
          {skin?.levels && (
            <>
              <Text style={S.h3}>Level</Text>
              <Tabs
                value={selected.levelId}
                onChange={(levelId) => update({ levelId })}
                items={skin.levels
                  .filter((l) => editor.ownedLevels.includes(l.id) || l.id === selected.levelId)
                  .map((l, n) => ({
                    id: l.id,
                    label: `Level ${skin.levels!.findIndex((v) => v.id === l.id) + 1}`,
                  }))}
              />
            </>
          )}
          {skin?.chromas && (
            <>
              <Text style={S.h3}>Colour</Text>
              <Tabs
                value={selected.chromaId}
                onChange={(chromaId) => update({ chromaId })}
                items={skin.chromas
                  .filter(
                    (c, n) =>
                      n === 0 || editor.ownedChromas.includes(c.id) || c.id === selected.chromaId,
                  )
                  .map((c, n) => ({ id: c.id, label: c.name || `Variant ${n + 1}` }))}
              />
            </>
          )}
          {items.map(
            (item) =>
              item && (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Use ${item.name}`}
                  onPress={() => {
                    const level = item.levels?.find((l) => editor.ownedLevels.includes(l.id));
                    if (item.id === selected.skinId) return;
                    if (level && item.chromas?.[0])
                      update({
                        skinId: item.canonicalId,
                        levelId: level.id,
                        chromaId: item.chromas[0].id,
                      });
                  }}
                  style={S.card}
                >
                  <ItemArt item={item} size={65} />
                  <Text style={S.h3}>{item.name}</Text>
                </Pressable>
              ),
          )}
          <Button title="Done with weapon" onPress={() => setSlot(undefined)} />
        </ScrollView>
      ) : editor ? (
        <FlatList
          data={weapons}
          keyExtractor={(w) => w.weaponId}
          contentContainerStyle={S.content}
          initialNumToRender={8}
          ListHeaderComponent={
            <View style={{ gap: 14 }}>
              <TextInput
                accessibilityLabel="Loadout name"
                placeholder="Loadout name"
                value={name}
                maxLength={48}
                onChangeText={setName}
                style={S.input}
              />
              <Text style={S.small}>
                Create a named set of skins, levels and colours. Applying uses one verified loadout
                update; buddies, identity and sprays stay unchanged.
              </Text>
              <Button
                title="Save loadout"
                disabled={busy || !name.trim()}
                onPress={() => void save()}
              />
            </View>
          }
          renderItem={({ item: w }) => {
            const item = model.catalog.items[w.skinId];
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Edit ${item?.weapon ?? 'weapon'} skin`}
                onPress={() => setSlot(w.weaponId)}
                style={[S.card, S.row]}
              >
                {item && <ItemArt item={item} size={64} style={{ width: 90 }} />}
                <View style={{ flex: 1 }}>
                  <Text style={S.small}>{item?.weapon ?? 'Weapon'}</Text>
                  <Text style={S.h3}>{item?.name ?? 'Equipped skin'}</Text>
                </View>
                <Feather name="chevron-right" size={20} color={C.subtle} />
              </Pressable>
            );
          }}
        />
      ) : (
        <FlatList
          data={list}
          keyExtractor={(p) => p.id}
          contentContainerStyle={S.content}
          refreshControl={
            <RefreshControl
              refreshing={busy}
              onRefresh={() => void reload()}
              tintColor={C.accent}
            />
          }
          ListHeaderComponent={
            <View style={{ gap: 14 }}>
              <Button
                title="Create from equipped loadout"
                icon="plus"
                disabled={busy}
                onPress={() => void begin()}
              />
              {confirm && (
                <View style={S.card}>
                  <Text style={S.h2}>
                    {confirm.remove ? 'Delete' : 'Apply'} {confirm.preset.name}?
                  </Text>
                  <Text style={S.body}>
                    {confirm.remove
                      ? 'This only removes the local preset.'
                      : `${confirm.preset.weapons.length} weapon slots will change on ${model.active?.gameName}. Other equipment is preserved.`}
                  </Text>
                  <Button
                    title={
                      confirm.remove
                        ? 'Confirm delete preset'
                        : model.active?.demo
                          ? 'Apply demo preset'
                          : 'Confirm apply to VALORANT'
                    }
                    disabled={busy}
                    onPress={() => void execute()}
                  />
                  <Button
                    secondary
                    title="Cancel"
                    disabled={busy}
                    onPress={() => setConfirm(undefined)}
                  />
                </View>
              )}
            </View>
          }
          ListEmptyComponent={
            !busy ? (
              <Empty
                title="Build your first loadout"
                detail="Save your current set, customise it here, then equip it with one confirmation."
                icon="layers"
              />
            ) : null
          }
          renderItem={({ item: p }) => (
            <View style={S.card}>
              <View style={S.between}>
                <Text style={S.h2}>{p.name}</Text>
                <Text style={S.small}>{p.weapons.length} slots</Text>
              </View>
              <View style={[S.row, { flexWrap: 'wrap' }]}>
                <View style={{ flex: 1 }}>
                  <Button
                    secondary
                    title="Edit"
                    label={`Edit ${p.name}`}
                    disabled={busy}
                    onPress={() => void begin(p)}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    title="Apply"
                    label={`Apply ${p.name}`}
                    disabled={busy}
                    onPress={() => setConfirm({ preset: p })}
                  />
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Delete ${p.name}`}
                  disabled={busy}
                  onPress={() => setConfirm({ preset: p, remove: true })}
                  style={{ padding: 12 }}
                >
                  <Feather name="trash-2" size={18} color={C.subtle} />
                </Pressable>
              </View>
            </View>
          )}
        />
      )}
    </ModalPage>
  );
}
