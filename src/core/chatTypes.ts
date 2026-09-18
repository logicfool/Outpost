import type { PlayerRef } from './playerTypes';
export interface ChatBootstrap {
  subject: string;
  host: string;
  domain: string;
  port: number;
  accessToken: string;
  entitlementsToken: string;
  pasToken: string;
  expiresAt: number;
}
export interface Friend extends PlayerRef {
  cardObservedAt?: number;
  identityCheckedAt?: number;
  cardSource?: 'presence' | 'match';
  jid: string;
  matchId?: string;
  progress?: import('./matchTypes').MatchProgress;
  presence: 'offline' | 'online' | 'away' | 'in_game' | 'agent_select' | 'queue';
  presenceSource?: 'valorant' | 'riot';
  queue?: string;
  game?: string;
  activity?: string;
  partySize?: number;
  partyMax?: number;
  status?: string;
  map?: string;
  mapId?: string;
  tier?: number;
  updatedAt?: number;
}
export interface ChatMessage {
  id: string;
  subject: string;
  body: string;
  at: number;
  direction: 'incoming' | 'outgoing';
  state: 'received' | 'sending' | 'sent' | 'failed';
  source?: 'outpost' | 'live' | 'riot-archive' | 'riot-client';
  serverStored?: boolean;
}
export interface FriendRequest extends PlayerRef {
  jid: string;
  direction: 'incoming' | 'outgoing';
  updatedAt: number;
}
export type FriendAction = 'add' | 'accept' | 'decline';
export interface FriendOperation {
  action: FriendAction;
  state: 'sending' | 'awaiting' | 'error';
  at: number;
  retryAt: number;
  code?: string;
  message?: string;
}
export interface ChatState {
  friendRequests?: FriendRequest[];
  friendActions?: Record<string, FriendOperation>;
  status: 'disconnected' | 'connecting' | 'authenticating' | 'ready' | 'error';
  error?: string;
  errorCode?: string;
  retryAt?: number;
  storageError?: string;
  archive?: Record<
    string,
    { status: 'loading' | 'ready' | 'error'; message?: string; count?: number; at?: number }
  >;
  unread: Record<string, number>;
  selfPresence?: Friend;
  friends: Friend[];
  messages: Record<string, ChatMessage[]>;
}
export const EMPTY_CHAT: ChatState = {
  status: 'disconnected',
  unread: {},
  friends: [],
  messages: {},
};

export interface ChatConnection {
  write(xml: string): Promise<void>;
  close(): void;
}
export interface ChatEvents {
  secure(): void;
  data(bytes: Uint8Array): void;
  error(): void;
  close(): void;
}
export type ChatTransport = (
  config: Pick<ChatBootstrap, 'host' | 'port'>,
  events: ChatEvents,
) => ChatConnection;

export interface ChatHooks {
  incoming?(message: ChatMessage): Promise<void>;
  saveMessage?(message: ChatMessage): Promise<void>;
  newId?(): string;
  presenceDelayMs?: number;
}
export interface Conversation {
  subject: string;
  friend?: Friend;
  lastAt: number;
  count: number;
  unread: number;
  lastMessage?: ChatMessage;
}
export interface MessageCursor {
  at: number;
  id: string;
  direction: string;
}
