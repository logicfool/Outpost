import { catalogueBrowse, ownedBrowse, EMPTY_BROWSE } from '../core/catalogBrowse';
import type { CollectionView } from '../core/browseMemory';
import { useBrowseScroll } from '../state/useBrowseScroll';
import { AimCollectionRows } from './AimCollectionRows';
import { Bone, Skeleton, SkeletonGroup } from './Skeleton';
import { ArtworkBoundary } from './ArtworkBoundary';
import React, { memo, useCallback, useDeferredValue, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { AppModel } from '../state/useApp';
import type { CatalogItem, ItemKind } from '../core/types';
import type { Navigate } from './explorerTypes';
import { hydrateItem } from '../core/catalog';
import { Image } from './CachedImage';
import {
  ItemArt,
  ListGroup,
  ListRow,
  ModalHeader,
  ModalPage,
  Resource,
  Tabs,
  WishButton,
} from './components';
import { useNavInset } from './NavInsets';
import { useScrollHeader } from './ScrollHeader';
import { useTheme } from './theme';

export type CollectionKind = ItemKind | 'all';
export type CollectionScope = 'owned' | 'catalog' | 'wishlist';
const CATEGORIES: {
  kind: CollectionKind;
  title: string;
  icon: React.ComponentProps<typeof Feather>['name'];
}[] = [
  { kind: 'skin', title: 'Skins', icon: 'zap' },
  { kind: 'buddy', title: 'Buddies', icon: 'award' },
  { kind: 'spray', title: 'Sprays', icon: 'sun' },
  { kind: 'card', title: 'Player cards', icon: 'image' },
  { kind: 'title', title: 'Titles', icon: 'type' },
  { kind: 'chroma', title: 'Colours', icon: 'droplet' },
  { kind: 'agent', title: 'Agents', icon: 'users' },
];
export function CollectionHub({ model, onNavigate }: { model: AppModel; onNavigate: Navigate }) {
  const { C, S } = useTheme(),
    bottom = useNavInset();
  const scrollHeader = useScrollHeader();
  const equipped =
    model.snapshot?.loadout.status === 'ready' ? model.snapshot.loadout.data : undefined;
  const card = equipped?.card ?? model.observedIdentity?.player.card,
    art = card ? hydrateItem(model.catalog, card) : undefined;
  const owned =
    model.snapshot?.collection.status === 'ready' ? model.snapshot.collection.data : undefined;
  const counts = useMemo(() => {
    const values = new Map<ItemKind, Set<string>>();
    for (const item of owned ?? []) {
      const ids = values.get(item.kind) ?? new Set();
      ids.add(item.kind === 'skin' ? item.canonicalId : item.id);
      values.set(item.kind, ids);
    }
    return values;
  }, [owned]);
  const count = (kind: ItemKind) => (owned ? String(counts.get(kind)?.size ?? 0) : undefined);
  return (
    <ScrollView
      {...scrollHeader}
      testID="collection-home"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[S.content, { gap: 18, paddingBottom: bottom + 24 }]}
      refreshControl={
        <RefreshControl
          refreshing={model.busy}
          onRefresh={() => void model.refresh()}
          tintColor={C.accent}
        />
      }
    >
      <View style={S.between}>
        <Text accessibilityRole="header" style={S.title}>
          Collection
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Search all collection items"
          onPress={() => onNavigate({ type: 'collection', kind: 'all', scope: 'catalog' })}
          style={{ padding: 12 }}
        >
          <Feather name="search" size={21} color={C.ink} />
        </Pressable>
      </View>
      {!art && !equipped && (!model.snapshot || model.busy) && (
        <Skeleton kind="profile" label="Loading equipped banner" />
      )}
      {art?.wideArt ? (
        <View style={{ gap: 7 }}>
          <ArtworkBoundary
            identity={`collection-banner-${art.id}`}
            urls={[art.wideArt]}
            placeholder={
              <SkeletonGroup label="Loading collection banner">
                <Bone height="auto" radius={18} style={{ aspectRatio: 3.2 }} />
              </SkeletonGroup>
            }
          >
            <Image
              accessibilityLabel={art.name}
              source={{ uri: art.wideArt }}
              style={{ width: '100%', aspectRatio: 3.2, borderRadius: 18 }}
              contentFit="cover"
            />
          </ArtworkBoundary>
          <Text style={[S.small, { textAlign: 'center' }]} numberOfLines={1}>
            {art.name}
            {!equipped ? ' · last seen' : ''}
          </Text>
        </View>
      ) : null}
      <Text style={S.h2}>Loadout</Text>
      <ListGroup>
        <ListRow
          title="Change banner"
          icon="flag"
          value={card?.name}
          onPress={() => onNavigate({ type: 'identity', initialTab: 'card' })}
        />
        <ListRow
          title="Change title"
          icon="type"
          value={equipped?.title?.name}
          onPress={() => onNavigate({ type: 'identity', initialTab: 'title' })}
        />
        <ListRow
          title="Weapon loadout"
          icon="crosshair"
          value={equipped ? `${equipped.guns.length} slots` : undefined}
          onPress={() => onNavigate({ type: 'equipped' })}
        />
        <ListRow
          title="Weapon buddies"
          icon="award"
          onPress={() => onNavigate({ type: 'buddies' })}
        />
        <ListRow
          title="Change sprays"
          icon="droplet"
          onPress={() => onNavigate({ type: 'sprays' })}
        />
        <ListRow
          title="Loadout presets"
          label="Saved loadouts"
          icon="layers"
          onPress={() => onNavigate({ type: 'presets' })}
          last
        />
      </ListGroup>
      <AimCollectionRows model={model} onNavigate={onNavigate} />
      <Text style={S.h2}>Browse collection</Text>
      <ListGroup>
        {CATEGORIES.map((category, index) => (
          <ListRow
            key={category.kind}
            title={category.title}
            icon={category.icon}
            value={count(category.kind as ItemKind)}
            last={index === CATEGORIES.length - 1}
            onPress={() => onNavigate({ type: 'collection', kind: category.kind, scope: 'owned' })}
          />
        ))}
      </ListGroup>
      <ListGroup>
        <ListRow
          title="Wishlist"
          icon="heart"
          value={String(model.wishlist.length)}
          onPress={() => onNavigate({ type: 'collection', kind: 'all', scope: 'wishlist' })}
        />
        <ListRow
          title="All items"
          icon="grid"
          onPress={() => onNavigate({ type: 'collection', kind: 'all', scope: 'catalog' })}
          last
        />
      </ListGroup>
    </ScrollView>
  );
}
const CollectionTile = memo(function CollectionTile({
  item,
  wished,
  onItem,
  onWish,
}: {
  item: CatalogItem;
  wished: boolean;
  onItem(item: CatalogItem): void;
  onWish(id: string): void;
}) {
  const { C, S } = useTheme();
  return (
    <View
      style={{
        flex: 1,
        maxWidth: '49%',
        backgroundColor: C.surface,
        borderRadius: 16,
        padding: 12,
        gap: 5,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`View ${item.name}`}
        onPress={() => onItem(item)}
        style={{ gap: 7 }}
      >
        <ItemArt item={item} size={90} />
        <Text style={S.h3} numberOfLines={2}>
          {item.name}
        </Text>
      </Pressable>
      <View style={S.between}>
        <Text style={S.small} numberOfLines={1}>
          {item.weapon ?? item.kind}
        </Text>
        <WishButton
          wished={wished}
          name={item.name}
          onPress={() => onWish(item.canonicalId)}
          size={18}
        />
      </View>
    </View>
  );
});
const Gap = () => <View style={{ height: 10 }} />;
export function CollectionBrowser({
  model,
  initialKind = 'all',
  initialScope = 'owned',
  onNavigate,
  onBack,
  view: savedView,
}: {
  model: AppModel;
  initialKind?: CollectionKind;
  initialScope?: CollectionScope;
  onNavigate: Navigate;
  onBack(): void;
  view?: CollectionView;
}) {
  const { C, S } = useTheme();
  const fallback = useRef<CollectionView>({
    scope: initialScope,
    kind: initialKind,
    query: '',
    weapon: 'all',
    offset: 0,
  });
  const view = savedView ?? fallback.current;
  const [scope, updateScope] = useState(view.scope),
    [kind, updateKind] = useState(view.kind),
    [query, updateQuery] = useState(view.query),
    [weapon, updateWeapon] = useState(view.weapon);
  const scroll = useBrowseScroll<CatalogItem>(
    view,
    scope !== 'owned' || model.snapshot?.collection.status === 'ready',
  );
  const setScope = (v: CollectionScope) => {
    view.scope = v;
    updateScope(v);
    scroll.reset();
  };
  const setKind = (v: CollectionKind) => {
    view.kind = v;
    updateKind(v);
    scroll.reset();
  };
  const setQuery = (v: string) => {
    view.query = v;
    updateQuery(v);
    scroll.reset();
  };
  const setWeapon = (v: string) => {
    view.weapon = v;
    updateWeapon(v);
    scroll.reset();
  };
  const search = useDeferredValue(query.trim().toLowerCase());
  const owned =
    model.snapshot?.collection.status === 'ready' ? model.snapshot.collection.data : EMPTY_BROWSE;
  const source = useMemo(
    () =>
      scope === 'owned' ? ownedBrowse(owned, model.catalog) : catalogueBrowse(model.catalog).items,
    [scope, owned, model.catalog.items],
  );
  const wished = useMemo(() => new Set(model.wishlist), [model.wishlist]);
  const weapons = useMemo(() => {
    const meta = Object.values(model.catalog.weapons ?? {}).map((weapon) => weapon.name);
    return meta.length
      ? meta.sort()
      : [
          ...new Set(
            source
              .filter((item) => item.kind === 'skin' && item.weapon)
              .map((item) => item.weapon!),
          ),
        ].sort();
  }, [model.catalog.weapons, source]);
  const items = useMemo(
    () =>
      source.filter(
        (item) =>
          (scope !== 'wishlist' ||
            (wished.has(item.canonicalId) && (kind === 'chroma' || item.kind !== 'chroma'))) &&
          (kind === 'all'
            ? item.kind !== 'chroma' && item.kind !== 'currency'
            : item.kind === kind) &&
          (weapon === 'all' || item.weapon === weapon) &&
          item.name.toLowerCase().includes(search),
      ),
    [source, scope, wished, kind, weapon, search],
  );
  const openItem = useCallback(
    (item: CatalogItem) => onNavigate({ type: 'item', item }),
    [onNavigate],
  );
  const onWish = useCallback(
    (id: string) => {
      void model.toggleWish(id);
    },
    [model.toggleWish],
  );
  const title = CATEGORIES.find((c) => c.kind === kind)?.title ?? 'Collection';
  const waiting = scope === 'owned' && model.snapshot?.collection.status !== 'ready';
  return (
    <ModalPage>
      <ModalHeader title={title} closeLabel="Back from collection browser" onClose={onBack} />
      <FlatList
        {...scroll.props}
        testID="collection-browser-list"
        data={waiting ? [] : items}
        numColumns={2}
        keyExtractor={(i) => `${i.kind}:${i.id}`}
        contentContainerStyle={[S.content, { gap: 0 }]}
        columnWrapperStyle={{ gap: 10 }}
        ItemSeparatorComponent={Gap}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={5}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={model.busy}
            onRefresh={() => void model.refresh()}
            tintColor={C.accent}
          />
        }
        ListHeaderComponent={
          <View style={{ gap: 12, paddingBottom: 14 }}>
            <Tabs
              value={scope}
              onChange={setScope}
              items={[
                { id: 'owned', label: 'Owned' },
                { id: 'catalog', label: 'All items' },
                { id: 'wishlist', label: 'Wishlist' },
              ]}
            />
            <TextInput
              accessibilityLabel="Search collection"
              maxLength={180}
              placeholder={`Search ${title.toLowerCase()}`}
              value={query}
              onChangeText={setQuery}
              autoCorrect={false}
              style={S.input}
              placeholderTextColor={C.subtle}
            />
            <Tabs
              value={kind}
              onChange={(value) => {
                setKind(value);
                setWeapon('all');
              }}
              items={[
                { id: 'all', label: 'All' },
                ...CATEGORIES.map((c) => ({
                  id: c.kind,
                  label: c.kind === 'chroma' ? 'Chromas' : c.title,
                })),
              ]}
            />
            {['skin', 'chroma'].includes(kind) && (
              <Tabs
                value={weapon}
                onChange={setWeapon}
                items={[
                  { id: 'all', label: 'All weapons' },
                  ...weapons.map((w) => ({ id: w, label: w })),
                ]}
              />
            )}
            <Text style={S.small}>{items.length} items</Text>
          </View>
        }
        renderItem={({ item }) => (
          <CollectionTile
            item={item}
            wished={wished.has(item.canonicalId)}
            onItem={openItem}
            onWish={onWish}
          />
        )}
        ListEmptyComponent={
          waiting ? (
            <Resource title="Collection" section={model.snapshot?.collection} loading={model.busy}>
              {() => null}
            </Resource>
          ) : (
            <Text style={[S.body, { textAlign: 'center', paddingVertical: 25 }]}>
              No matching items.
            </Text>
          )
        }
      />
    </ModalPage>
  );
}
export function EquippedPanel({
  model,
  onNavigate,
  onBack,
}: {
  model: AppModel;
  onNavigate: Navigate;
  onBack(): void;
}) {
  const { C, S } = useTheme();
  const loadout = model.snapshot?.loadout;
  return (
    <ModalPage>
      <ModalHeader title="Weapon loadout" closeLabel="Back from weapon loadout" onClose={onBack} />
      <FlatList
        data={loadout?.status === 'ready' ? loadout.data.guns : []}
        keyExtractor={(g, i) => `${g.weapon}:${i}`}
        contentContainerStyle={S.content}
        initialNumToRender={8}
        refreshControl={
          <RefreshControl
            refreshing={model.busy}
            onRefresh={() => void model.refresh()}
            tintColor={C.accent}
          />
        }
        ListHeaderComponent={
          <ListGroup>
            <ListRow
              title="Edit a loadout preset"
              icon="layers"
              onPress={() => onNavigate({ type: 'presets' })}
            />
            <ListRow
              title="Manage buddies"
              icon="award"
              onPress={() => onNavigate({ type: 'buddies' })}
              last
            />
          </ListGroup>
        }
        ListEmptyComponent={
          <Resource title="Equipped weapons" section={loadout} loading={model.busy}>
            {() => <Text style={S.small}>No equipped weapons returned.</Text>}
          </Resource>
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`View equipped ${item.weapon}`}
            onPress={() => onNavigate({ type: 'item', item: item.skin })}
            style={[S.card, S.row, { padding: 12 }]}
          >
            <ItemArt
              item={hydrateItem(model.catalog, item.skin)}
              size={65}
              style={{ width: 104 }}
            />
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={S.small}>{item.weapon}</Text>
              <Text style={S.h3}>{item.skin.name}</Text>
              {item.buddy && <Text style={S.small}>{item.buddy.name}</Text>}
            </View>
            <Feather name="chevron-right" size={17} color={C.subtle} />
          </Pressable>
        )}
      />
    </ModalPage>
  );
}
