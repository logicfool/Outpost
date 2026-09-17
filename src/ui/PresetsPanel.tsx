import { BuddyPicker } from './BuddyPicker';
import { MELEE_ID } from '../core/buddies';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { View, Text, TextInput, FlatList, Pressable, RefreshControl } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { AppModel } from '../state/useApp';
import type { CatalogItem } from '../core/types';
import type { LoadoutPreset, LoadoutEditor, WeaponChoice } from '../core/presets';
import { weaponSkins, unlockedLevels, unlockedChromas, chooseSkin } from '../core/loadoutOptions';
import { safeError } from '../core/validation';
import { Button, ModalHeader, ModalPage, ItemArt, Empty, Tabs } from './components';
import { useTheme } from './theme';
export function PresetsPanel({ model, onBack }: { model: AppModel; onBack(): void }) {
  const { C, S } = useTheme();
  const [part, setPart] = useState<'skin' | 'buddy'>('skin');
  const [list, setList] = useState<LoadoutPreset[]>([]),
    [editor, setEditor] = useState<LoadoutEditor | null>(null),
    [weapons, setWeapons] = useState<WeaponChoice[]>([]),
    [name, setName] = useState(''),
    [id, setId] = useState<string>(),
    [slot, setSlot] = useState<string>(),
    [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string>(),
    [confirm, setConfirm] = useState<{ preset: LoadoutPreset; remove?: boolean }>();
  const generation = useRef(0),
    locked = useRef(false);
  useEffect(() => {
    const g = ++generation.current;
    void model
      .listPresets()
      .then((v) => {
        if (g === generation.current) setList(v);
      })
      .catch((e) => {
        if (g === generation.current) setError(safeError(e).message);
      });
    return () => {
      generation.current++;
    };
  }, [model.active?.puuid]);
  const run = async (work: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(undefined);
    const g = generation.current;
    try {
      await work();
    } catch (e) {
      if (g === generation.current) setError(safeError(e).message);
    } finally {
      if (g === generation.current) {
        locked.current = false;
        setBusy(false);
      }
    }
  };
  const reload = async () => {
    const g = generation.current,
      v = await model.listPresets();
    if (g === generation.current) setList(v);
  };
  const begin = (preset?: LoadoutPreset) =>
    run(async () => {
      const g = generation.current,
        data = await model.editLoadout();
      if (g !== generation.current) return;
      setEditor(data);
      const existing = new Map(preset?.weapons.map((w) => [w.weaponId, w]));
      setWeapons(data.current.map((w) => existing.get(w.weaponId) ?? w));
      setName(preset?.name ?? '');
      setId(preset?.id);
      setSlot(undefined);
      setPart('skin');
      setQuery('');
    });
  const save = () =>
    run(async () => {
      const g = generation.current;
      await model.savePreset(name, weapons, id);
      if (g !== generation.current) return;
      setEditor(null);
      await reload();
    });
  const execute = () =>
    run(async () => {
      if (!confirm) return;
      const g = generation.current;
      if (confirm.remove) await model.deletePreset(confirm.preset.id);
      else await model.applyPreset(confirm.preset);
      if (g !== generation.current) return;
      setConfirm(undefined);
      setError(
        confirm.remove
          ? 'Preset deleted.'
          : model.active?.demo
            ? 'Demo loadout applied.'
            : 'Loadout applied.',
      );
      await reload();
    });
  const selected = weapons.find((w) => w.weaponId === slot),
    skin = selected ? model.catalog.items[selected.skinId.toLowerCase()] : undefined;
  const items = useMemo(
    () =>
      selected && editor
        ? weaponSkins(model.catalog, editor, selected.weaponId).filter((i) =>
            i.name.toLowerCase().includes(query.trim().toLowerCase()),
          )
        : [],
    [selected?.weaponId, editor, model.catalog, query],
  );
  const update = (values: Partial<WeaponChoice>) =>
    setWeapons((old) => old.map((w) => (w.weaponId === slot ? { ...w, ...values } : w)));
  const header = (
    <ModalHeader
      title={slot ? (skin?.weapon ?? 'Choose skin') : editor ? 'Edit loadout' : 'Saved loadouts'}
      closeLabel={slot ? 'Back to preset' : editor ? 'Cancel preset editing' : 'Back from loadouts'}
      onClose={() => {
        if (busy) return;
        if (part === 'buddy') {
          setPart('skin');
          return;
        }
        if (slot) {
          setSlot(undefined);
          setQuery('');
        } else if (editor) setEditor(null);
        else onBack();
      }}
    />
  );
  return (
    <ModalPage>
      {header}
      {error && (
        <Text accessibilityRole="alert" style={[S.small, { padding: 16, color: C.gold }]}>
          {error}
        </Text>
      )}
      {slot && selected && editor && part === 'buddy' ? (
        <BuddyPicker
          disabled={busy}
          editor={editor}
          weapons={weapons}
          weaponId={slot}
          selected={
            selected.buddy === undefined
              ? editor.current.find((w) => w.weaponId === slot)?.buddy
              : selected.buddy
          }
          catalog={model.catalog}
          onChange={(buddy) => update({ buddy })}
          onDone={() => setPart('skin')}
        />
      ) : slot && selected && editor ? (
        <FlatList
          key="skin-grid"
          data={items}
          numColumns={2}
          keyExtractor={(i) => i.canonicalId}
          contentContainerStyle={S.content}
          columnWrapperStyle={{ gap: 12 }}
          initialNumToRender={6}
          windowSize={5}
          ListHeaderComponent={
            <View style={{ gap: 14, paddingBottom: 16 }}>
              {skin && (
                <>
                  <ItemArt item={skin} size={100} />
                  <Text style={S.h3}>{skin.name}</Text>
                  <Text style={S.small}>Level</Text>
                  <Tabs
                    value={selected.levelId}
                    onChange={(levelId) => update({ levelId })}
                    items={unlockedLevels(skin, editor).map((l) => ({
                      id: l.id,
                      label: String((skin.levels ?? []).findIndex((v) => v.id === l.id) + 1),
                    }))}
                  />
                  <Text style={S.small}>Colour</Text>
                  <Tabs
                    value={selected.chromaId}
                    onChange={(chromaId) => update({ chromaId })}
                    items={unlockedChromas(skin, editor).map((c) => ({
                      id: c.id,
                      label:
                        /Variant\s+\d+\s+([^)]*)/i.exec(c.name)?.[1]?.trim() ||
                        (c.id === skin.chromas?.[0]?.id
                          ? 'Original'
                          : c.name.replace(skin.name, '').trim()),
                    }))}
                  />
                </>
              )}
              {slot !== MELEE_ID && skin?.weapon !== 'Melee' && skin?.weapon !== 'Blade' && (
                <Button
                  secondary
                  title="Manage buddy"
                  icon="award"
                  onPress={() => setPart('buddy')}
                />
              )}
              {selected.buddy === null && <Text style={S.small}>Buddy will be removed</Text>}
              {selected.buddy && (
                <Text style={S.small}>
                  {model.catalog.items[selected.buddy.buddyId]?.name ?? 'Buddy selected'}
                </Text>
              )}
              <TextInput
                value={query}
                onChangeText={setQuery}
                accessibilityLabel="Search owned skins"
                placeholder="Search owned skins"
                placeholderTextColor={C.subtle}
                style={S.input}
              />
              <View style={S.between}>
                <Text style={S.h3}>Your skins</Text>
                <Text style={S.small}>{items.length}</Text>
              </View>
            </View>
          }
          ListEmptyComponent={
            <Empty
              title="No owned skins found"
              detail="Pull down on Collection to refresh ownership."
            />
          }
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Use ${item.name}`}
              accessibilityState={{ selected: item.canonicalId === selected.skinId }}
              onPress={() => {
                if (item.canonicalId === selected.skinId) return;
                const next = chooseSkin(item, editor);
                if (next) update(next);
              }}
              style={[
                S.card,
                {
                  flex: 1,
                  maxWidth: '49%',
                  gap: 8,
                  padding: 12,
                  borderColor: item.canonicalId === selected.skinId ? C.accent : C.border,
                },
              ]}
            >
              <ItemArt item={item} size={70} />
              <Text style={S.h3} numberOfLines={2}>
                {item.name}
              </Text>
              {item.canonicalId === selected.skinId && (
                <Text style={[S.small, { color: C.accent }]}>Selected</Text>
              )}
            </Pressable>
          )}
          ListFooterComponent={
            <Button
              title="Done with weapon"
              onPress={() => {
                setSlot(undefined);
                setQuery('');
              }}
            />
          }
        />
      ) : editor ? (
        <FlatList
          key="slots"
          data={weapons}
          keyExtractor={(w) => w.weaponId}
          contentContainerStyle={S.content}
          initialNumToRender={8}
          ListHeaderComponent={
            <View style={{ gap: 14 }}>
              <TextInput
                accessibilityLabel="Loadout name"
                placeholder="Loadout name"
                placeholderTextColor={C.subtle}
                value={name}
                maxLength={48}
                onChangeText={setName}
                style={S.input}
              />
              <Text style={S.small}>Tap a weapon to choose from your skins.</Text>
              <Button
                title="Save loadout"
                disabled={busy || !name.trim()}
                onPress={() => void save()}
              />
            </View>
          }
          renderItem={({ item: w }) => {
            const item = model.catalog.items[w.skinId.toLowerCase()];
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Edit ${item?.weapon ?? 'weapon'} skin`}
                onPress={() => {
                  setSlot(w.weaponId);
                  setPart('skin');
                  setQuery('');
                }}
                style={[S.card, S.row]}
              >
                {item && <ItemArt item={item} size={64} style={{ width: 90 }} />}
                <View style={{ flex: 1 }}>
                  <Text style={S.small}>{item?.weapon ?? 'Weapon'}</Text>
                  <Text style={S.h3}>{item?.name ?? 'Choose skin'}</Text>
                </View>
                <Feather name="chevron-right" size={20} color={C.subtle} />
              </Pressable>
            );
          }}
        />
      ) : (
        <FlatList
          key="presets"
          data={list}
          keyExtractor={(p) => p.id}
          contentContainerStyle={S.content}
          refreshControl={
            <RefreshControl
              refreshing={busy}
              onRefresh={() => void run(reload)}
              tintColor={C.accent}
            />
          }
          ListHeaderComponent={
            <View style={{ gap: 14 }}>
              <Button
                title="Create loadout"
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
                      ? 'Remove this saved preset?'
                      : `Change ${confirm.preset.weapons.length} weapon slots on ${model.active?.gameName}? Selected buddy changes are included. Sprays stay.`}
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
                title="Create your first loadout"
                detail="Pick your skins here, then apply them together."
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
              <View style={S.row}>
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
