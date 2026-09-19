import {
  startHistoryBackground,
  type HistoryBackgroundLease,
} from '../platform/historySyncBackground';
import { validFriendTarget } from '../core/friendRequests';
import type { FriendAction, FriendRequest } from '../core/chatTypes';
import type { PlayerRef } from '../core/playerTypes';
import { withCachedFriends, observedFriend } from '../core/friendIdentity';
import { AutoHistoryGate } from '../core/autoHistory';
import {
  RosterHistorySync,
  EMPTY_HISTORY_SYNC,
  type HistorySyncProgress,
} from '../core/rosterHistorySync';
import { notifyChat } from '../platform/notifications';
import { recordRequest } from '../core/diagnostics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import type { Account, Catalog } from '../core/types';
import type {
  ChatState,
  Friend,
  ChatMessage,
  Conversation,
  MessageCursor,
} from '../core/chatTypes';
import type { ChatStore } from '../core/chatStore';
import { EMPTY_CHAT } from '../core/chatTypes';
import { RiotChat } from '../core/chat';
import { AppError, safeError } from '../core/validation';
import { messageText } from '../core/xmppXml';
import { mergeMessages } from '../core/messageHistory';
import { demoMatch, makeDemo } from '../core/demo';
import { getRuntime } from '../platform/runtime';
import { randomHex } from '../platform/secure';
import { chatTransport } from '../platform/chatTransport';
import { openChatStorage } from '../platform/chatStorage';
import { demoChatStorage } from '../platform/demoChatStorage';

