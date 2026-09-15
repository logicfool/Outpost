import { useCallback, useEffect, useRef, useState } from 'react';
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
export function useSocial(account: Account | null, catalog: Catalog) {
  const [value, setValue] = useState<{ id?: string; state: ChatState }>({ state: EMPTY_CHAT });
  const [local, setLocal] = useState<LocalState>(emptyLocal);
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
    clearTimeout(reconnectTimer.current);
    epoch.current++;
    pending.current = false;
    session.current?.disconnect(clear);
    if (clear) session.current = null;
    setValue((v) => ({
      ...v,
      state: clear
        ? EMPTY_CHAT
        : {
            ...v.state,
            status: 'disconnected',
            friends: v.state.friends.map((f) => ({ ...f, presence: 'offline' })),
          },
    }));
  }, []);
  const connectChat = useCallback(async () => {
    const a = active.current;
    if (!a || pending.current) return;
    wanted.current = true;
    clearTimeout(reconnectTimer.current);
    const stamp = ++epoch.current;
    pending.current = true;
    const previous = latest.current.id === a.puuid ? latest.current.state : EMPTY_CHAT;
    const publish = (state: ChatState) => {
      if (stamp !== epoch.current || active.current?.puuid !== a.puuid) return;
      latest.current = { id: a.puuid, state };
      setValue(latest.current);
      if (state.status === 'ready') attempts.current = 0;
      if (
        state.status === 'error' &&
        wanted.current &&
        AppState.currentState === 'active' &&
        ['CHAT_NETWORK', 'SESSION_EXPIRED', 'NETWORK', 'TIMEOUT', 'RATE_LIMIT'].includes(
          state.errorCode ?? '',
        ) &&
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
    publish({ ...previous, status: 'connecting', error: undefined });
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
            map: index === 0 ? 'Lotus' : undefined,
          }));
        await store.saveFriends(friends);
        publish({ ...previous, status: 'ready', error: undefined, friends });
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
              .catch(() =>
                setLocal((old) => ({ ...old, error: 'Friend names could not be saved locally.' })),
              );
        },
        Date.now,
        {
          newId: randomHex,
          saveMessage: async (message) => {
            await store.save(message);
            if (openSubject.current === message.subject && active.current?.puuid === a.puuid)
              await store.markRead(message.subject);
            scheduleLocal(a, store);
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
      stop(true);
      clearTimeout(localTimer.current);
    };
  }, [account?.puuid, stop, refreshLocal]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') stop();
      else if (wanted.current) {
        attempts.current = 0;
        void connectRef.current();
      }
    });
    return () => subscription.remove();
  }, [stop]);
  const disconnectChat = useCallback(() => {
    wanted.current = false;
    stop();
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
              [subject]: before
                ? mergeMessages(
                    base.messages[subject] ?? [],
                    page.messages,
                    Number.MAX_SAFE_INTEGER,
                  )
                : page.messages,
            },
            cursors: { ...base.cursors, [subject]: page.older },
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
  const markChatRead = useCallback(
    (subject?: string) => {
      openSubject.current = subject;
      session.current?.markRead(subject);
      const a = active.current;
      if (a && subject)
        void storeFor(a)
          .then(async (store) => {
            await store.markRead(subject);
            scheduleLocal(a, store);
          })
          .catch(() => {});
    },
    [storeFor, scheduleLocal],
  );
  const syncChatHistory = useCallback(
    async (subject: string) => {
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
      await loadChatMessages(subject);
    },
    [loadChatMessages],
  );
  const clearChatHistory = useCallback(
    async (subject?: string) => {
      const a = active.current;
      if (!a) return;
      wanted.current = false;
      stop(true);
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
  const live = value.id === account?.puuid ? value.state : EMPTY_CHAT;
  const saved = local.id === account?.puuid ? local : emptyLocal;
  const combined: ChatState = {
    ...live,
    messages: { ...saved.messages },
    storageError: saved.error ?? live.storageError,
  };
  for (const [id, messages] of Object.entries(live.messages))
    combined.messages[id] = mergeMessages(
      combined.messages[id] ?? [],
      messages,
      Number.MAX_SAFE_INTEGER,
    );
  return {
    chat: combined,
    savedConversations: saved.conversations,
    historyCursors: saved.cursors,
    historyLoading: saved.loading,
    connectChat,
    disconnectChat,
    sendChat,
    markChatRead,
    loadChatMessages,
    syncChatHistory,
    clearChatHistory,
  };
}
