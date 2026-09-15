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
  jid: string;
  presence: 'offline' | 'online' | 'away' | 'in_game' | 'agent_select' | 'queue';
  presenceSource?: 'valorant' | 'riot';
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
export interface ChatState {
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
}
export interface MessageCursor {
  at: number;
  id: string;
  direction: string;
}