type LocalState = {
  id?: string;
  conversations: Conversation[];
  messages: Record<string, ChatMessage[]>;
  cursors: Record<string, MessageCursor | undefined>;
  error?: string;
  loading: boolean;
};
const emptyLocal: LocalState = { conversations: [], messages: {}, cursors: {}, loading: false };
export function useSocial(account: Account | null, catalog: Catalog, backgroundEnabled = true) {
  const [value, setValue] = useState<{ id?: string; state: ChatState }>({ state: EMPTY_CHAT });
  const [local, setLocal] = useState<LocalState>(emptyLocal);
  const autoGate = useRef(new AutoHistoryGate());
  const [historySync, setHistorySync] = useState<{ id?: string; progress: HistorySyncProgress }>({
    progress: EMPTY_HISTORY_SYNC,
  });
  const batchSync = useRef<{ id: string; queue: RosterHistorySync } | null>(null);
  const backgroundLease = useRef<HistoryBackgroundLease | null>(null),
    backgroundWanted = useRef(backgroundEnabled);
  backgroundWanted.current = backgroundEnabled;
  const [historyBackground, setHistoryBackground] = useState<{ active: boolean; note?: string }>({
    active: false,
  });
  const [historySyncStarting, setHistorySyncStarting] = useState(false),
    starting = useRef(false);
  const autoResume = useRef(false),
    syncRef = useRef<() => Promise<unknown>>(async () => {});
  const session = useRef<RiotChat | null>(null),
    active = useRef(account),
    meta = useRef(catalog),
    latest = useRef(value);
  active.current = account;
  meta.current = catalog;
  latest.current = value;
  const epoch = useRef(0),
    wanted = useRef(false),
    pending = useRef(false),
    attempts = useRef(0),
    openSubject = useRef<string | undefined>(undefined);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    localTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const connectRef = useRef<() => Promise<void>>(async () => {});
  const storeFor = useCallback(
    (a: Account) => (a.demo ? Promise.resolve(demoChatStorage) : openChatStorage(a.puuid)),
    [],
  );
  const refreshLocal = useCallback(
    async (a: Account, store?: ChatStore) => {
      try {
        const rows = await (store ?? (await storeFor(a))).conversations();
        if (active.current?.puuid === a.puuid)
          setLocal((old) => ({
            ...(old.id === a.puuid ? old : emptyLocal),
            id: a.puuid,
            conversations: rows,
            loading: false,
            error: undefined,
          }));
      } catch {
        if (active.current?.puuid === a.puuid)
          setLocal((old) => ({
            ...old,
            id: a.puuid,
            loading: false,
            error: 'Saved chat history could not be opened. Existing data has not been replaced.',
          }));
      }
    },
    [storeFor],
  );
  const scheduleLocal = useCallback(
    (a: Account, store: ChatStore) => {
      if (active.current?.puuid !== a.puuid) return;
      clearTimeout(localTimer.current);
      localTimer.current = setTimeout(() => void refreshLocal(a, store), 150);
    },
    [refreshLocal],
  );
  const stop = useCallback((clear = false) => {
    batchSync.current?.queue.stop('Sync paused. Reconnect chat to continue.', true);
    const lease = backgroundLease.current;
    backgroundLease.current = null;
    void lease?.finish('paused');
    setHistoryBackground({ active: false });
    clearTimeout(reconnectTimer.current);
    clearTimeout(localTimer.current);
    epoch.current++;
    pending.current = false;
    session.current?.disconnect(clear);
    if (clear) session.current = null;
    const previous = latest.current;
    const next = {
      ...previous,
      state: clear
        ? EMPTY_CHAT
        : {
            ...previous.state,
            status: 'disconnected' as const,
            selfPresence: undefined,
            friends: previous.state.friends.map((f) => ({ ...f, presence: 'offline' as const })),
          },
    };
    latest.current = next;
    setValue(next);
  }, []);
  const connectChat = useCallback(async () => {
    const a = active.current;
    if (
      !a ||
      pending.current ||
      (latest.current.id === a.puuid &&
        ['ready', 'connecting', 'authenticating'].includes(latest.current.state.status))
    )
      return;
    wanted.current = true;
    clearTimeout(reconnectTimer.current);
    const stamp = ++epoch.current;
    pending.current = true;
    const previous = latest.current.id === a.puuid ? latest.current.state : EMPTY_CHAT;
    const publish = (state: ChatState) => {
      if (stamp !== epoch.current || active.current?.puuid !== a.puuid) return;
      if (
        latest.current.state.status !== state.status ||
        latest.current.state.errorCode !== state.errorCode
      )
        recordRequest({
          at: Date.now(),
          service: 'Chat connection',
          method: 'XMPP',
          code: state.errorCode ?? state.status.toUpperCase(),
          durationMs: 0,
        });
      latest.current = { id: a.puuid, state };
      setValue(latest.current);
      if (state.status === 'ready') {
        attempts.current = 0;
        if (autoResume.current && AppState.currentState === 'active') {
          autoResume.current = false;
          setTimeout(() => void syncRef.current().catch(() => {}), 0);
        }
      }
      if (
        state.status === 'error' &&
        wanted.current &&
        AppState.currentState === 'active' &&
        [
          'CHAT_NETWORK',
          'SESSION_EXPIRED',
          'RENEWAL_WAIT',
          'AUTH_UNAVAILABLE',
          'SERVICE_UNAVAILABLE',
          'NETWORK',
          'TIMEOUT',
          'RATE_LIMIT',
        ].includes(state.errorCode ?? '') &&
        attempts.current < 6
      ) {
        clearTimeout(reconnectTimer.current);
        const delay = Math.max(
          Math.min(300000, 10000 * 2 ** attempts.current++),
          (state.retryAt ?? 0) - Date.now(),
        );
        reconnectTimer.current = setTimeout(() => void connectRef.current(), delay);
      }
    };
    publish({ ...previous, status: 'connecting', selfPresence: undefined, error: undefined });
    try {
      const store = await storeFor(a);
      if (stamp !== epoch.current) return;
      if (a.demo) {
        const entries = makeDemo().snapshot.matches,
          players = demoMatch(entries.status === 'ready' ? entries.data[0]!.id : '').players;
        const friends: Friend[] = players
          .filter((p) => !p.self)
          .slice(0, 5)
          .map((p, index) => ({
            ...p,
            tier: p.tier ?? undefined,
            jid: `${p.subject}@demo.pvp.net`,
            presence: index === 0 ? 'in_game' : index === 1 ? 'online' : 'offline',
            presenceSource: index < 2 ? 'valorant' : 'riot',
            game: index < 2 ? 'VALORANT' : undefined,
            activity: index === 1 ? 'In menus' : undefined,
            map: index === 0 ? 'Lotus' : undefined,
          }));
        const friendRequests: FriendRequest[] =
          previous.friendRequests ??
          players
            .filter((p) => !p.self)
            .slice(5, 8)
            .map((p, index) => ({
              ...p,
              jid: `${p.subject}@demo.pvp.net`,
              direction: index < 2 ? 'incoming' : 'outgoing',
              updatedAt: Date.now(),
            }));
        await store.saveFriends(friends);
        publish({ ...previous, status: 'ready', error: undefined, friends, friendRequests });
        await refreshLocal(a, store);
        return;
      }
      if (Platform.OS === 'web')
        throw new AppError('NATIVE_REQUIRED', 'Use a native build to connect Riot chat.');
      const client = await (await getRuntime()).client(a.puuid),
        bootstrap = await client.chatBootstrap();
      if (stamp !== epoch.current || active.current?.puuid !== a.puuid || !wanted.current) return;
      session.current?.disconnect();
      const identities = new Map<string, string>();
      const chat = new RiotChat(
        chatTransport,
        meta.current,
        publish,
        (friends) => {
          if (stamp !== epoch.current || active.current?.puuid !== a.puuid) return;
          const changed = friends.filter((f) => {
            client.scope.remember(f, 'friend');
            const id = JSON.stringify([
              f.name,
              f.tag,
              f.card?.id,
              f.title?.id,
              f.level,
              f.hideLevel,
            ]);
            if (identities.get(f.subject) === id) return false;
            identities.set(f.subject, id);
            return true;
          });
          if (changed.length)
            void store
              .saveFriends(changed)
              .then(() => scheduleLocal(a, store))
              .catch(() => {
                if (stamp === epoch.current && active.current?.puuid === a.puuid)
                  setLocal((old) => ({
                    ...old,
                    error: 'Friend names could not be saved locally.',
                  }));
              });
        },
        Date.now,
        {
          newId: randomHex,
          incoming: async (message) => {
            if (stamp === epoch.current && active.current?.puuid === a.puuid)
              await notifyChat(
                a.puuid,
                message,
                openSubject.current,
                AppState.currentState === 'active',
                (await getRuntime()).repository,
              );
          },
          presenceDelayMs: 100,
          saveMessage: async (message) => {
            await store.save(message);
            if (stamp === epoch.current && active.current?.puuid === a.puuid) {
              if (openSubject.current === message.subject && AppState.currentState === 'active')
                await store.markRead(message.subject);
              scheduleLocal(a, store);
            }
          },
        },
      );
      chat.restoreMessages(previous);
      session.current = chat;
      chat.start(bootstrap);
      chat.markRead(openSubject.current);
    } catch (reason) {
      const error = safeError(reason);
      publish({
        ...previous,
        status: 'error',
        error: error.message,
        errorCode: error.code,
        retryAt: error.retryAt,
      });
    } finally {
      if (stamp === epoch.current) pending.current = false;
    }
  }, [storeFor, refreshLocal, scheduleLocal]);
  connectRef.current = connectChat;
  useEffect(() => {
    autoResume.current = false;
    autoGate.current.clear();
    batchSync.current?.queue.stop();
    batchSync.current = null;
    setHistorySync({ id: account?.puuid, progress: EMPTY_HISTORY_SYNC });
    wanted.current = false;
    attempts.current = 0;
    openSubject.current = undefined;
    stop(true);
    clearTimeout(localTimer.current);
    setLocal({ ...emptyLocal, id: account?.puuid, loading: !!account });
    setValue({ id: account?.puuid, state: EMPTY_CHAT });
    if (account) void refreshLocal(account);
    return () => {
      wanted.current = false;
      batchSync.current?.queue.stop();
      batchSync.current = null;
      stop(true);
      clearTimeout(localTimer.current);
    };
  }, [account?.puuid, stop, refreshLocal]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const subscription = AppState.addEventListener('change', (state) => {
      clearTimeout(timer);
      if (state === 'background') {
        session.current?.markRead(undefined);
        if (backgroundLease.current?.active()) return;
        autoResume.current = batchSync.current?.queue.progress.status === 'running';
        timer = setTimeout(() => {
          if (AppState.currentState !== 'background' || backgroundLease.current?.active()) return;
          stop();
        }, 500);
      } else if (state === 'active' && wanted.current) {
        attempts.current = 0;
        session.current?.markRead(openSubject.current);
        const account = active.current,
          subject = openSubject.current;
        if (account && subject)
          void storeFor(account)
            .then(async (store) => {
              if (active.current?.puuid === account.puuid && AppState.currentState === 'active')
                await store.markRead(subject);
            })
            .catch(() => {});
        void connectRef.current();
      }
    });
    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  }, [stop, storeFor]);
  const disconnectChat = useCallback(() => {
    const closing = session.current,
      a = active.current;
    autoResume.current = false;
    wanted.current = false;
    stop();
    const stamp = epoch.current;
    void closing
      ?.flushPersistence()
      .then(() => {
        if (a && stamp === epoch.current && active.current?.puuid === a.puuid) void refreshLocal(a);
      })
      .catch(() => {
        if (a && active.current?.puuid === a.puuid)
          setLocal((old) => ({
            ...old,
            error: 'Some messages are waiting for local storage. Existing history was kept.',
          }));
      });
  }, [stop, refreshLocal]);
  const prepareChatRemoval = useCallback(async () => {
    autoResume.current = false;
    wanted.current = false;
    const closing = session.current;
    stop(true);
    await closing?.flushPersistence();
    clearTimeout(localTimer.current);
  }, [stop]);
  const loadChatMessages = useCallback(
    async (subject: string, before?: MessageCursor) => {
      const a = active.current;
      if (!a) return;
      try {
        const store = await storeFor(a),
          page = await store.messages(subject, before);
        if (active.current?.puuid !== a.puuid) return;
        setLocal((old) => {
          const base = old.id === a.puuid ? old : emptyLocal;
          return {
            ...base,
            id: a.puuid,
            messages: {
              ...base.messages,
              [subject]: mergeMessages(
                base.messages[subject] ?? [],
                page.messages,
                Number.MAX_SAFE_INTEGER,
              ),
            },
            cursors: {
              ...base.cursors,
              [subject]:
                !before && (base.messages[subject]?.length ?? 0) > page.messages.length
                  ? base.cursors[subject]
                  : page.older,
            },
            error: undefined,
          };
        });
        if (!before) session.current?.hydrateMessages(subject, page.messages);
        await refreshLocal(a, store);
      } catch {
        if (active.current?.puuid === a.puuid)
          setLocal((old) => ({
            ...old,
            error: 'Saved messages could not be loaded. Please retry.',
          }));
      }
    },
    [storeFor, refreshLocal],
  );
  const sendChat = useCallback(
    async (subject: string, raw: string) => {
      const body = messageText(raw),
        a = active.current;
      if (!a) throw new AppError('NO_ACCOUNT', 'Select an account.');
      if (a.demo) {
        const message: ChatMessage = {
          id: `demo-${Date.now()}-${Math.random()}`,
          subject,
          body,
          at: Date.now(),
          direction: 'outgoing',
          state: 'sent',
          source: 'outpost',
        };
        await demoChatStorage.save(message);
        if (active.current?.puuid === a.puuid) {
          setValue((v) => ({
            ...v,
            state: {
              ...v.state,
              messages: {
                ...v.state.messages,
                [subject]: mergeMessages(v.state.messages[subject] ?? [], [message]),
              },
            },
          }));
          await loadChatMessages(subject);
        }
        return;
      }
      if (!session.current)
        throw new AppError('CHAT_OFFLINE', 'Connect chat before sending a message.');
      await session.current.send(subject, body);
    },
    [loadChatMessages],
  );
  const changeFriend = useCallback(async (action: FriendAction, player: PlayerRef) => {
    const a = active.current,
      stamp = epoch.current;
    if (!a || latest.current.id !== a.puuid || latest.current.state.status !== 'ready')
      throw new AppError('CHAT_OFFLINE', 'Connect friends before changing requests.');
    const subject = validFriendTarget(player, a.puuid);
    if (a.demo) {
      const previous = latest.current.state,
        request = previous.friendRequests?.find((r) => r.subject === subject);
      if (previous.friends.some((f) => f.subject === subject))
        throw new AppError('ALREADY_FRIENDS', 'You are already friends.');
      if (action !== 'add' && request?.direction !== 'incoming')
        throw new AppError('FRIEND_REQUEST_CHANGED', 'The request changed.');
      if (action === 'add' && request)
        throw new AppError('FRIEND_REQUEST_PENDING', 'A request already exists.');
      const requests = (previous.friendRequests ?? []).filter((r) => r.subject !== subject);
      const friends = [...previous.friends];
      if (action === 'add')
        requests.push({
          ...player,
          subject,
          jid: `${subject}@demo.pvp.net`,
          direction: 'outgoing',
          updatedAt: Date.now(),
        });
      if (action === 'accept') {
        const friend: Friend = { ...player, subject, jid: request!.jid, presence: 'offline' };
        friends.push(friend);
        await demoChatStorage.saveFriends([friend]);
      }
      if (stamp !== epoch.current || active.current?.puuid !== a.puuid)
        throw new AppError('ACCOUNT_CHANGED', 'The account changed.');
      const next = { id: a.puuid, state: { ...previous, friends, friendRequests: requests } };
      latest.current = next;
      setValue(next);
      return;
    }
    const connection = session.current;
    if (!connection) throw new AppError('CHAT_OFFLINE', 'Connect friends first.');
    if (action === 'add') {
      const client = await (await getRuntime()).client(a.puuid);
      const known = client.scope.player(subject);
      validFriendTarget(known.player, a.puuid);
    }
    if (
      stamp !== epoch.current ||
      active.current?.puuid !== a.puuid ||
      connection !== session.current
    )
      throw new AppError('ACCOUNT_CHANGED', 'The selected account or chat connection changed.');
    await connection.changeFriend(action, player);
  }, []);
  const markChatRead = useCallback(
    (subject?: string) => {
      openSubject.current = subject;
      const visible = AppState.currentState === 'active';
      session.current?.markRead(visible ? subject : undefined);
      const a = active.current;
      if (a && subject && visible)
        void storeFor(a)
          .then(async (store) => {
            if (
              active.current?.puuid === a.puuid &&
              openSubject.current === subject &&
              AppState.currentState === 'active'
            ) {
              await store.markRead(subject);
              scheduleLocal(a, store);
            }
          })
          .catch(() => {});
    },
    [storeFor, scheduleLocal],
  );
  const syncChatHistory = useCallback(
    async (subject: string) => {
      if (starting.current || batchSync.current?.queue.progress.status === 'running')
        throw new AppError('CHAT_HISTORY_BUSY', 'The all-friends history sync is already running.');
      const a = active.current,
        generation = epoch.current,
        connection = session.current;
      if (active.current?.demo) {
        setValue((v) => ({
          ...v,
          state: {
            ...v.state,
            archive: {
              ...v.state.archive,
              [subject]: {
                status: 'ready',
                count: 0,
                message: 'Demo: no Riot server was contacted.',
              },
            },
          },
        }));
        return;
      }
      if (!session.current)
        throw new AppError('CHAT_OFFLINE', 'Connect chat before syncing Riot history.');
      await session.current.requestHistory(subject);
      if (
        active.current?.puuid !== a?.puuid ||
        epoch.current !== generation ||
        connection !== session.current
      )
        throw new AppError('ACCOUNT_CHANGED', 'The chat account changed.');
      await loadChatMessages(subject);
    },
    [loadChatMessages],
  );
  const autoSyncChatHistory = useCallback(
    async (subject: string) => {
      const a = active.current,
        connection = session.current,
        generation = epoch.current;
      if (
        !a ||
        latest.current.id !== a.puuid ||
        latest.current.state.status !== 'ready' ||
        starting.current ||
        batchSync.current?.queue.progress.status === 'running'
      )
        return;
      const recent = latest.current.state.archive?.[subject];
      if (recent?.status === 'ready' && (recent.at ?? 0) > Date.now() - 60000) return;
      return autoGate.current.run(`${a.puuid}:${subject}`, async () => {
        if (
          active.current?.puuid !== a.puuid ||
          epoch.current !== generation ||
          connection !== session.current
        )
          return;
        await syncChatHistory(subject);
      });
    },
    [syncChatHistory],
  );
  const syncSavedChatHistory = useCallback(async () => {
    if (starting.current || batchSync.current?.queue.progress.status === 'running')
      throw new AppError('CHAT_HISTORY_BUSY', 'A history sync is already running.');
    const a = active.current,
      generation = epoch.current,
      connection = session.current;
    const accountCheck = () => {
      if (
        !a ||
        active.current?.puuid !== a.puuid ||
        generation !== epoch.current ||
        connection !== session.current
      )
        throw new AppError('ACCOUNT_CHANGED', 'The chat account or connection changed.');
      if (latest.current.id !== a.puuid || latest.current.state.status !== 'ready')
        throw new AppError('CHAT_OFFLINE', 'Connect chat to sync history.');
    };
    accountCheck();
    autoResume.current = false;
    starting.current = true;
    setHistorySyncStarting(true);
    let lease: HistoryBackgroundLease | undefined;
    try {
      let job = batchSync.current;
      if (!job || job.id !== a!.puuid) {
        const id = a!.puuid;
        const queue = new RosterHistorySync((progress) => {
          if (active.current?.puuid === id && batchSync.current?.queue === queue) {
            setHistorySync({ id, progress });
            backgroundLease.current?.update(progress);
          }
        });
        job = { id, queue };
        batchSync.current = job;
      }
      const queue = job.queue;
      lease = a!.demo
        ? undefined
        : await startHistoryBackground(
            accountCheck,
            (reason) => {
              if (batchSync.current?.queue === queue) queue.stop(reason, true);
            },
            backgroundWanted.current,
          );
      accountCheck();
      backgroundLease.current = lease ?? null;
      setHistoryBackground({ active: lease?.active() ?? false, note: lease?.note });
      const check = () => {
        accountCheck();
        if (lease?.supported && !lease.active())
          throw new AppError('SYNC_STOPPED', 'History sync was stopped.');
        if (AppState.currentState === 'background' && !lease?.active())
          throw new AppError('CHAT_OFFLINE', 'Return to Outpost to continue syncing.');
      };
      check();
      lease?.update(queue.progress);
      const options = {
        check,
        isFriend: (friend: Friend) =>
          latest.current.state.friends.some((f) => f.subject === friend.subject),
        sync: async (friend: Friend, signal: AbortSignal) => {
          check();
          if (lease?.supported) await lease.check();
          check();
          const store = await storeFor(a!);
          check();
          const count = a!.demo
            ? 0
            : await connection!.requestHistory(friend.subject, {
                signal,
                hydrate: openSubject.current === friend.subject,
              });
          check();
          if (signal.aborted) throw new AppError('CHAT_HISTORY_CANCELLED', 'History sync stopped.');
          const conversations = await store.conversations();
          check();
          setLocal((old) => ({
            ...old,
            id: a!.puuid,
            conversations,
            error: undefined,
            loading: false,
          }));
          if (openSubject.current === friend.subject) await loadChatMessages(friend.subject);
          check();
          return count;
        },
      };
      starting.current = false;
      setHistorySyncStarting(false);
      const result = await (['paused', 'cancelled'].includes(queue.progress.status)
        ? queue.resume(options)
        : queue.start(
            latest.current.state.friends.filter((f) => f.subject !== a!.puuid),
            options,
          ));
      if (active.current?.puuid === a!.puuid && batchSync.current?.queue === queue)
        recordRequest({
          at: Date.now(),
          service: 'Chat history sync',
          method: 'XMPP',
          code: 'ALL_FRIENDS_' + result.status.toUpperCase(),
          durationMs: 0,
        });
      lease?.update(result);
      await lease?.finish(result.status);
      return result;
    } finally {
      starting.current = false;
      setHistorySyncStarting(false);
      if (lease) {
        await lease.finish(batchSync.current?.queue.progress.status ?? 'paused');
        if (backgroundLease.current === lease) {
          backgroundLease.current = null;
          setHistoryBackground((previous) => ({ ...previous, active: false }));
        }
      }
      if (
        active.current?.puuid === a?.puuid &&
        generation === epoch.current &&
        AppState.currentState === 'background'
      )
        stop();
    }
  }, [storeFor, loadChatMessages, stop]);
  syncRef.current = syncSavedChatHistory;
  const cancelChatHistorySync = useCallback(() => {
    autoResume.current = false;
    batchSync.current?.queue.stop('Sync stopped. Saved messages are kept.');
  }, []);
  const clearChatHistory = useCallback(
    async (subject?: string) => {
      const a = active.current;
      if (!a) return;
      autoResume.current = false;
      wanted.current = false;
      const closing = session.current;
      stop(true);
      await closing?.flushPersistence();
      const store = await storeFor(a);
      await store.clear(subject);
      if (active.current?.puuid === a.puuid) {
        setLocal((old) => ({
          ...old,
          messages: subject
            ? Object.fromEntries(Object.entries(old.messages).filter(([id]) => id !== subject))
            : {},
          cursors: {},
        }));
        await refreshLocal(a, store);
      }
    },
    [storeFor, stop, refreshLocal],
  );
  const cacheMatchFriends = useCallback(
    async (players: import('../core/playerTypes').PlayerRef[], observedAt: number) => {
      const a = active.current;
      if (!a) return;
      const store = await storeFor(a),
        saved = await store.conversations();
      if (active.current?.puuid !== a.puuid) return;
      const friends = withCachedFriends(
        latest.current.state.friends,
        saved.flatMap((c) => (c.friend ? [c.friend] : [])),
      );
      const changes = friends.flatMap((f) => {
        const p = players.find((p) => p.subject === f.subject && !p.hidden && p.card);
        return p ? [observedFriend(f, p, observedAt)] : [];
      });
      if (!changes.length) return;
      await store.saveFriends(changes);
      if (active.current?.puuid === a.puuid) await refreshLocal(a, store);
    },
    [storeFor, refreshLocal],
  );
  const cacheFriendProfile = useCallback(
    async (subject: string, player?: import('../core/playerTypes').PlayerRef, observedAt = 0) => {
      const a = active.current;
      if (!a) return;
      const store = await storeFor(a),
        saved = await store.conversations();
      if (active.current?.puuid !== a.puuid) return;
      const old =
        latest.current.state.friends.find((f) => f.subject === subject) ??
        saved.find((c) => c.subject === subject)?.friend;
      if (!old) return;
      const prior = saved.find((c) => c.subject === subject)?.friend;
      const merged = withCachedFriends([old], prior ? [prior] : [])[0]!;
      await store.saveFriends([observedFriend(merged, player, observedAt)]);
      if (active.current?.puuid === a.puuid) await refreshLocal(a, store);
    },
    [storeFor, refreshLocal],
  );
  const chatHistorySync =
    historySync.id === account?.puuid ? historySync.progress : EMPTY_HISTORY_SYNC;
  const syncingSavedHistory = chatHistorySync.status === 'running';
  const live = value.id === account?.puuid ? value.state : EMPTY_CHAT;
  const saved = local.id === account?.puuid ? local : emptyLocal;
  const combinedMessages = useMemo(() => {
    const result = { ...saved.messages };
    for (const [id, messages] of Object.entries(live.messages))
      result[id] = result[id]
        ? mergeMessages(result[id]!, messages, Number.MAX_SAFE_INTEGER)
        : messages;
    return result;
  }, [saved.messages, live.messages]);
  const cachedFriends = useMemo(
    () =>
      withCachedFriends(
        live.friends,
        saved.conversations.flatMap((c) => (c.friend ? [c.friend] : [])),
      ),
    [live.friends, saved.conversations],
  );
  const combined: ChatState = useMemo(
    () => ({
      ...live,
      friends: cachedFriends,
      messages: combinedMessages,
      storageError: saved.error ?? live.storageError,
    }),
    [live, cachedFriends, combinedMessages, saved.error],
  );
  return {
    historyBackground,
    historySyncStarting,
    chatHistorySync,
    cancelChatHistorySync,
    changeFriend,
    cacheMatchFriends,
    cacheFriendProfile,
    chat: combined,
    savedConversations: saved.conversations,
    historyCursors: saved.cursors,
    historyLoading: saved.loading,
    connectChat,
    disconnectChat,
    prepareChatRemoval,
    sendChat,
    markChatRead,
    loadChatMessages,
    syncChatHistory,
    autoSyncChatHistory,
    syncSavedChatHistory,
    syncingSavedHistory,
    clearChatHistory,
  };
}
