import { clearDiagnostics } from '../core/diagnostics';
import { useSocial } from './useSocial';
import { priorityArtwork } from '../core/artwork';
import { warmArtwork, clearArtworkCache } from '../platform/artwork';
import type { IdentityEdit, PlayerProfile, PlayerRef } from '../core/playerTypes';
import type { LiveGame, Loadout, Section } from '../core/types';
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
  const [linkRevision, setLinkRevision] = useState(0);
  const [observedIdentity, setObservedIdentity] = useState<{
    accountId: string;
    player: PlayerRef;
    at: number;
    source: 'match' | 'loadout';
  } | null>(null);
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
    demoWishes = useRef<string[]>([]),
    demoLoadout = useRef<Loadout | null>(null);
  activeRef.current = active;
  const social = useSocial(active, catalog);
  useEffect(() => {
    if (snapshot?.loadout.status === 'ready' && snapshot.loadout.data.card) {
      const current = snapshot.loadout;
      setObservedIdentity({
        accountId: snapshot.accountId,
        player: {
          subject: snapshot.accountId,
          name: active?.gameName ?? 'You',
          tag: active?.tagLine ?? '',
          card: current.data.card,
          title: current.data.title,
        },
        at: current.fetchedAt,
        source: 'loadout',
      });
    }
  }, [snapshot?.accountId, snapshot?.loadout, active?.gameName, active?.tagLine]);
  useEffect(
    () => warmArtwork(priorityArtwork(snapshot, catalog)),
    [snapshot?.accountId, snapshot?.store, snapshot?.loadout, catalog],
  );
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const runtime = await getRuntime(),
          list = await runtime.repository.accounts(),
          prefs = await runtime.repository.settings(),
          selected = await runtime.repository.selectedAccount();
        if (mounted) {
          setAccounts(list);
          setSettings(prefs);
          setActive(list.find((a) => a.puuid === selected) ?? list[0] ?? null);
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
        const d = makeDemo().snapshot;
        if (demoLoadout.current)
          d.loadout = { status: 'ready', data: demoLoadout.current, fetchedAt: Date.now() };
        setSnapshot(d);
        return;
      }
      const runtime = await getRuntime(),
        next = await runtime.sync(account.puuid);
      const [entries, updatedAccounts] = await Promise.all([
        runtime.repository.history(account.puuid),
        runtime.repository.accounts(),
      ]);
      if (epoch.current === stamp && activeRef.current?.puuid === account.puuid) {
        setSnapshot((previous) => {
          if (!previous || previous.accountId !== next.accountId) return next;
          const newer = <T>(oldValue: Section<T>, newValue: Section<T>) =>
            oldValue.status === 'ready' &&
            newValue.status === 'ready' &&
            oldValue.fetchedAt > newValue.fetchedAt
              ? oldValue
              : newValue;
          return {
            ...next,
            loadout: newer(previous.loadout, next.loadout),
            liveGame: newer(previous.liveGame, next.liveGame),
          };
        });
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
      if (demoLoadout.current)
        demo.snapshot.loadout = {
          status: 'ready',
          data: demoLoadout.current,
          fetchedAt: Date.now(),
        };
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
  }, [active?.puuid, linkRevision, refresh]);
  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => {
      const account = activeRef.current;
      if (
        state === 'active' &&
        account &&
        !account.demo &&
        Date.now() - lastForegroundRefresh.current > 5 * 60000
      ) {
        lastForegroundRefresh.current = Date.now();
        void refresh();
      }
    });
    return () => listener.remove();
  }, [refresh]);
  const switchAccount = useCallback(
    (account: Account | null) => {
      if (!account?.demo)
        void getRuntime()
          .then((r) => r.repository.selectAccount(account?.puuid ?? null))
          .catch(() => {});
      social.disconnectChat();
      clearDiagnostics();
      epoch.current++;
      activeRef.current = account;
      setActive(account);
      setLinkRevision((v) => v + 1);
      setSnapshot(null);
      setMessage(null);
    },
    [social.disconnectChat],
  );
  const link = useCallback(
    async (tokens: LoginTokens, region?: Region, expectedId?: string) => {
      const runtime = await getRuntime(),
        account = await runtime.link(tokens, region, expectedId);
      setAccounts(await runtime.repository.accounts());
      switchAccount(account);
      return account;
    },
    [switchAccount],
  );
  const remove = useCallback(
    async (id: string) => {
      try {
        if (activeRef.current?.puuid === id) await social.prepareChatRemoval();
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
  const setTheme = useCallback(
    async (theme: import('../core/theme').ThemePreference) => {
      const next = { ...settings, theme };
      setSettings(next);
      try {
        await (await getRuntime()).repository.saveSettings(next);
      } catch {
        setMessage('The theme could not be saved. Please retry.');
      }
    },
    [settings],
  );
  const setAutoChatHistory = useCallback(
    async (enabled: boolean) => {
      const next = { ...settings, autoChatHistory: enabled };
      setSettings(next);
      try {
        await (await getRuntime()).repository.saveSettings(next);
      } catch {
        setMessage('The chat-sync preference could not be saved.');
      }
    },
    [settings],
  );
  const clearCache = useCallback(async () => {
    try {
      social.disconnectChat();
      const runtime = await getRuntime();
      await runtime.clearCache();
      await clearArtworkCache();
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
  const matchDetail = useCallback(async (id: string, subject?: string): Promise<MatchDetail> => {
    const account = activeRef.current;
    if (!account) throw new AppError('NO_ACCOUNT', 'Select an account.');
    if (account.demo) return demoMatch(id, subject);
    const stamp = epoch.current,
      runtime = await getRuntime();
    const detail = await (await runtime.client(account.puuid)).matchDetail(id, subject);
    const own = detail.players.find((p) => p.subject === account.puuid);
    if (own?.card && epoch.current === stamp && activeRef.current?.puuid === account.puuid)
      setObservedIdentity((previous) =>
        previous?.accountId === account.puuid && previous.at >= detail.startedAt
          ? previous
          : { accountId: account.puuid, player: own, at: detail.startedAt, source: 'match' },
      );
    return detail;
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
      setSnapshot((previous) =>
        previous?.accountId === account.puuid
          ? {
              ...previous,
              matches: { status: 'ready', fetchedAt: Date.now(), data: [...unique.values()] },
            }
          : previous,
      );
    } catch (error) {
      if (epoch.current === stamp) setMessage(safeError(error).message);
    } finally {
      if (epoch.current === stamp) setBusy(false);
    }
  }, [snapshot]);
  const liveFlight = useRef<{ id: string; work: Promise<Section<LiveGame>> } | null>(null);
  const refreshLive = useCallback(async (): Promise<Section<LiveGame>> => {
    const account = activeRef.current;
    if (!account) return { status: 'error', code: 'NO_ACCOUNT', message: 'Select an account.' };
    if (liveFlight.current?.id === account.puuid) return liveFlight.current.work;
    const stamp = epoch.current;
    const run = async (): Promise<Section<LiveGame>> => {
      let next: Section<LiveGame>;
      try {
        const game = account.demo
          ? makeDemo().snapshot.liveGame
          : {
              status: 'ready' as const,
              data: await (await (await getRuntime()).client(account.puuid)).liveGame(),
              fetchedAt: Date.now(),
            };
        next = game;
      } catch (reason) {
        const e = safeError(reason);
        next = { status: 'error', code: e.code, message: e.message, retryAt: e.retryAt };
      }
      if (epoch.current === stamp && activeRef.current?.puuid === account.puuid)
        setSnapshot((previous) =>
          previous?.accountId === account.puuid ? { ...previous, liveGame: next } : previous,
        );
      return next;
    };
    const work = run();
    liveFlight.current = { id: account.puuid, work };
    try {
      return await work;
    } finally {
      if (liveFlight.current?.work === work) liveFlight.current = null;
    }
  }, []);
  const playerProfile = useCallback(async (player: PlayerRef): Promise<PlayerProfile> => {
    const account = activeRef.current;
    if (!account) throw new AppError('NO_ACCOUNT', 'Select an account.');
    if (player.hidden)
      throw new AppError('PROFILE_PRIVATE', 'This player has hidden their identity.');
    if (account.demo) {
      const demo = makeDemo();
      return {
        player,
        rank: demo.snapshot.rank,
        matches: demo.snapshot.matches,
        fetchedAt: Date.now(),
        identitySource: 'match',
      };
    }
    return (await (await getRuntime()).client(account.puuid)).playerProfile(player.subject);
  }, []);
  const playerMatches = useCallback(async (subject: string, start: number) => {
    const account = activeRef.current;
    if (!account || account.demo) return [];
    return (await (await getRuntime()).client(account.puuid)).matchHistory(start, 20, subject);
  }, []);
  const freshLoadout = useCallback(async (): Promise<Loadout> => {
    const account = activeRef.current;
    if (!account) throw new AppError('NO_ACCOUNT', 'Select an account.');
    if (account.demo) {
      if (demoLoadout.current) return demoLoadout.current;
      const state = makeDemo().snapshot.loadout;
      if (state.status === 'ready') return state.data;
    }
    return (await (await getRuntime()).client(account.puuid)).loadout();
  }, []);
  const saveIdentity = useCallback(
    async (edit: IdentityEdit): Promise<Loadout> => {
      const account = activeRef.current;
      if (!account) throw new AppError('NO_ACCOUNT', 'Select an account.');
      const stamp = epoch.current;
      let data: Loadout;
      if (account.demo) {
        const original = demoLoadout.current
          ? { status: 'ready' as const, data: demoLoadout.current }
          : makeDemo().snapshot.loadout;
        data = {
          ...(original.status === 'ready' ? original.data : { guns: [] }),
          card: edit.cardId
            ? catalog.items[edit.cardId]
            : original.status === 'ready'
              ? original.data.card
              : undefined,
          title: edit.titleId
            ? catalog.items[edit.titleId]
            : original.status === 'ready'
              ? original.data.title
              : undefined,
        };
        demoLoadout.current = data;
      } else data = await (await getRuntime()).saveIdentity(account.puuid, edit);
      if (epoch.current !== stamp || activeRef.current?.puuid !== account.puuid)
        throw new AppError('ACCOUNT_CHANGED', 'The selected account changed.');
      setSnapshot((previous) =>
        previous?.accountId === account.puuid
          ? { ...previous, loadout: { status: 'ready', data, fetchedAt: Date.now() } }
          : previous,
      );
      return data;
    },
    [catalog],
  );
  const playerRank = useCallback(async (player: PlayerRef) => {
    const account = activeRef.current;
    if (!account) throw new AppError('NO_ACCOUNT', 'Select an account.');
    if (account.demo) {
      const r = makeDemo().snapshot.rank;
      if (r.status === 'ready') return r.data;
      throw new AppError('DEMO', 'No demo rank.');
    }
    return (await (await getRuntime()).client(account.puuid)).rank(player.subject);
  }, []);
  return {
    ...social,
    observedIdentity: observedIdentity?.accountId === active?.puuid ? observedIdentity : null,
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
    setTheme,
    setAutoChatHistory,
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
    refreshLive,
    playerProfile,
    playerMatches,
    playerRank,
    freshLoadout,
    saveIdentity,
  };
}
export type AppModel = ReturnType<typeof useApp>;
