import React, { useEffect, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import type { AppModel } from '../state/useApp';
import type { MarketRecord } from '../core/matchArchive';
import type { Navigate } from './explorerTypes';
import { Button, Empty, ItemArt, ModalHeader, ModalPage, MoneyText, Tabs } from './components';
import { Skeleton } from './Skeleton';
import { useTheme } from './theme';
import { safeError } from '../core/validation';
export function MarketHistoryPanel({
  model,
  onBack,
  onNavigate,
}: {
  model: AppModel;
  onBack(): void;
  onNavigate: Navigate;
}) {
  const { C, S } = useTheme();
  const [rows, setRows] = useState<MarketRecord[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [filter, setFilter] = useState<'night-market' | 'bundle' | 'daily'>('night-market');
  useEffect(() => {
    let alive = true;
    setLoading(true);
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
        data={rows.filter((r) => r.kind === filter)}
        keyExtractor={(r) => r.id}
        initialNumToRender={3}
        contentContainerStyle={S.content}
        ListHeaderComponent={
          <View style={{ gap: 12 }}>
            <Tabs
              value={filter}
              onChange={setFilter}
              items={[
                { id: 'night-market', label: 'Night Markets' },
                { id: 'bundle', label: 'Bundles' },
                { id: 'daily', label: 'Daily' },
              ]}
            />
            <Text style={S.small}>
              Offers observed on this device. Historical prices are not purchase quotes.
            </Text>
            {error && <Text style={[S.small, { color: C.gold }]}>{error}</Text>}
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <Skeleton kind="row" count={3} label="Loading saved stores" />
          ) : (
            <Empty
              title="No saved offers in this view"
              detail="Newly observed rotations are kept locally and included in backups."
            />
          )
        }
        renderItem={({ item }) => (
          <View style={S.card}>
            <Text style={S.h3}>{item.name}</Text>
            <Text style={S.small}>
              {new Date(item.observedAt).toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              })}
            </Text>
            {item.offers.map((offer) => (
              <View key={offer.id} style={{ gap: 6 }}>
                <View style={S.row}>
                  <ItemArt item={offer.item} size={48} />
                  <View style={{ flex: 1 }}>
                    <Text style={S.body}>{offer.item.name}</Text>
                    <MoneyText prices={offer.prices} />
                  </View>
                </View>
                <Button
                  title="View item"
                  secondary
                  label={`View archived ${offer.item.name}`}
                  onPress={() => onNavigate({ type: 'item', item: offer.item })}
                />
              </View>
            ))}
          </View>
        )}
      />
    </ModalPage>
  );
}
