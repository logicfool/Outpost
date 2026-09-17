import { Bone, Skeleton, SkeletonGroup } from './Skeleton';
import { ArtworkBoundary } from './ArtworkBoundary';
import React, { useMemo, useEffect, useState } from 'react';
import { FlatList, Pressable, Text, View, RefreshControl } from 'react-native';
import type { AppModel } from '../state/useApp';
import type { Navigate } from './explorerTypes';
import { safeError } from '../core/validation';
import { bundleContents } from '../core/bundles';
import { Image } from './CachedImage';
import { ItemArt, Empty, ModalHeader, ModalPage, MoneyText } from './components';
import { useTheme } from './theme';
export function BundlePanel({
  model,
  id,
  onBack,
  onNavigate,
}: {
  model: AppModel;
  id: string;
  onBack(): void;
  onNavigate: Navigate;
}) {
  const { C, S } = useTheme();
  const [loading, setLoading] = useState(true),
    [error, setError] = useState<string>();
  useEffect(() => {
    let alive = true;
    setLoading(true);
    void model
      .ensureCatalog()
      .catch((e) => {
        if (alive) setError(safeError(e).message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [model.active?.puuid, model.ensureCatalog]);
  const refresh = async () => {
    if (loading) return;
    setLoading(true);
    setError(undefined);
    try {
      await model.ensureCatalog();
    } catch (e) {
      setError(safeError(e).message);
    } finally {
      setLoading(false);
    }
  };
  const detail = useMemo(
    () =>
      bundleContents(
        model.catalog,
        id,
        model.snapshot?.store.status === 'ready' ? model.snapshot.store.data : undefined,
      ),
    [model.catalog, model.snapshot?.store, id],
  );
  return (
    <ModalPage>
      <ModalHeader title={detail.name} closeLabel="Back from bundle" onClose={onBack} />
      <FlatList
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={() => void refresh()}
            tintColor={C.accent}
          />
        }
        data={detail.items}
        keyExtractor={(i) => i.canonicalId}
        initialNumToRender={6}
        windowSize={5}
        contentContainerStyle={S.content}
        ListHeaderComponent={
          <View style={{ gap: 16 }}>
            {error && <Text style={[S.small, { color: C.gold }]}>{error}</Text>}
            {detail.image && (
              <ArtworkBoundary
                identity={`bundle-art-${id}`}
                urls={[detail.image]}
                placeholder={
                  <SkeletonGroup label="Loading bundle artwork">
                    <Bone height="auto" radius={20} style={{ aspectRatio: 2 }} />
                  </SkeletonGroup>
                }
              >
                <Image
                  source={{ uri: detail.image }}
                  style={{ width: '100%', aspectRatio: 2, borderRadius: 20 }}
                  contentFit="cover"
                />
              </ArtworkBoundary>
            )}
            <View style={S.between}>
              <Text style={S.h3}>
                {detail.source === 'store' ? 'Included items' : 'Collection items'}
              </Text>
              {detail.active && <MoneyText prices={detail.active.prices} />}
            </View>
            {detail.source === 'catalog-theme' && (
              <Text style={S.small}>
                Matched by catalog theme. Original bundle contents may differ.
              </Text>
            )}
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <Skeleton kind="store" count={3} label="Loading bundle items" />
          ) : error ? (
            <Empty title="Bundle unavailable" detail="Pull down to try again." />
          ) : (
            <Empty
              title="Contents not published"
              detail="This archive entry only includes bundle artwork."
            />
          )
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`View ${item.name}`}
            onPress={() => onNavigate({ type: 'item', item })}
            style={[S.card, { gap: 8 }]}
          >
            <ItemArt item={item} size={90} />
            <Text style={S.h3}>{item.name}</Text>
            <Text style={[S.small, { color: C.accent }]}>View details</Text>
          </Pressable>
        )}
      />
    </ModalPage>
  );
}
