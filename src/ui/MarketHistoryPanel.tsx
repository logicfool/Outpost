import React, { useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { AppModel } from '../state/useApp';
import type { MarketRecord } from '../core/matchArchive';
import type { MarketView } from '../core/browseMemory';
import type { Navigate } from './explorerTypes';
import { useBrowseScroll } from '../state/useBrowseScroll';
import { Empty, ItemArt, ModalHeader, ModalPage, MoneyText, Tabs } from './components';
import { Skeleton } from './Skeleton';
import { useTheme } from './theme';
import { safeError } from '../core/validation';
export function MarketHistoryPanel({
  model,
  onBack,
  onNavigate,
  view: savedView,
}: {
  model: AppModel;
  onBack(): void;
  onNavigate: Navigate;
  view?: MarketView;
}) {
  const { C, S } = useTheme(),
    fallback = useRef<MarketView>({ filter: 'night-market', offset: 0 }),
    view = savedView ?? fallback.current;
  const [rows, setRows] = useState<MarketRecord[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [filter, updateFilter] = useState(view.filter);
  const scroll = useBrowseScroll<MarketRecord>(view, !loading);
  const select = (v: MarketView['filter']) => {
    view.filter = v;
    updateFilter(v);
    scroll.reset();
  };
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    void model
      .savedMarkets()
      .then((data) => {
        if (alive) setRows(data);
      })
      .catch((e) => {
        if (alive) setError(safeError(e).message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [model.savedMarkets, model.active?.puuid]);
  return (
    <ModalPage>
      <ModalHeader title="Saved stores" closeLabel="Back from saved stores" onClose={onBack} />
      <FlatList
        {...scroll.props}
        testID="saved-stores-list"
        data={rows.filter((r) => r.kind === filter)}
        keyExtractor={(r) => r.id}
        initialNumToRender={3}
        contentContainerStyle={[S.content, { gap: 14 }]}
        ListHeaderComponent={
          <View style={{ gap: 10 }}>
            <Tabs
              value={filter}
              onChange={select}
              items={[
                { id: 'night-market', label: 'Night Markets' },
                { id: 'bundle', label: 'Bundles' },
                { id: 'daily', label: 'Daily' },
              ]}
            />
            <Text style={S.small}>Historical offers and prices</Text>
            {error && (
              <Text accessibilityRole="alert" style={[S.small, { color: C.gold }]}>
                {error}
              </Text>
            )}
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <Skeleton kind="row" count={3} label="Loading saved stores" />
          ) : (
            <Empty title="No saved offers in this view" />
          )
        }
        renderItem={({ item }) => (
          <View
            testID="saved-store-card"
            style={{
              backgroundColor: C.surface,
              borderRadius: 18,
              borderWidth: 1,
              borderColor: C.border,
              padding: 14,
              gap: 6,
              minWidth: 0,
            }}
          >
            <Text numberOfLines={2} style={[S.h3, { flexShrink: 1 }]}>
              {item.name}
            </Text>
            <Text style={[S.small, { paddingBottom: 6 }]}>
              {new Date(item.observedAt).toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              })}{' '}
              · {item.offers.length} items
            </Text>
            {item.offers.map((offer, index) => (
              <Pressable
                key={`${offer.id}:${index}`}
                testID="saved-store-offer"
                accessibilityRole="button"
                accessibilityLabel={`View archived ${offer.item.name}`}
                onPress={() => onNavigate({ type: 'item', item: offer.item })}
                style={({ pressed }) => ({
                  opacity: pressed ? 0.7 : 1,
                  minHeight: 78,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  paddingVertical: 10,
                  borderTopWidth: 0.5,
                  borderTopColor: C.border,
                  minWidth: 0,
                })}
              >
                <ItemArt item={offer.item} size={52} style={{ width: 68, flexShrink: 0 }} />
                <View testID="saved-store-offer-info" style={{ flex: 1, minWidth: 0, gap: 6 }}>
                  <Text
                    numberOfLines={2}
                    style={[S.body, { fontSize: 14, lineHeight: 19, flexShrink: 1 }]}
                  >
                    {offer.item.name}
                  </Text>
                  <View
                    testID="saved-store-offer-price"
                    style={{ alignSelf: 'flex-start', maxWidth: '100%' }}
                  >
                    <MoneyText prices={offer.prices} />
                  </View>
                </View>
                <Feather name="chevron-right" size={16} color={C.subtle} />
              </Pressable>
            ))}
          </View>
        )}
      />
    </ModalPage>
  );
}
