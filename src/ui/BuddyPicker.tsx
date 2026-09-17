import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { Catalog } from '../core/types';
import type { LoadoutEditor, WeaponChoice } from '../core/presets';
import type { BuddyChoice } from '../core/buddies';
import { ItemArt, Button } from './components';
import { useTheme } from './theme';
export function BuddyPicker({
  editor,
  weapons,
  weaponId,
  selected,
  onChange,
  onDone,
  catalog,
  disabled = false,
}: {
  editor: LoadoutEditor;
  weapons: WeaponChoice[];
  weaponId: string;
  selected?: BuddyChoice | null;
  onChange(value: BuddyChoice | null): void;
  onDone(): void;
  catalog: Catalog;
  disabled?: boolean;
}) {
  const { C, S } = useTheme(),
    [query, setQuery] = useState('');
  const copies = useMemo(
    () =>
      (editor.ownedBuddies ?? []).filter((c) =>
        c.item.name.toLowerCase().includes(query.trim().toLowerCase()),
      ),
    [editor, query],
  );
  const inUse = (instance: string) =>
    weapons.find(
      (w) =>
        w.weaponId !== weaponId &&
        (w.buddy === undefined
          ? editor.current.find((c) => c.weaponId === w.weaponId)?.buddy
          : w.buddy
        )?.instanceId === instance,
    );
  return (
    <FlatList
      data={copies}
      keyExtractor={(copy) => copy.instanceId}
      initialNumToRender={8}
      maxToRenderPerBatch={8}
      windowSize={5}
      contentContainerStyle={S.content}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <View style={{ gap: 12 }}>
          <Button
            secondary
            title="No buddy"
            disabled={disabled}
            icon="x-circle"
            onPress={() => onChange(null)}
          />
          <TextInput
            value={query}
            onChangeText={setQuery}
            accessibilityLabel="Search owned buddies"
            placeholder="Search buddies"
            placeholderTextColor={C.subtle}
            style={S.input}
          />
          <Text style={S.small}>
            {editor.buddyError ?? 'Choose an available copy. One copy per weapon.'}
          </Text>
        </View>
      }
      renderItem={({ item: copy }) => {
        const used = inUse(copy.instanceId),
          chosen = selected?.instanceId === copy.instanceId;
        const copyNumber =
          (editor.ownedBuddies ?? [])
            .filter((c) => c.buddyId === copy.buddyId)
            .findIndex((c) => c.instanceId === copy.instanceId) + 1;
        const name = used ? (catalog.items[used.skinId]?.weapon ?? 'another weapon') : undefined;
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Use ${copy.item.name} copy ${copyNumber}`}
            accessibilityState={{ selected: chosen, disabled: disabled || !!used }}
            disabled={disabled || !!used}
            onPress={() =>
              onChange({
                buddyId: copy.buddyId,
                levelId: copy.levelId,
                instanceId: copy.instanceId,
              })
            }
            style={[
              S.card,
              S.row,
              { padding: 12, opacity: used ? 0.5 : 1, borderColor: chosen ? C.accent : C.border },
            ]}
          >
            <ItemArt item={copy.item} size={52} style={{ width: 56 }} />
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={S.h3}>{copy.item.name}</Text>
              <Text style={S.small}>
                {used ? `On ${name}` : chosen ? 'Selected' : `Copy ${copyNumber}`}
              </Text>
            </View>
            <Feather
              name={chosen ? 'check-circle' : used ? 'lock' : 'circle'}
              size={19}
              color={chosen ? C.accent : C.subtle}
            />
          </Pressable>
        );
      }}
      ListEmptyComponent={
        <Text style={[S.body, { textAlign: 'center', paddingVertical: 24 }]}>
          No available buddy copies.
        </Text>
      }
      ListFooterComponent={<Button title="Done with buddy" disabled={disabled} onPress={onDone} />}
    />
  );
}
