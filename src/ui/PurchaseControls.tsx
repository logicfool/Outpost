import React, { useState, useEffect } from 'react';
import { View, Text, Switch } from 'react-native';
import type { AppModel } from '../state/useApp';
import type { CatalogItem } from '../core/types';
import type { PurchaseQuote, PurchaseRecord } from '../core/purchases';
import { safeError } from '../core/validation';
import { Button } from './components';
import { useTheme } from './theme';
export function PurchaseControls({ model, item }: { model: AppModel; item: CatalogItem }) {
  const { C, S } = useTheme();
  const [quote, setQuote] = useState<PurchaseQuote>(),
    [record, setRecord] = useState<PurchaseRecord>(),
    [accepted, setAccepted] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    setQuote(undefined);
    setRecord(undefined);
    setAccepted(false);
    setError('');
  }, [item.id, model.active?.puuid]);
  const daily =
    model.snapshot?.store.status === 'ready' &&
    model.snapshot.store.data.daily.some((o) => o.item.canonicalId === item.canonicalId);
  if (!daily || item.kind !== 'skin') return null;
  const review = async () => {
    setBusy(true);
    setError('');
    try {
      setQuote(await model.purchaseQuote(item.id));
      setAccepted(false);
    } catch (e) {
      setError(safeError(e).message);
    } finally {
      setBusy(false);
    }
  };
  const confirm = async () => {
    if (!quote || !accepted || busy) return;
    setBusy(true);
    setError('');
    try {
      setRecord(await model.confirmPurchase(quote.id));
      setQuote(undefined);
    } catch (e) {
      setError(safeError(e).message);
      setQuote(undefined);
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={S.card}>
      <Text style={S.h3}>Purchase with existing VP</Text>
      <Text style={S.small}>
        Experimental unofficial purchase flow. No VP top-ups or automatic purchases. Only daily
        weapon offers are supported.
      </Text>
      {error && (
        <Text accessibilityRole="alert" style={[S.body, { color: C.gold }]}>
          {error}
        </Text>
      )}
      {!model.settings.allowPurchases ? (
        <Text style={S.small}>Enable Phone purchases in Settings to use this feature.</Text>
      ) : !quote && !record ? (
        <Button
          secondary
          title={busy ? 'Checking current offer…' : 'Review VP purchase'}
          disabled={busy}
          onPress={() => void review()}
        />
      ) : null}
      {quote && (
        <>
          <Text style={S.h2}>{quote.price.toLocaleString()} VP</Text>
          <Text style={S.body}>
            {quote.offer.item.name} · {model.active?.gameName} #{model.active?.tagLine}
          </Text>
          <Text style={S.small}>
            Confirmation expires after 45 seconds. Price, available VP and ownership are rechecked
            before submission. Uncertain transactions are never retried.
          </Text>
          <View style={S.row}>
            <Switch
              accessibilityLabel="I confirm this VP purchase"
              value={accepted}
              onValueChange={setAccepted}
              disabled={busy}
            />
            <Text style={[S.body, { flex: 1 }]}>Spend VP from this account on this skin.</Text>
          </View>
          <Button
            title={busy ? 'Submitting once…' : `Confirm spend ${quote.price} VP`}
            disabled={busy || !accepted}
            onPress={() => void confirm()}
          />
          <Button
            secondary
            title="Cancel purchase"
            disabled={busy}
            onPress={() => setQuote(undefined)}
          />
        </>
      )}
      {record && (
        <>
          <Text style={S.h3}>
            {record.state === 'complete'
              ? 'Riot confirmed the order'
              : record.state === 'failed'
                ? 'Riot rejected the order'
                : 'Purchase needs verification'}
          </Text>
          <Text style={S.small}>
            {record.message ?? 'Review the order status in Settings → Purchase history.'}
          </Text>
        </>
      )}
    </View>
  );
}
export function PurchaseHistory({ model }: { model: AppModel }) {
  const { C, S } = useTheme();
  const [records, setRecords] = useState<PurchaseRecord[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    void model
      .purchaseRecords()
      .then((r) => {
        if (alive) setRecords(r);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [model.active?.puuid]);
  const check = async (id: string) => {
    setBusy(true);
    try {
      await model.checkPurchase(id);
      setRecords(await model.purchaseRecords());
      setError('');
    } catch (e) {
      setError(safeError(e).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={{ gap: 12 }}>
      {error && <Text style={[S.small, { color: C.gold }]}>{error}</Text>}
      {!records.length ? (
        <Text style={S.small}>
          No phone purchases recorded. Purchases are never made in the background.
        </Text>
      ) : (
        records.map((r) => (
          <View key={r.id} style={S.card}>
            <Text style={S.h3}>
              {r.name} · {r.price} VP
            </Text>
            <Text style={S.small}>
              {r.state.toUpperCase()} · {new Date(r.at).toLocaleString()}
            </Text>
            {r.message && <Text style={S.small}>{r.message}</Text>}
            {!['complete', 'failed'].includes(r.state) && (
              <Button
                secondary
                title="Check order status"
                disabled={busy}
                onPress={() => void check(r.id)}
              />
            )}
          </View>
        ))
      )}
    </View>
  );
}
