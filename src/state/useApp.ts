import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import type {
  Account,
  Catalog,
  HistoryEntry,
  LoginTokens,
  MatchDetail,
  MatchSummary,
  Region,
  Settings,
  Snapshot,
} from '../core/types';
import { DEFAULT_SETTINGS, EMPTY_CATALOG } from '../core/types';
import { DEMO_ACCOUNT, demoMatch, makeDemo } from '../core/demo';
import { AppError, safeError } from '../core/validation';
import { getRuntime } from '../platform/runtime';
import { configureBackground } from '../platform/background';
import {
  cancelAllNotifications,
  enableNotifications,
  updateStoreNotifications,
} from '../platform/notifications';
export function useApp() {
  const [booting, setBooting] = useState(true),
    [accounts, setAccounts] = useState<Account[]>([]),
    [active, setActive] = useState<Account | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [catalog, setCatalog] = useState<Catalog>({ ...EMPTY_CATALOG });
  const [wishlist, setWishlist] = useState<string[]>([]),
    [history, setHistory] = useState<HistoryEntry[]>([]);
  const [settings, setSettings] = useState<Settings>({ ...DEFAULT_SETTINGS }),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState<string | null>(null);
  const activeRef = useRef(active),
    epoch = useRef(0),
    lastForegroundRefresh = useRef(0),
    demoWishes = useRef<string[]>([]);
  activeRef.current = active;
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const runtime = await getRuntime(),
          list = await runtime.repository.accounts(),
          prefs = await runtime.repository.settings();
        if (mounted) {
          setAccounts(list);
          setSettings(prefs);
          setActive(list[0] ?? null);
        }
      } catch (error) {
        if (mounted) setMessage(safeError(error).message);
      } finally {
        if (mounted) setBooting(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);
  const refresh = useCallback(async () => {
    const account = activeRef.current;
    if (!account) return;
    const stamp = epoch.current;
    setBusy(true);
    setMessage(null);
    try {
      if (account.demo) {
        setSnapshot(makeDemo().snapshot);
        return;
      }
      const runtime = await getRuntime(),
        next = await runtime.sync(account.puuid);
      const [entries, updatedAccounts] = await Promise.all([
        runtime.repository.history(account.puuid),
        runtime.repository.accounts(),
      ]);
      if (epoch.current === stamp && activeRef.current?.puuid === account.puuid) {
        setSnapshot(next);
        setHistory(entries);
        setCatalog(runtime.catalog);
        setAccounts(updatedAccounts);
        const updated = updatedAccounts.find((a) => a.puuid === account.puuid);
        if (updated) {
          activeRef.current = updated;
          setActive(updated);
        }
      }
    } catch (error) {
      if (epoch.current === stamp) setMessage(safeError(error).message);
    } finally {
      if (epoch.current === stamp) setBusy(false);
    }
  }, []);
  useEffect(() => {
    const stamp = ++epoch.current;
    setSnapshot(null);
    setHistory([]);
    setWishlist([]);
    setCatalog({ ...EMPTY_CATALOG });
    setBusy(false);
    setMessage(null);
    if (!active) return;
    if (active.demo) {
      const demo = makeDemo();
      setSnapshot(demo.snapshot);
      setCatalog(demo.catalog);
      setWishlist(demoWishes.current);
      return;
    }
    (async () => {
      try {
        const runtime = await getRuntime();
        const [cached, wishes, entries, savedCatalog] = await Promise.all([
          runtime.repository.snapshot(active.puuid),
          runtime.repository.wishlist(active.puuid),
          runtime.repository.history(active.puuid),
          runtime.repository.catalog(),
        ]);
        if (epoch.current !== stamp) return;
        setSnapshot(cached);
        setWishlist(wishes);
        setHistory(entries);
        if (savedCatalog) setCatalog(savedCatalog);
        await refresh();
      } catch (error) {
        if (epoch.current === stamp) setMessage(safeError(error).message);
      }
    })();
  }, [active?.puuid, active?.expiresAt, refresh]);
  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => {
      const account = activeRef.current;
      if (
        state === 'active' &&
        account &&
        !account.demo &&
        account.expiresAt > Date.now() + 30000 &&
        Date.now() - lastForegroundRefresh.current > 5 * 60000
      ) {
        lastForegroundRefresh.current = Date.now();
        void refresh();
      }
    });
    return () => listener.remove();
  }, [refresh]);
  const switchAccount = useCallback((account: Account | null) => {
    epoch.current++;
    activeRef.current = account;
    setActive(account);
    setSnapshot(null);
    setMessage(null);
  }, []);
  const link = useCallback(
    async (tokens: LoginTokens, region?: Region, expectedId?: string) => {
      const runtime = await getRuntime(),
        account = await runtime.link(tokens, region, expectedId);
      setAccounts(await runtime.repository.accounts());
      switchAccount(account);
    },
    [switchAccount],
  );
  const remove = useCallback(
    async (id: string) => {
      try {
        const runtime = await getRuntime();
        await runtime.remove(id);
        const list = await runtime.repository.accounts();
        setAccounts(list);
        if (activeRef.current?.puuid === id) switchAccount(list[0] ?? null);
      } catch (error) {
        setMessage(safeError(error).message);
      }
    },
    [switchAccount],
  );
  const toggleWish = useCallback(async (id: string) => {
    const account = activeRef.current;
    if (!account) return;
    try {
      if (account.demo) {
        demoWishes.current = demoWishes.current.includes(id)
          ? demoWishes.current.filter((v) => v !== id)
          : [...demoWishes.current, id];
        setWishlist(demoWishes.current);
        return;
      }
      const runtime = await getRuntime(),
        wishes = await runtime.repository.toggleWish(account.puuid, id);
      if (activeRef.current?.puuid === account.puuid) setWishlist(wishes);
    } catch (error) {
      setMessage(safeError(error).message);
    }
  }, []);
  const saveSettings = useCallback(
    async (next: Settings) => {
      try {
        if (Platform.OS === 'web' || activeRef.current?.demo)
          throw new AppError(
            'NATIVE_REQUIRED',
            'Link a real account in a native build before enabling device services.',
          );
        if (next.reminders && !settings.reminders) await enableNotifications();
        if (next.backgroundSync !== settings.backgroundSync)
          await configureBackground(next.backgroundSync);
        const runtime = await getRuntime();
        await runtime.repository.saveSettings(next);
        setSettings(next);
        if (!next.reminders) await cancelAllNotifications();
        else if (
          activeRef.current &&
          snapshot?.store.status === 'ready' &&
          snapshot.accountId === activeRef.current.puuid
        )
          await updateStoreNotifications(
            activeRef.current,
            snapshot.store.data,
            wishlist,
            runtime.repository,
          );
      } catch (error) {
        setMessage(safeError(error).message);
      }
    },
    [settings, snapshot, wishlist],
  );
  const clearCache = useCallback(async () => {
    try {
      const runtime = await getRuntime();
      await runtime.clearCache();
      setSnapshot(null);
      setHistory([]);
      setCatalog({ ...EMPTY_CATALOG });
      setMessage(
        'Cached snapshots, catalog, and observed history cleared. Accounts and wishlists were kept.',
      );
    } catch (error) {
      setMessage(safeError(error).message);
    }
  }, []);
  const matchDetail = useCallback(async (id: string): Promise<MatchDetail> => {
    const account = activeRef.current;
    if (!account) throw new AppError('NO_ACCOUNT', 'Select an account.');
    if (account.demo) return demoMatch(id);
    const runtime = await getRuntime();
    return (await runtime.client(account.puuid)).matchDetail(id);
  }, []);
  const moreMatches = useCallback(async (): Promise<void> => {
    const account = activeRef.current;
    if (!account || account.demo || snapshot?.matches.status !== 'ready') return;
    const stamp = epoch.current;
    setBusy(true);
    try {
      const runtime = await getRuntime(),
        next = await (
          await runtime.client(account.puuid)
        ).matchHistory(snapshot.matches.data.length);
      if (epoch.current !== stamp) return;
      if (!next.length) {
        setMessage('No more matches were returned in this range.');
        return;
      }
      const unique = new Map<string, MatchSummary>(
        [...snapshot.matches.data, ...next].map((m) => [m.id, m]),
      );
      setSnapshot({
        ...snapshot,
        matches: { status: 'ready', fetchedAt: Date.now(), data: [...unique.values()] },
      });
    } catch (error) {
      if (epoch.current === stamp) setMessage(safeError(error).message);
    } finally {
      if (epoch.current === stamp) setBusy(false);
    }
  }, [snapshot]);
  return {
    booting,
    accounts,
    active,
    snapshot: snapshot?.accountId === active?.puuid ? snapshot : null,
    catalog,
    wishlist,
    history,
    settings,
    busy,
    message,
    dismissMessage: () => setMessage(null),
    refresh,
    switchAccount,
    enterDemo: () => switchAccount(DEMO_ACCOUNT),
    leaveDemo: () => switchAccount(accounts[0] ?? null),
    link,
    remove,
    toggleWish,
    saveSettings,
    clearCache,
    matchDetail,
    moreMatches,
  };
}
export type AppModel = ReturnType<typeof useApp>;
