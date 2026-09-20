import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Switch } from 'react-native';
import type { AppModel } from '../state/useApp';
import type { CatalogItem } from '../core/types';
import type { PurchaseQuote, PurchaseRecord } from '../core/purchases';
import { safeError, type AppError } from '../core/validation';
import { Button } from './components';
import { useTheme } from './theme';

const pending = (record: PurchaseRecord) =>
  ['submitting', 'accepted', 'unknown'].includes(record.state);
function Receipt({ record }: { record: PurchaseRecord }) {
  const { C, S } = useTheme();
  const label =
    record.state === 'complete'
      ? record.ownershipVerified
        ? record.bundle
          ? 'Bundle items confirmed'
          : 'Skin ownership confirmed'
        : 'Riot confirmed the order'
      : record.state === 'failed'
        ? 'Purchase rejected'
        : record.state === 'not-submitted'
          ? 'Purchase not sent'
          : 'Checking purchase outcome';
  return (
    <View style={{ gap: 6 }}>
      <Text style={S.h3}>{label}</Text>
      <Text style={S.body}>
        {record.message ?? 'The request has not yet been verified. Do not repeat it.'}
      </Text>
      {record.errorCode && (
        <Text selectable style={[S.small, { color: C.gold }]}>
          Code: {record.errorCode}
          {record.httpStatus ? ` · HTTP ${record.httpStatus}` : ''}
        </Text>
      )}
      {record.balanceAfter !== undefined && (
        <Text style={S.small}>
          Last verified balance: {record.balanceAfter.toLocaleString()} VP
        </Text>
      )}
    </View>
  );
}
export function PurchaseControls({
  model,
  item,
  bundleId,
}: {
  model: AppModel;
  item: CatalogItem;
  bundleId?: string;
}) {
  const { C, S } = useTheme();
  const [quote, setQuote] = useState<PurchaseQuote>(),
    [record, setRecord] = useState<PurchaseRecord>();
  const [accepted, setAccepted] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<AppError>();
  const [now, setNow] = useState(Date.now());
  const scope = `${model.active?.puuid}:${bundleId ?? item.id}:${bundleId ? 'bundle' : 'skin'}`,
    current = useRef(scope),
    mounted = useRef(true),
    running = useRef(false);
  current.current = scope;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    setQuote(undefined);
    setRecord(undefined);
    setAccepted(false);
    setError(undefined);
    running.current = false;
    setBusy(false);
  }, [scope]);
  useEffect(() => {
    if (!quote && !record) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [quote?.id, record?.id]);
  const same = () => mounted.current && current.current === scope;
  const run = async (operation: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await operation();
    } catch (reason) {
      if (same()) setError(safeError(reason));
    } finally {
      if (same()) {
        running.current = false;
        setBusy(false);
      }
    }
  };
  const daily =
    model.snapshot?.store.status === 'ready' &&
    model.snapshot.store.data.daily.some((o) => o.item.canonicalId === item.canonicalId);
  const bundle =
    bundleId && model.snapshot?.store.status === 'ready'
      ? model.snapshot.store.data.bundles.find((b) => b.id === bundleId)
      : undefined;
  if (
    (bundleId ? !bundle : !daily || item.kind !== 'skin') ||
    (!model.settings.allowPurchases && !model.active?.demo)
  )
    return null;
  const review = () =>
    run(async () => {
      const next = await model.purchaseQuote(bundleId ?? item.id, bundleId ? 'bundle' : 'skin');
      if (same()) {
        setQuote(next);
        setRecord(undefined);
        setAccepted(false);
        setNow(Date.now());
      }
    });
  const confirm = () =>
    run(async () => {
      if (!quote || !accepted || Date.now() >= quote.expiresAt) return;
      try {
        const next = await model.confirmPurchase(quote.id);
        if (same()) {
          setRecord(next);
          setNow(Date.now());
        }
      } finally {
        if (same()) {
          setQuote(undefined);
          setAccepted(false);
        }
      }
    });
  const check = () =>
    run(async () => {
      if (!record) return;
      const next = await model.checkPurchase(record.id);
      if (same()) {
        setRecord(next);
        setNow(Date.now());
      }
    });
  const seconds = quote ? Math.max(0, Math.ceil((quote.expiresAt - now) / 1000)) : 0;
  const nextCheck = Math.max(record?.retryAt ?? 0, (record?.lastCheckedAt ?? 0) + 60000);
  return (
    <View style={S.card}>
      <Text style={S.h3}>{bundleId ? 'Bundle checkout' : 'Buy with existing VP'}</Text>
      <Text style={S.small}>
        {bundleId
          ? 'Experimental bundle checkout. Items may be processed separately; an uncertain purchase is never resent.'
          : 'Uses your VP balance. No automatic purchases.'}
      </Text>
      {error && (
        <View accessibilityRole="alert" style={{ gap: 4 }}>
          <Text style={[S.body, { color: C.gold }]}>{error.message}</Text>
          <Text selectable style={S.small}>
            Code: {error.code}
            {error.status ? ` · HTTP ${error.status}` : ''}
          </Text>
        </View>
      )}
      {!model.settings.allowPurchases && !model.active?.demo ? (
        <Text style={S.small}>Enable Phone purchases in Settings before reviewing a purchase.</Text>
      ) : !quote && (!record || (!pending(record) && record.state !== 'complete')) ? (
        <Button
          secondary
          title={
            busy
              ? 'Checking current offer…'
              : record
                ? 'Review a new purchase'
                : bundleId
                  ? 'Review bundle purchase'
                  : 'Review VP purchase'
          }
          disabled={busy}
          onPress={() => void review()}
        />
      ) : null}
      {quote && (
        <>
          <Text style={S.h2}>{quote.price.toLocaleString()} VP</Text>
          <Text style={S.body}>{quote.offer.item.name}</Text>
          {quote.bundle && (
            <View testID="bundle-quote-items" style={{ gap: 8, minWidth: 0 }}>
              {quote.bundle.lines.map((line) => (
                <View key={line.offerId} style={{ gap: 3 }}>
                  <Text style={S.body}>
                    {line.quantity > 1 ? `${line.quantity} × ` : ''}
                    {line.name}
                  </Text>
                  <Text style={S.small}>{line.price.toLocaleString()} VP</Text>
                </View>
              ))}
              {!!quote.bundle.ownedCount && (
                <Text style={S.small}>{quote.bundle.ownedCount} already owned - not charged</Text>
              )}
            </View>
          )}
          <Text style={S.small}>
            {model.active?.gameName} #{model.active?.tagLine} · Balance{' '}
            {quote.balanceBefore?.toLocaleString() ?? 'verified'} VP
          </Text>
          <Text style={[S.small, !seconds && { color: C.gold }]}>
            {seconds
              ? `Confirm within ${seconds}s. Current price, balance and ownership are checked again.`
              : 'This quote expired. Review the offer again; nothing is spent by an expired confirmation.'}
          </Text>
          <View style={S.row}>
            <Switch
              accessibilityLabel="I confirm this VP purchase"
              value={accepted}
              onValueChange={setAccepted}
              disabled={busy || !seconds}
            />
            <Text style={[S.body, { flex: 1 }]}>
              Spend {quote.price.toLocaleString()} VP from this account.
            </Text>
          </View>
          <Button
            title={
              model.active?.demo
                ? 'Demo preview - no VP is spent'
                : busy
                  ? 'Submitting once and verifying…'
                  : `Confirm spend ${quote.price} VP`
            }
            disabled={!!model.active?.demo || busy || !accepted || !seconds}
            onPress={() => void confirm()}
          />
          <Button
            secondary
            title={seconds ? 'Cancel purchase' : 'Discard expired quote'}
            disabled={busy}
            onPress={() => {
              setQuote(undefined);
              setAccepted(false);
            }}
          />
        </>
      )}
      {record && (
        <>
          <Receipt record={record} />
          {pending(record) && (
            <>
              <Text style={S.small}>
                {nextCheck > now
                  ? `Next read-only check in ${Math.ceil((nextCheck - now) / 1000)}s.`
                  : 'Checking ownership does not submit another purchase.'}
              </Text>
              <Button
                secondary
                title={busy ? 'Checking ownership…' : 'Check purchase outcome'}
                disabled={busy || nextCheck > now}
                onPress={() => void check()}
              />
            </>
          )}
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
  const identity = model.active?.puuid,
    current = useRef(identity);
  current.current = identity;
  const load = useCallback(async () => {
    const next = await model.purchaseRecords();
    if (current.current === identity) setRecords(next);
  }, [identity, model.purchaseRecords]);
  useEffect(() => {
    let alive = true;
    setRecords([]);
    setError('');
    void model
      .purchaseRecords()
      .then((r) => {
        if (alive) setRecords(r);
      })
      .catch(() => {
        if (alive)
          setError('Purchase history could not be read. Existing receipts have not been deleted.');
      });
    return () => {
      alive = false;
    };
  }, [identity, model.purchaseRecords]);
  const check = async (id: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await model.checkPurchase(id);
      await load();
      if (current.current === identity) setError('');
    } catch (reason) {
      if (current.current === identity) {
        const e = safeError(reason);
        setError(`${e.message} (${e.code})`);
      }
    } finally {
      if (current.current === identity) setBusy(false);
    }
  };
  return (
    <View style={{ gap: 12 }}>
      {error && (
        <Text accessibilityRole="alert" style={[S.small, { color: C.gold }]}>
          {error}
        </Text>
      )}
      {!records.length ? (
        <Text style={S.small}>
          No phone purchases recorded. No purchases run in the background.
        </Text>
      ) : (
        records.map((record) => (
          <View key={record.id} style={S.card}>
            <Text style={S.h3}>
              {record.name} · {record.price} VP
            </Text>
            <Text style={S.small}>
              {new Date(record.at).toLocaleString()} ·{' '}
              {record.protocol === 'direct-v2' ? 'Price-confirmed request' : 'Legacy order'}
            </Text>
            <Receipt record={record} />
            {pending(record) && (
              <Button
                secondary
                title="Check order status"
                disabled={busy}
                onPress={() => void check(record.id)}
              />
            )}
          </View>
        ))
      )}
    </View>
  );
}
