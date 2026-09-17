import { Skeleton } from './Skeleton';
import React, { useEffect, useState, useRef } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { AppModel } from '../state/useApp';
import type { LoadoutEditor } from '../core/presets';
import { MELEE_ID, type BuddyChoice } from '../core/buddies';
import { safeError } from '../core/validation';
import { BuddyPicker } from './BuddyPicker';
import { Button, ItemArt, ModalHeader, ModalPage } from './components';
import { useTheme } from './theme';
export function BuddiesPanel({ model, onBack }: { model: AppModel; onBack(): void }) {
  const { C, S } = useTheme(),
    [editor, setEditor] = useState<LoadoutEditor>(),
    [slot, setSlot] = useState<string>(),
    [pick, setPick] = useState<BuddyChoice | null>(),
    [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string>(),
    alive = useRef(true),
    locked = useRef(false),
    applying = useRef(false);
  const reload = async () => {
    const value = await model.editLoadout();
    if (alive.current) setEditor(value);
  };
  const run = async (work: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await work();
    } catch (e) {
      if (alive.current) setError(safeError(e).message);
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  };
  useEffect(() => {
    alive.current = true;
    void run(reload);
    return () => {
      alive.current = false;
    };
  }, [model.active?.puuid]);
  const selected = editor?.current.find((w) => w.weaponId === slot),
    item = selected && model.catalog.items[selected.skinId];
  const apply = () =>
    run(async () => {
      applying.current = true;
      try {
        if (!slot || pick === undefined) return;
        await model.applyBuddy(slot, pick, editor?.version);
        if (alive.current) {
          setConfirm(false);
          setSlot(undefined);
          setPick(undefined);
        }
        await reload();
      } finally {
        applying.current = false;
      }
    });
  return (
    <ModalPage>
      <ModalHeader
        title={slot ? `${item?.weapon ?? 'Weapon'} buddy` : 'Weapon buddies'}
        closeLabel="Back from buddy manager"
        onClose={() => {
          if (applying.current) return;
          if (slot) {
            setSlot(undefined);
            setConfirm(false);
          } else onBack();
        }}
      />
      {error && (
        <Text accessibilityRole="alert" style={[S.body, { padding: 16, color: C.gold }]}>
          {error}
        </Text>
      )}
      {confirm && (
        <View style={[S.card, { width: 'auto', margin: 16 }]}>
          <Text style={S.h3}>{pick ? 'Equip this buddy?' : 'Remove this buddy?'}</Text>
          <Text style={S.small}>Only this weapon's buddy changes.</Text>
          <Button
            title={busy ? 'Applying...' : 'Confirm buddy change'}
            disabled={busy}
            onPress={() => void apply()}
          />
          <Button
            secondary
            title="Cancel buddy change"
            disabled={busy}
            onPress={() => setConfirm(false)}
          />
        </View>
      )}
      {slot && editor ? (
        <BuddyPicker
          disabled={busy}
          editor={editor}
          weapons={editor.current}
          weaponId={slot}
          selected={pick === undefined ? selected?.buddy : pick}
          catalog={model.catalog}
          onChange={(value) => {
            setPick(value);
            setConfirm(false);
          }}
          onDone={() => {
            if (pick !== undefined) setConfirm(true);
            else setSlot(undefined);
          }}
        />
      ) : (
        <FlatList
          data={
            editor?.current.filter(
              (w) =>
                w.weaponId !== MELEE_ID &&
                model.catalog.items[w.skinId]?.weapon !== 'Melee' &&
                model.catalog.items[w.skinId]?.weapon !== 'Blade',
            ) ?? []
          }
          keyExtractor={(w) => w.weaponId}
          contentContainerStyle={S.content}
          initialNumToRender={8}
          refreshControl={
            <RefreshControl
              refreshing={busy}
              onRefresh={() => void run(reload)}
              tintColor={C.accent}
            />
          }
          ListEmptyComponent={
            busy || (!editor && !error) ? (
              <Skeleton kind="loadout" count={4} label="Loading weapon buddies" />
            ) : (
              <Text style={S.body}>
                {error ? 'Pull down to try again.' : 'No weapon slots available.'}
              </Text>
            )
          }
          renderItem={({ item: w }) => {
            const skin = model.catalog.items[w.skinId],
              buddy = w.buddy ? model.catalog.items[w.buddy.buddyId] : undefined;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Manage ${skin?.weapon ?? 'weapon'} buddy`}
                onPress={() => {
                  setSlot(w.weaponId);
                  setPick(undefined);
                }}
                style={[S.card, S.row, { padding: 12 }]}
              >
                {skin && <ItemArt item={skin} size={55} style={{ width: 100 }} />}
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={S.h3}>{skin?.weapon ?? 'Weapon'}</Text>
                  <Text style={S.small}>{buddy?.name ?? 'No buddy'}</Text>
                </View>
                <Feather name="chevron-right" size={18} color={C.subtle} />
              </Pressable>
            );
          }}
        />
      )}
    </ModalPage>
  );
}
