import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import type { Account, Catalog } from '../core/types';
import type { ChatState, Friend, ChatMessage } from '../core/chatTypes';
import { EMPTY_CHAT } from '../core/chatTypes';
import { RiotChat } from '../core/chat';
import { AppError, safeError } from '../core/validation';
import { messageText } from '../core/xmppXml';
import { demoMatch, makeDemo } from '../core/demo';
import { getRuntime } from '../platform/runtime';
import { chatTransport } from '../platform/chatTransport';

export function useSocial(account: Account | null, catalog: Catalog) {
  const [value, setValue] = useState<{ id?: string; state: ChatState }>({ state: EMPTY_CHAT });
  const session = useRef<RiotChat | null>(null),
    active = useRef(account),
    meta = useRef(catalog);
  active.current = account;
  meta.current = catalog;
  const epoch = useRef(0),
    wanted = useRef(false),
    pending = useRef(false),
    attempts = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const connectRef = useRef<() => Promise<void>>(async () => {});
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
    const publish = (state: ChatState) => {
      if (stamp !== epoch.current || active.current?.puuid !== a.puuid) return;
      setValue({ id: a.puuid, state });
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
    try {
      if (a.demo) {
        const entries = makeDemo().snapshot.matches;
        const players = demoMatch(entries.status === 'ready' ? entries.data[0]!.id : '').players;
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
        publish({ status: 'ready', unread: {}, friends, messages: {} });
        return;
      }
      if (Platform.OS === 'web')
        throw new AppError('NATIVE_REQUIRED', 'Use a native build to connect Riot chat.');
      setValue((previous) => ({
        id: a.puuid,
        state: {
          ...(previous.id === a.puuid ? previous.state : EMPTY_CHAT),
          status: 'connecting',
          error: undefined,
        },
      }));
      const client = await (await getRuntime()).client(a.puuid),
        bootstrap = await client.chatBootstrap();
      if (stamp !== epoch.current || active.current?.puuid !== a.puuid || !wanted.current) return;
      const previous = session.current?.snapshot;
      session.current?.disconnect();
      const chat = new RiotChat(chatTransport, meta.current, publish, (friends) => {
        if (stamp === epoch.current && active.current?.puuid === a.puuid)
          for (const friend of friends) client.scope.remember(friend, 'friend');
      });
      if (previous) chat.restoreMessages(previous);
      session.current = chat;
      chat.start(bootstrap);
    } catch (reason) {
      const error = safeError(reason);
      publish({
        ...EMPTY_CHAT,
        status: 'error',
        error: error.message,
        errorCode: error.code,
        retryAt: error.retryAt,
      });
    } finally {
      if (stamp === epoch.current) pending.current = false;
    }
  }, []);
  connectRef.current = connectChat;
  useEffect(() => {
    wanted.current = false;
    attempts.current = 0;
    stop(true);
    setValue({ id: account?.puuid, state: EMPTY_CHAT });
    return () => {
      wanted.current = false;
      stop(true);
    };
  }, [account?.puuid, stop]);
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
  const sendChat = useCallback(async (subject: string, body: string) => {
    body = messageText(body);
    if (active.current?.demo) {
      const message: ChatMessage = {
        id: `demo-${Date.now()}`,
        subject,
        body,
        at: Date.now(),
        direction: 'outgoing',
        state: 'sent',
      };
      setValue((v) => ({
        ...v,
        state: {
          ...v.state,
          messages: {
            ...v.state.messages,
            [subject]: [...(v.state.messages[subject] ?? []), message].slice(-200),
          },
        },
      }));
      return;
    }
    if (!session.current)
      throw new AppError('CHAT_OFFLINE', 'Connect chat before sending a message.');
    await session.current.send(subject, body);
  }, []);
  const markChatRead = useCallback((subject?: string) => session.current?.markRead(subject), []);
  return {
    chat: value.id === account?.puuid ? value.state : EMPTY_CHAT,
    connectChat,
    disconnectChat,
    sendChat,
    markChatRead,
  };
}
