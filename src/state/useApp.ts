import { yieldToUI } from '../core/cooperative';
import { livePollInterval } from '../core/refreshPolicy';
import { validateBackupData, type BackupData } from '../core/backup';
import { mergeMatchSummaries, observedMarkets } from '../core/matchArchive';
import { matchPreview } from '../core/matchArchive';
import { useAim } from './useAim';
import type { Friend } from '../core/chatTypes';
import { useActions } from './useActions';
import { useNotificationSetup } from './useNotificationSetup';
import {
  storeResetAt,
  hasUnloadedSections,
  failedSnapshot,
  waitingSnapshot,
  type RefreshReason,
} from '../core/refreshPolicy';
import { mergeSnapshot } from '../core/snapshot';
import { clearDiagnostics, recordRequest } from '../core/diagnostics';
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
  cancelResetNotifications,
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
    demoWishes = useRef<string[]>([]),
    demoLoadout = useRef<Loadout | null>(null);
  activeRef.current = active;
  const appFocused = useRef(true);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const social = useSocial(active, catalog);
  useEffect(() => {
    if (settings.chatAlerts && active && !active.demo && Platform.OS !== 'web') {
      void social.connectChat();
    }
  }, [active?.puuid, settings.chatAlerts]);
  const actions = useActions(
    active,
    catalog,
    snapshot,
    (data) =>
      setSnapshot((previous) =>
        previous && previous.accountId === activeRef.current?.puuid
          ? { ...previous, loadout: { status: 'ready', data, fetchedAt: Date.now() } }
          : previous,
      ),
    setCatalog,
    setSnapshot,
    () => ({ accountId: activeRef.current?.puuid, revision: epoch.current }),
  );
  const aim = useAim(
    active,
    !booting &&
      !busy &&
      snapshot?.accountId === active?.puuid &&
      snapshot?.store.status === 'ready' &&
      snapshot?.wallet.status === 'ready',
    linkRevision,
    () => ({ accountId: activeRef.current?.puuid, revision: epoch.current }),
  );
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
  const syncAccount = useCallback(async (reason: RefreshReason) => {
    const account = activeRef.current;
    if (!account) return;
    const stamp = epoch.current;
    if (
      reason === 'manual' ||
      snapshotRef.current?.accountId !== account.puuid ||
      snapshotRef.current?.store.status !== 'ready'
    ) {
      setBusy(true);
      setMessage(null);
    }
    try {
      if (account.demo) {
        const d = makeDemo().snapshot;
        if (demoLoadout.current)
          d.loadout = { status: 'ready', data: demoLoadout.current, fetchedAt: Date.now() };
        setSnapshot(d);
        return;
      }
      const runtime = await getRuntime(),
        next = await runtime.sync(account.puuid, reason);
      if (epoch.current !== stamp || activeRef.current?.puuid !== account.puuid) return;

      setSnapshot((previous) => mergeSnapshot(previous, next));
      setCatalog(runtime.catalog);
      setBusy(false);

      void yieldToUI()
        .then(() => runtime.loadCatalog())
        .then((meta) => {
          if (epoch.current === stamp && activeRef.current?.puuid === account.puuid)
            setCatalog(meta);
        })
        .catch(() => {});
      const [historyResult, accountsResult] = await Promise.allSettled([
        runtime.repository.history(account.puuid),
        runtime.repository.accounts(),
      ]);
      if (epoch.current === stamp && activeRef.current?.puuid === account.puuid) {
        if (historyResult.status === 'fulfilled') setHistory(historyResult.value);
        else
          recordRequest({
            at: Date.now(),
            service: 'Account cache',
            method: 'READ',
            code: 'HISTORY_READ_FAILED',
            durationMs: 0,
          });
        if (accountsResult.status === 'fulfilled') {
          setAccounts(accountsResult.value);
          const updated = accountsResult.value.find((a) => a.puuid === account.puuid);
          if (updated) {
            activeRef.current = updated;
            setActive(updated);
          }
        } else
          recordRequest({
            at: Date.now(),
            service: 'Account cache',
            method: 'READ',
            code: 'ACCOUNT_LIST_READ_FAILED',
            durationMs: 0,
          });
      }
    } catch (reason) {
      if (epoch.current === stamp && activeRef.current?.puuid === account.puuid) {
        const error = safeError(reason);
        recordRequest({
          at: Date.now(),
          service: 'Account refresh',
          method: 'SYNC',
          code: error.code,
          durationMs: 0,
        });
        setMessage(error.message);

        setSnapshot((previous) => {
          if (previous?.store.status === 'ready') return previous;
          if (error.code === 'LOCAL_COOLDOWN')
            return waitingSnapshot(
              account.puuid,
              previous,
              Math.max(Date.now() + 1000, previous?.nextAutoRefreshAt ?? 0, error.retryAt ?? 0),
            );
          const retryAt = Math.max(Date.now() + 300000, error.retryAt ?? 0);
          return {
            ...failedSnapshot(account.puuid, previous, {
              code: error.code,
              message: error.message,
              retryAt,
            }),
            nextAutoRefreshAt: retryAt,
          };
        });
      }
    } finally {
      if (epoch.current === stamp) setBusy(false);
    }
  }, []);
  const refresh = useCallback(() => syncAccount('manual'), [syncAccount]);
  const refreshAutomatic = useCallback(() => syncAccount('auto'), [syncAccount]);
  const notificationSettled = useCallback(
    async (accountId: string, granted: boolean) => {
      const current = activeRef.current;
      if (!current || current.puuid !== accountId) return;
      const cached = snapshotRef.current;

      if (granted && cached?.accountId === accountId && cached.store.status === 'ready') {
        const runtime = await getRuntime();
        if (activeRef.current?.puuid === accountId)
          await updateStoreNotifications(
            current,
            cached.store.data,
            await runtime.repository.wishlist(accountId),
            runtime.repository,
          );
      }
      const latest = snapshotRef.current;
      if (
        activeRef.current?.puuid === accountId &&
        AppState.currentState === 'active' &&
        (!latest ||
          hasUnloadedSections(latest) ||
          (latest.nextAutoRefreshAt ?? storeResetAt(latest)) <= Date.now())
      )
        await refreshAutomatic();
    },
    [refreshAutomatic],
  );
  useNotificationSetup({
    account: active,
    snapshot,
    booting,
    loading: busy,
    settings,
    settled: notificationSettled,
    failed: setMessage,
  });
  useEffect(() => {
    if (
      booting ||
      busy ||
      !active ||
      active.demo ||
      Platform.OS === 'web' ||
      snapshot?.accountId !== active.puuid ||
      snapshot.store.status !== 'ready' ||
      snapshot.wallet.status !== 'ready'
    )
      return;
    void configureBackground(settings.backgroundSync).catch(() =>
      recordRequest({
        at: Date.now(),
        service: 'Background setup',
        method: 'LOCAL',
        code: 'BACKGROUND_SETUP_FAILED',
        durationMs: 0,
      }),
    );
  }, [
    booting,
    busy,
    active?.puuid,
    snapshot?.accountId,
    snapshot?.store.status,
    snapshot?.wallet.status,
    settings.backgroundSync,
  ]);
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
        const savedAccount = await runtime.savedAccount(active.puuid).catch(() => null);
        if (savedAccount && epoch.current === stamp) {
          activeRef.current = savedAccount;
          setActive(savedAccount);
          setAccounts((list) =>
            list.map((a) => (a.puuid === savedAccount.puuid ? savedAccount : a)),
          );
        }
        const [cached, wishes, entries, savedCatalog] = await Promise.allSettled([
          runtime.repository.snapshot(active.puuid),
          runtime.repository.wishlist(active.puuid),
          runtime.repository.history(active.puuid),
          runtime.repository.catalog(),
        ]);
        if (epoch.current !== stamp || activeRef.current?.puuid !== active.puuid) return;
        if (cached.status === 'fulfilled' && cached.value) {
          const restored = cached.value;
          setSnapshot((previous) =>
            previous?.accountId === active.puuid ? mergeSnapshot(restored, previous) : restored,
          );
        }
        if (wishes.status === 'fulfilled') setWishlist(wishes.value);
        if (entries.status === 'fulfilled') setHistory(entries.value);
        if (savedCatalog.status === 'fulfilled' && savedCatalog.value)
          setCatalog(savedCatalog.value);
        if (
          [cached, wishes, entries, savedCatalog].some((result) => result.status === 'rejected')
        ) {
          recordRequest({
            at: Date.now(),
            service: 'Account cache',
            method: 'READ',
            code: 'PARTIAL_CACHE_RECOVERY',
            durationMs: 0,
          });
        }

        await refreshAutomatic();
      } catch (error) {
        if (epoch.current === stamp) setMessage(safeError(error).message);
      }
    })();
  }, [active?.puuid, linkRevision, refreshAutomatic]);
  useEffect(() => {
    if (!active || active.demo) return;
    let timer: ReturnType<typeof setTimeout> | undefined,
      stopped = false,
      queued = false;
    const visible = () => !stopped && appFocused.current && AppState.currentState === 'active';
    const schedule = () => {
      clearTimeout(timer);
      const current = snapshotRef.current;
      if (!visible() || !current || current.accountId !== active.puuid) return;
      const at = current.nextAutoRefreshAt ?? storeResetAt(current);
      timer = setTimeout(check, Math.min(2147480000, Math.max(1000, at - Date.now())));
    };
    const check = () => {
      if (!visible()) return;
      const current = snapshotRef.current;
      if (
        !current ||
        current.accountId !== active.puuid ||
        (current.nextAutoRefreshAt ?? storeResetAt(current)) <= Date.now()
      )
        void refreshAutomatic();
      else schedule();
    };
    const resume = () => {
      if (queued) return;
      queued = true;

      void Promise.resolve().then(() => {
        queued = false;
        check();
      });
    };
    schedule();
    const state = AppState.addEventListener('change', (value) => {
      clearTimeout(timer);
      if (value === 'active') resume();
    });
    const blur =
      Platform.OS === 'android'
        ? AppState.addEventListener('blur', () => {
            appFocused.current = false;
            clearTimeout(timer);
          })
        : undefined;
    const focus =
      Platform.OS === 'android'
        ? AppState.addEventListener('focus', () => {
            appFocused.current = true;
            resume();
          })
        : undefined;
    return () => {
      stopped = true;
      clearTimeout(timer);
      state.remove();
      blur?.remove();
      focus?.remove();
    };
  }, [active?.puuid, snapshot?.nextAutoRefreshAt, snapshot?.store, refreshAutomatic]);
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
      await runtime.markAimLogin(account.puuid).catch(() =>
        recordRequest({
          at: Date.now(),
          service: 'Aim settings',
          method: 'LOCAL',
          code: 'LOGIN_SYNC_DEFERRED',
          durationMs: 0,
        }),
      );
      setAccounts((list) =>
        list.some((a) => a.puuid === account.puuid)
          ? list.map((a) => (a.puuid === account.puuid ? account : a))
          : [...list, account],
      );
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
  const signOut = useCallback(
    async (id: string) => {
      if (activeRef.current?.puuid === id) await social.prepareChatRemoval();
      const runtime = await getRuntime();
      await runtime.signOut(id);
      const list = await runtime.repository.accounts();
      setAccounts(list);
      if (activeRef.current?.puuid === id) switchAccount(list[0] ?? null);
    },
    [switchAccount, social.prepareChatRemoval],
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
      const cached = await runtime.repository.snapshot(account.puuid);
      if (cached?.store.status === 'ready' && !cached.store.warning)
        await updateStoreNotifications(account, cached.store.data, wishes, runtime.repository);
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
        if (
          (next.reminders && !settings.reminders) ||
          (next.wishlistAlerts && !settings.wishlistAlerts) ||
          (next.chatAlerts && !settings.chatAlerts)
        )
          await enableNotifications();
        if (next.backgroundSync !== settings.backgroundSync)
          await configureBackground(next.backgroundSync);
        const runtime = await getRuntime();
        await runtime.repository.saveSettings(next);
        setSettings(next);
        if (!next.reminders && settings.reminders) await cancelResetNotifications();
        if (!next.reminders && !next.wishlistAlerts && !next.chatAlerts)
          await cancelAllNotifications();
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
  const ensureCatalog = useCallback(async () => {
    const account = activeRef.current;
    if (account?.demo) return;
    const runtime = await getRuntime(),
      next = await runtime.loadCatalog();
    if (activeRef.current?.puuid === account?.puuid) setCatalog(next);
  }, []);
  const refreshMedia = useCallback(async () => {
    const fresh = await (await getRuntime()).refreshMedia();
    setCatalog(fresh);
  }, []);
  const setAutoplayVideos = useCallback(
    async (enabled: boolean) => {
      const next = { ...settings, autoplayVideos: enabled };
      setSettings(next);
      try {
        await (await getRuntime()).repository.saveSettings(next);
      } catch {
        setMessage('Video preference could not be saved.');
      }
    },
    [settings],
  );
  const setVideoSound = useCallback(
    async (enabled: boolean) => {
      if ((settings.videoSound !== false) === enabled) return;
      const next = { ...settings, videoSound: enabled };
      setSettings(next);
      try {
        await (await getRuntime()).repository.saveSettings(next);
      } catch {
        setMessage('Video sound preference could not be saved.');
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
      setLinkRevision((value) => value + 1);
      setMessage('Game cache cleared. Saved accounts and chats are kept.');
    } catch (error) {
      setMessage(safeError(error).message);
    }
  }, []);
  const matchDetail = useCallback(
    async (id: string, subject?: string): Promise<MatchDetail> => {
      const account = activeRef.current;
      if (!account) throw new AppError('NO_ACCOUNT', 'Select an account.');
      if (account.demo) return demoMatch(id, subject);
      const stamp = epoch.current,
        runtime = await getRuntime();

      const savedReport = await runtime.repository.archivedReport(
        account.puuid,
        subject ?? account.puuid,
        id,
      );
      if (!savedReport) await runtime.loadCatalog().catch(() => {});
      if (epoch.current !== stamp || activeRef.current?.puuid !== account.puuid)
        throw new AppError('ACCOUNT_CHANGED', 'The selected account changed.');
      setCatalog(runtime.catalog);
      const detail = await runtime.matchReport(account.puuid, id, subject ?? account.puuid);
      if (epoch.current === stamp && (!subject || subject === account.puuid))
        setSnapshot((previous) =>
          previous?.accountId === account.puuid && previous.matches.status === 'ready'
            ? {
                ...previous,
                matches: {
                  ...previous.matches,
                  data: previous.matches.data.map((m) =>
                    m.id === id
                      ? {
                          ...m,
                          preview: matchPreview(detail),
                          previewComplete: detail.completed !== false,
                        }
                      : m,
                  ),
                },
              }
            : previous,
        );
      const own = detail.players.find((p) => p.subject === account.puuid);
      if (own?.card && epoch.current === stamp && activeRef.current?.puuid === account.puuid)
        setObservedIdentity((previous) =>
          previous?.accountId === account.puuid && previous.at >= detail.startedAt
            ? previous
            : { accountId: account.puuid, player: own, at: detail.startedAt, source: 'match' },
        );
      if (epoch.current === stamp && activeRef.current?.puuid === account.puuid)
        void social.cacheMatchFriends(detail.players, detail.startedAt).catch(() => {});
      return detail;
    },
    [social.cacheMatchFriends],
  );
  const moreMatches = useCallback(async (): Promise<void> => {
    const account = activeRef.current;
    if (!account || account.demo || snapshot?.matches.status !== 'ready') return;
    const stamp = epoch.current;
    try {
      const runtime = await getRuntime(),
        next = await runtime.historyPage(
          account.puuid,
          account.puuid,
          snapshot.matches.data.length,
        );
      if (epoch.current !== stamp) return;
      if (!next.length) {
        setMessage('No more matches were returned in this range.');
        return;
      }
      setSnapshot((previous) =>
        previous?.accountId === account.puuid
          ? {
              ...previous,
              matches: {
                status: 'ready',
                fetchedAt: Date.now(),
                data: mergeMatchSummaries(
                  previous.matches.status === 'ready' ? previous.matches.data : [],
                  next,
                ),
              },
            }
          : previous,
      );
    } catch (error) {
      if (epoch.current === stamp) setMessage(safeError(error).message);
    }
  }, [snapshot]);
  const refreshProfile = useCallback(async (): Promise<Snapshot | null> => {
    const account = activeRef.current;
    if (!account) return null;
    const stamp = epoch.current;
    if (account.demo) return snapshotRef.current;
    const runtime = await getRuntime(),
      profile = await runtime.profile(account.puuid);
    if (stamp !== epoch.current || activeRef.current?.puuid !== account.puuid) return null;
    if (profile)
      setSnapshot((previous) =>
        previous?.accountId === account.puuid ? mergeSnapshot(previous, profile) : profile,
      );
    return profile;
  }, []);
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
          : await (await getRuntime()).live(account.puuid);
        next =
          account.demo && game.status === 'ready'
            ? {
                ...game,
                data: { ...game.data, nextCheckAt: Date.now() + livePollInterval(game.data) },
              }
            : game;
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
  const cachedPlayerProfile = useCallback(
    async (player: PlayerRef): Promise<PlayerProfile | null> => {
      const account = activeRef.current;
      if (!account || account.demo) return null;
      const stamp = epoch.current;
      const runtime = await getRuntime(),
        rows = await runtime.repository.archivedMatches(account.puuid, player.subject, 0, 40);
      if (epoch.current !== stamp || !rows.length) return null;
      return {
        player,
        identitySource: 'match',
        fetchedAt: 0,
        rank: { status: 'error', code: 'RANK_NOT_CACHED', message: 'Refreshing rank...' },
        matches: { status: 'ready', data: rows, fetchedAt: 0 },
      };
    },
    [],
  );
  const playerProfile = useCallback(
    async (player: PlayerRef): Promise<PlayerProfile> => {
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
      const stamp = epoch.current,
        runtime = await getRuntime(),
        client = await runtime.client(account.puuid);
      client.scope.player(player.subject);
      const data = await client.playerProfile(player.subject, async (matchId) => {
        const detail = await runtime.matchReport(account.puuid, matchId, player.subject);
        const identity = detail.players.find((p) => p.subject === player.subject && !p.hidden);
        return identity ? { player: identity, observedAt: detail.startedAt } : undefined;
      });
      if (epoch.current !== stamp || activeRef.current?.puuid !== account.puuid)
        throw new AppError('ACCOUNT_CHANGED', 'The account changed.');
      if (data.matches.status === 'ready')
        await runtime.repository.saveArchivedMatches(
          account.puuid,
          player.subject,
          data.matches.data,
        );
      const cachedMatches = await runtime.repository.archivedMatches(
        account.puuid,
        player.subject,
        0,
        40,
      );
      if (cachedMatches.length)
        data.matches =
          data.matches.status === 'ready'
            ? { ...data.matches, data: cachedMatches }
            : {
                status: 'ready',
                data: cachedMatches,
                fetchedAt: 0,
                warning: {
                  code: data.matches.code,
                  message: data.matches.message,
                  retryAt: data.matches.retryAt,
                },
              };
      if (epoch.current !== stamp || activeRef.current?.puuid !== account.puuid)
        throw new AppError('ACCOUNT_CHANGED', 'The account changed.');
      await social
        .cacheFriendProfile(
          player.subject,
          data.identityObservedAt ? data.player : undefined,
          data.identityObservedAt ?? 0,
        )
        .catch(() => {});
      return data;
    },
    [social.cacheFriendProfile],
  );
  const refreshFriendPortrait = useCallback(
    async (friend: Friend) => {
      const account = activeRef.current;
      if (!account || account.demo || friend.hidden) return;
      const stamp = epoch.current,
        runtime = await getRuntime(),
        client = await runtime.client(account.puuid);
      client.scope.player(friend.subject);
      const value = await runtime.friendIdentity(account.puuid, friend.subject);
      if (!value || stamp !== epoch.current || activeRef.current?.puuid !== account.puuid) return;
      await social.cacheFriendProfile(friend.subject, value.player, value.observedAt);
    },
    [social.cacheFriendProfile],
  );
  const playerMatches = useCallback(async (subject: string, start: number) => {
    const account = activeRef.current;
    if (!account || account.demo) return [];
    return (await getRuntime()).historyPage(account.puuid, subject, start, 20);
  }, []);
  const liveEquipment = useCallback(
    async (matchId: string): Promise<Section<import('../core/matchTypes').LiveEquipment>> => {
      const account = activeRef.current;
      if (!account) return { status: 'error', code: 'NO_ACCOUNT', message: 'Select an account.' };
      const stamp = epoch.current;
      if (account.demo) {
        const demo = makeDemo(),
          game = demo.snapshot.liveGame;
        if (game.status !== 'ready' || game.data.matchId !== matchId)
          return { status: 'error', code: 'MATCH_SCOPE', message: 'Open the current demo match.' };
        const skins = Object.values(demo.catalog.items).filter((i) => i.kind === 'skin');
        return {
          status: 'ready',
          fetchedAt: Date.now(),
          data: {
            matchId,
            observedAt: Date.now(),
            players: (game.data.players ?? []).map((p, index) => ({
              subject: p.subject,
              weapons: skins
                .filter((s, i) => i < 6 || index % 2 === 0)
                .map((s) => ({
                  weaponId: s.weaponId ?? s.id,
                  weapon: s.weapon ?? 'Weapon',
                  skin: s,
                })),
            })),
          },
        };
      }
      const result = await (await getRuntime()).liveEquipment(account.puuid, matchId);
      if (epoch.current !== stamp || activeRef.current?.puuid !== account.puuid)
        return { status: 'error', code: 'ACCOUNT_CHANGED', message: 'The account changed.' };
      return result;
    },
    [],
  );
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
  const savedMarkets = useCallback(async () => {
    const a = activeRef.current;
    if (!a) return [];
    if (a.demo) {
      const d = makeDemo().snapshot.store;
      return d.status === 'ready' ? observedMarkets(a.puuid, d.data) : [];
    }
    return (await getRuntime()).repository.marketHistory(a.puuid);
  }, []);
  const exportBackupData = useCallback(
    async (includeReports: boolean): Promise<BackupData> => {
      const a = activeRef.current;
      if (!a) throw new AppError('NO_ACCOUNT', 'Select an account.');
      if (!a.demo)
        return (await getRuntime()).repository.exportAccountData(a.puuid, includeReports);
      const d = snapshotRef.current ?? makeDemo().snapshot;
      return validateBackupData(
        JSON.parse(
          JSON.stringify({
            account: {
              puuid: a.puuid,
              gameName: a.gameName,
              tagLine: a.tagLine,
              region: a.region,
              shard: a.shard,
            },
            presets: await actions.listPresets(),
            aimPresets: aim.aimPresets,
            wishlist: demoWishes.current,
            matches:
              d.matches.status === 'ready'
                ? d.matches.data.map((summary) => ({ subject: a.puuid, summary }))
                : [],
            reports:
              includeReports && d.matches.status === 'ready'
                ? d.matches.data.slice(0, 3).map((m) => ({
                    subject: a.puuid,
                    savedAt: Date.now(),
                    completed: true,
                    detail: demoMatch(m.id),
                  }))
                : [],
            markets: d.store.status === 'ready' ? observedMarkets(a.puuid, d.store.data) : [],
            storeHistory: history,
            profile: { rank: d.rank, xp: d.xp, loadout: d.loadout, progression: d.progression },
            settings,
          }),
        ),
      );
    },
    [actions.listPresets, aim.aimPresets, history, settings],
  );
  const restoreBackupData = useCallback(
    async (input: BackupData, restoreSettings: boolean) => {
      const a = activeRef.current,
        stamp = epoch.current;
      if (!a) throw new AppError('NO_ACCOUNT', 'Select an account.');
      const guard = () => {
        if (epoch.current !== stamp || activeRef.current?.puuid !== a.puuid)
          throw new AppError('ACCOUNT_CHANGED', 'The selected account changed.');
      };
      const data = validateBackupData(input);
      if (data.account.puuid !== a.puuid)
        throw new AppError('BACKUP_ACCOUNT', 'Sign in to the account named in this backup first.');
      if (a.demo) {
        const existing = await actions.listPresets();
        for (const p of data.presets)
          if (!existing.some((x) => x.id === p.id))
            await actions.savePreset(p.name, p.weapons, p.id);
        for (const p of data.aimPresets)
          if (!aim.aimPresets.some((x) => x.id === p.id))
            await aim.saveAimPreset(p.name, p.profile, p.sensitivity, p.id);
        guard();
        demoWishes.current = [...new Set([...demoWishes.current, ...data.wishlist])];
        setWishlist(demoWishes.current);
        setHistory((previous) => [
          ...new Map([...data.storeHistory, ...previous].map((x) => [x.id, x])).values(),
        ]);
        setSnapshot((previous) => {
          if (!previous) return previous;
          const own = data.matches.filter((m) => m.subject === a.puuid).map((m) => m.summary);
          return {
            ...previous,
            ...data.profile,
            matches: {
              status: 'ready',
              fetchedAt: Date.now(),
              data: mergeMatchSummaries(
                previous.matches.status === 'ready' ? previous.matches.data : [],
                own,
              ),
            },
          };
        });
        if (restoreSettings) {
          const next = { ...data.settings, allowPurchases: settings.allowPurchases };
          setSettings(next);
          await (await getRuntime()).repository.saveSettings(next);
        }
        return;
      }
      const runtime = await getRuntime();
      guard();
      await runtime.repository.restoreAccountData(a.puuid, data, restoreSettings, guard);
      guard();
      const [saved, wishes, entries, prefs] = await Promise.all([
        runtime.repository.snapshot(a.puuid),
        runtime.repository.wishlist(a.puuid),
        runtime.repository.history(a.puuid),
        runtime.repository.settings(),
      ]);
      guard();
      setSnapshot(saved);
      setWishlist(wishes);
      setHistory(entries);
      setSettings(prefs);
      setLinkRevision((v) => v + 1);
    },
    [actions.listPresets, actions.savePreset, aim.aimPresets, aim.saveAimPreset, settings],
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
    ...actions,
    ...aim,
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
    ensureCatalog,
    setTheme,
    setAutoChatHistory,
    setAutoplayVideos,
    setVideoSound,
    savedMarkets,
    exportBackupData,
    restoreBackupData,
    refreshMedia,
    refresh,
    switchAccount,
    enterDemo: () => switchAccount(DEMO_ACCOUNT),
    leaveDemo: () => switchAccount(accounts[0] ?? null),
    link,
    remove,
    signOut,
    toggleWish,
    saveSettings,
    clearCache,
    matchDetail,
    moreMatches,
    refreshLive,
    refreshProfile,
    cachedPlayerProfile,
    playerProfile,
    playerMatches,
    playerRank,
    refreshFriendPortrait,
    liveEquipment,
    freshLoadout,
    saveIdentity,
  };
}
export type AppModel = ReturnType<typeof useApp>;
