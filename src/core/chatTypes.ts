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
}
export interface ChatState {
  status: 'disconnected' | 'connecting' | 'authenticating' | 'ready' | 'error';
  error?: string;
  errorCode?: string;
  retryAt?: number;
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
