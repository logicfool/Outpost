import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { AppModel } from '../state/useApp';
import type { CatalogItem, Loadout } from '../core/types';
import { safeError } from '../core/validation';
import { Image } from './CachedImage';
import { PlayerCover } from './profileViews';
import { Button, Empty, ModalHeader, ModalPage, Resource, Tabs } from './components';
import { Bone, Skeleton, SkeletonGroup } from './Skeleton';
import { ArtworkBoundary } from './ArtworkBoundary';
import { useTheme } from './theme';
const NO_ITEMS: CatalogItem[] = [];

export function IdentityPanel({
  model,
  onBack,
  initialTab = 'card',
}: {
  model: AppModel;
  onBack(): void;
  initialTab?: 'card' | 'title';
}) {
  const { C, S } = useTheme();
  const cached = model.snapshot?.loadout.status === 'ready' ? model.snapshot.loadout.data : null;
  const [base, setBase] = useState<Loadout | null>(cached),
    [tab, setTab] = useState(initialTab);
  const [cardId, setCardId] = useState(cached?.card?.id),
    [titleId, setTitleId] = useState(cached?.title?.id);
  const [query, setQuery] = useState(''),
    search = useDeferredValue(query.trim().toLowerCase());
  const [checking, setChecking] = useState(true),
    [saving, setSaving] = useState(false),
    [message, setMessage] = useState<string | null>(null);
  const generation = useRef(0),
    dirty = useRef(false),
    fetching = useRef(false),
    savingRef = useRef(false);
  const applyBase = (data: Loadout, reset = false) => {
    setBase(data);
    if (reset || !dirty.current) {
      setCardId(data.card?.id);
      setTitleId(data.title?.id);
      dirty.current = false;
    }
  };
  const read = async () => {
    if (fetching.current || savingRef.current) return;
    const stamp = generation.current;
    fetching.current = true;
    setChecking(true);
    try {
      const data = await model.freshLoadout();
      if (stamp === generation.current) {
        applyBase(data);
        setMessage(null);
      }
    } catch (error) {
      if (stamp === generation.current) setMessage(safeError(error).message);
    } finally {
      if (stamp === generation.current) {
        fetching.current = false;
        setChecking(false);
      }
    }
  };
  useEffect(() => {
    generation.current++;
    fetching.current = false;

    const timer = setTimeout(() => void read(), 0);
    return () => {
      clearTimeout(timer);
      generation.current++;
    };
  }, [model.active?.puuid, model.freshLoadout]);
  const owned =
    model.snapshot?.collection.status === 'ready' ? model.snapshot.collection.data : NO_ITEMS;
  const items = useMemo(
    () => [
      ...new Map(
        [...owned, ...(base?.card ? [base.card] : []), ...(base?.title ? [base.title] : [])]
          .filter((item) => item.kind === tab && item.name.toLowerCase().includes(search))
          .map((item) => [item.id, model.catalog.items[item.id] ?? item]),
      ).values(),
    ],
    [owned, base, tab, search, model.catalog],
  );
  const card = cardId
    ? (model.catalog.items[cardId] ?? (base?.card?.id === cardId ? base.card : undefined))
    : base?.card;
  const title = titleId
    ? (model.catalog.items[titleId] ?? (base?.title?.id === titleId ? base.title : undefined))
    : base?.title;
  const changed = !!base && (cardId !== base.card?.id || titleId !== base.title?.id);
  const save = async () => {
    if (!base || !changed || checking || savingRef.current) return;
    const stamp = generation.current;
    savingRef.current = true;
    setSaving(true);
    setMessage(null);
    try {
      const data = await model.saveIdentity({
        cardId: cardId !== base.card?.id ? cardId : undefined,
        titleId: titleId !== base.title?.id ? titleId : undefined,
        expectedVersion: base.version,
        expectedCardId: base.card?.id,
        expectedTitleId: base.title?.id,
      });
      if (stamp === generation.current) {
        applyBase(data, true);
        setMessage(
          model.active?.demo
            ? 'Demo selection applied. No Riot account was changed.'
            : 'Player card and title updated.',
        );
      }
    } catch (error) {
      if (stamp === generation.current) setMessage(safeError(error).message);
    } finally {
      savingRef.current = false;
      if (stamp === generation.current) setSaving(false);
    }
  };
  const initial = !base && checking && !message;
  return (
    <ModalPage>
      <ModalHeader
        title="Player card & title"
        closeLabel="Back from identity editor"
        onClose={() => {
          if (!savingRef.current) onBack();
        }}
      />
      <FlatList
        data={initial ? NO_ITEMS : items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={S.content}
        initialNumToRender={5}
        maxToRenderPerBatch={5}
        windowSize={5}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={checking && !!base}
            onRefresh={() => void read()}
            tintColor={C.accent}
          />
        }
        ListHeaderComponent={
          initial ? (
            <Skeleton
              kind="identity"
              label="Loading player cards and title"
              testID="identity-skeleton"
            />
          ) : (
            <View style={{ gap: 14 }}>
              <PlayerCover
                player={{
                  subject: model.active!.puuid,
                  name: model.active!.gameName,
                  tag: model.active!.tagLine,
                  card,
                  title,
                  level:
                    model.snapshot?.xp?.status === 'ready'
                      ? model.snapshot.xp.data.level
                      : undefined,
                }}
                catalog={model.catalog}
              />
              {message && (
                <Text accessibilityRole="alert" style={[S.small, { color: C.gold }]}>
                  {message}
                </Text>
              )}
              <Button
                title={
                  saving ? 'Saving...' : model.active?.demo ? 'Apply to demo' : 'Apply to VALORANT'
                }
                disabled={!changed || checking || saving}
                onPress={() => void save()}
                icon="check"
              />
              {!base && !checking && (
                <Button
                  title="Retry identity"
                  secondary
                  icon="refresh-cw"
                  onPress={() => void read()}
                />
              )}
              <Tabs
                value={tab}
                onChange={setTab}
                items={[
                  { id: 'card', label: 'Owned player cards' },
                  { id: 'title', label: 'Owned titles' },
                ]}
              />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search your collection"
                placeholderTextColor={C.subtle}
                style={S.input}
                accessibilityLabel="Search owned identity items"
              />
            </View>
          )
        }
        ListEmptyComponent={
          initial ? null : model.snapshot?.collection.status !== 'ready' ? (
            <Resource title="Collection" section={model.snapshot?.collection} loading={model.busy}>
              {() => null}
            </Resource>
          ) : (
            <Empty title="No matching owned items" icon="image" />
          )
        }
        renderItem={({ item }) => {
          const selected = (tab === 'card' ? cardId : titleId) === item.id;
          return (
            <Pressable
              disabled={saving}
              accessibilityRole="button"
              accessibilityLabel={`Select ${item.name}`}
              accessibilityState={{ selected }}
              onPress={() => {
                dirty.current = true;
                if (tab === 'card') setCardId(item.id);
                else setTitleId(item.id);
              }}
              style={[S.card, { borderColor: selected ? C.accent : C.border, marginTop: 10 }]}
            >
              {tab === 'card' && (item.wideArt || item.wallpaper) ? (
                <ArtworkBoundary
                  identity={`identity-item-${item.id}`}
                  urls={[item.wideArt ?? item.wallpaper]}
                  placeholder={
                    <SkeletonGroup label="Loading card preview">
                      <Bone height={92} radius={12} />
                    </SkeletonGroup>
                  }
                >
                  <Image
                    source={{ uri: item.wideArt ?? item.wallpaper }}
                    style={{ width: '100%', height: 92, borderRadius: 12 }}
                    resizeMode="cover"
                  />
                </ArtworkBoundary>
              ) : null}
              <View style={S.between}>
                <Text style={[S.h3, { flex: 1 }]}>{item.name}</Text>
                <Feather
                  name={selected ? 'check-circle' : 'circle'}
                  size={20}
                  color={selected ? C.accent : C.subtle}
                />
              </View>
            </Pressable>
          );
        }}
      />
    </ModalPage>
  );
}
