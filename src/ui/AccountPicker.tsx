import React, { useEffect, useState } from 'react';
import { Pressable, View, Text, FlatList, useWindowDimensions, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { AppModel } from '../state/useApp';
import type { CatalogItem, Account } from '../core/types';
import { getRuntime } from '../platform/runtime';
import { PlayerAvatar } from './PlayerAvatar';
import { useTheme } from './theme';
import { Button } from './components';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
export function AccountPicker({
  visible,
  model,
  onClose,
  onAdd,
  onSelect,
}: {
  visible: boolean;
  model: AppModel;
  onClose(): void;
  onAdd(): void;
  onSelect(account: Account): void;
}) {
  const { C, S } = useTheme(),
    insets = useSafeAreaInsets(),
    { height } = useWindowDimensions();
  const [cards, setCards] = useState<Record<string, CatalogItem>>({});
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    void (async () => {
      const runtime = await getRuntime();
      const results = await Promise.all(
        model.accounts.map(async (a) => {
          const s = await runtime.repository.snapshot(a.puuid);
          return [
            a.puuid,
            s?.loadout.status === 'ready' ? s.loadout.data.card : undefined,
          ] as const;
        }),
      );
      if (alive)
        setCards(
          Object.fromEntries(results.filter((p): p is readonly [string, CatalogItem] => !!p[1])),
        );
    })().catch(() => {
      if (alive) setError(true);
    });
    return () => {
      alive = false;
    };
  }, [visible, model.accounts]);
  const accounts = model.active?.demo ? [model.active, ...model.accounts] : model.accounts;
  const select = (a: Account) => onSelect(a);
  if (!visible) return null;
  return (
    <>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable
          accessibilityLabel="Close account switcher"
          accessibilityRole="button"
          onPress={onClose}
          style={{ position: 'absolute', inset: 0, backgroundColor: '#00000055' }}
        />
        <View
          style={{
            backgroundColor: C.surface,
            borderTopLeftRadius: 26,
            borderTopRightRadius: 26,
            padding: 20,
            paddingBottom: Math.max(16, insets.bottom),
            maxHeight: height * 0.68,
            gap: 16,
          }}
        >
          <View style={S.between}>
            <Text style={S.h2}>Switch account</Text>
            <Text style={S.small}>{accounts.length} saved</Text>
          </View>
          {error && (
            <Text style={S.small}>
              Some saved portraits could not be loaded. Accounts can still be selected.
            </Text>
          )}
          <FlatList
            data={accounts}
            keyExtractor={(a) => a.puuid}
            style={{ flexGrow: 0 }}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item: a }) => {
              const own = a.puuid === model.active?.puuid,
                card =
                  own && model.snapshot?.loadout.status === 'ready'
                    ? model.snapshot.loadout.data.card
                    : cards[a.puuid];
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Switch to ${a.gameName} #${a.tagLine}`}
                  accessibilityState={{ selected: own }}
                  onPress={() => select(a)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    paddingVertical: 12,
                  }}
                >
                  <PlayerAvatar card={card} catalog={model.catalog} />
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text numberOfLines={1} style={S.h3}>
                      {a.gameName}
                      <Text style={{ color: C.subtle }}> #{a.tagLine}</Text>
                    </Text>
                    <Text style={S.small}>{a.demo ? 'Demo' : a.region.toUpperCase()}</Text>
                  </View>
                  <Feather
                    name={own ? 'check-circle' : 'chevron-right'}
                    size={20}
                    color={own ? C.accent : C.subtle}
                  />
                </Pressable>
              );
            }}
          />
          <Button
            disabled={Platform.OS === 'web' || model.accounts.length >= 10}
            secondary
            title="Add Riot account"
            icon="plus"
            onPress={onAdd}
          />
        </View>
      </View>
    </>
  );
}
