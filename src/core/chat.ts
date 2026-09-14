import type { Catalog } from './types';
import type {
  ChatBootstrap,
  ChatMessage,
  ChatState,
  Friend,
  ChatConnection,
  ChatTransport,
} from './chatTypes';
import { AppError, safeError } from './validation';
import {
  XmppXml,
  NS,
  child,
  children,
  messageText as messageBody,
  parseJid,
  xmlEscape as xml,
  type XmlNode,
} from './xmppXml';
import { friendPresence, presencePriority } from './chatPresence';

export class RiotChat {
  private socket?: ChatConnection;
  private credentials?: ChatBootstrap;
  private generation = 0;
  private phase = 'closed';
  private parser!: XmppXml;
  private timer?: ReturnType<typeof setTimeout>;
  private heartbeat?: ReturnType<typeof setInterval>;
  private expiry?: ReturnType<typeof setTimeout>;
  private lastInput = 0;
  private lastSend = -Infinity;
  private openConversation?: string;
  private counter = 0;
  private roster = new Map<string, Friend>();
  private resources = new Map<string, Map<string, Partial<Friend>>>();
  private state: ChatState = { status: 'disconnected', unread: {}, friends: [], messages: {} };
  constructor(
    private transport: ChatTransport,
    private catalog: Catalog,
    private emit: (state: ChatState) => void,
    private onFriends: (friends: Friend[]) => void = () => {},
    private now: () => number = Date.now,
  ) {}
  get snapshot() {
    return this.state;
  }
  restoreMessages(previous: ChatState) {
    if (this.phase === 'closed')
      this.state = { ...this.state, messages: previous.messages, unread: previous.unread };
  }
  private update(next: Partial<ChatState>) {
    this.state = { ...this.state, ...next };
    this.emit(this.state);
  }
  private sendRaw(value: string) {
    const epoch = this.generation;
    if (!this.socket) return;
    void this.socket.write(value).catch(() => {
      if (epoch === this.generation)
        this.fail('The chat connection could not send data. Reconnect to retry.');
    });
  }
  start(credentials: ChatBootstrap) {
    this.disconnect();
    if (credentials.expiresAt <= this.now() + 30000)
      throw new AppError('SESSION_EXPIRED', 'Renew the Riot session before connecting chat.');
    this.credentials = credentials;
    const epoch = ++this.generation;
    this.phase = 'features';
    this.lastInput = this.now();
    this.parser = new XmppXml(
      (node) => {
        if (epoch === this.generation) this.receive(node);
      },
      () => {
        if (epoch === this.generation)
          this.fail('Riot returned an invalid chat stream. Reconnect to retry.');
      },
    );
    this.update({ status: 'connecting', error: undefined, errorCode: undefined });
    this.timer = setTimeout(() => {
      if (epoch === this.generation)
        this.fail('Chat connection timed out. Check your network and reconnect.');
    }, 25000);
    try {
      this.socket = this.transport(credentials, {
        secure: () => {
          if (epoch === this.generation) {
            this.update({ status: 'authenticating' });
            this.openStream();
          }
        },
        data: (bytes) => {
          if (epoch === this.generation) {
            this.lastInput = this.now();
            try {
              this.parser.feed(bytes);
            } catch {
              this.fail('Riot returned an invalid chat stream.', 'CHAT_XML');
            }
          }
        },
        error: () => {
          if (epoch === this.generation)
            this.fail('A secure Riot chat connection could not be established.');
        },
        close: () => {
          if (epoch === this.generation)
            this.fail('Riot chat disconnected. Tap Reconnect to continue.');
        },
      });
    } catch (e) {
      this.fail(safeError(e).message);
    }
  }
  private openStream() {
    if (this.credentials)
      this.sendRaw(
        `<?xml version="1.0"?><stream:stream to="${xml(this.credentials.domain)}" version="1.0" xmlns="jabber:client" xmlns:stream="http://etherx.jabber.org/streams">`,
      );
  }
  private receive(node: XmlNode) {
    const c = this.credentials;
    if (!c) return;
    const name = node.name,
      type = node.attrs.type,
      id = node.attrs.id;
    if (name === 'failure' || (node.name === 'error' && node.ns === NS.stream)) {
      this.fail(
        'Riot rejected or closed the chat session. Reconnect your account if it persists.',
        'CHAT_AUTH',
      );
      return;
    }
    if (name === 'features' && node.ns === NS.stream && this.phase === 'features') {
      const mechanisms = child(node, 'mechanisms', NS.sasl);
      if (
        !mechanisms ||
        !children(mechanisms, 'mechanism').some((m) => m.text === 'X-Riot-RSO-PAS')
      ) {
        this.fail('Riot chat authentication changed. No chat credentials were submitted.');
        return;
      }
      this.phase = 'auth';
      this.sendRaw(
        `<auth mechanism="X-Riot-RSO-PAS" xmlns="urn:ietf:params:xml:ns:xmpp-sasl"><rso_token>${xml(c.accessToken)}</rso_token><pas_token>${xml(c.pasToken)}</pas_token></auth>`,
      );
      return;
    }
    if (name === 'success' && this.phase === 'auth' && node.ns === NS.sasl) {
      this.phase = 'bind-features';
      this.parser.reset();
      this.openStream();
      return;
    }
    if (name === 'features' && node.ns === NS.stream && this.phase === 'bind-features') {
      this.phase = 'bind';
      this.sendRaw(
        '<iq id="outpost-bind" type="set"><bind xmlns="urn:ietf:params:xml:ns:xmpp-bind"/></iq>',
      );
      return;
    }
    if (['iq', 'message', 'presence'].includes(name) && !['', NS.client].includes(node.ns)) return;
    if (name === 'iq' && id === 'outpost-bind' && this.phase === 'bind') {
      const bind = child(node, 'bind'),
        jid = parseJid(bind ? (child(bind, 'jid')?.text ?? '') : '');
      if (type !== 'result' || !jid || jid.bare !== `${c.subject}@${c.domain}`) {
        this.fail('Riot returned an unexpected chat identity.');
        return;
      }
      this.phase = 'session';
      this.sendRaw(
        '<iq id="outpost-session" type="set"><session xmlns="urn:ietf:params:xml:ns:xmpp-session"/></iq>',
      );
      return;
    }
    if (name === 'iq' && id === 'outpost-session' && this.phase === 'session') {
      if (type !== 'result') {
        this.fail('Riot could not start the chat session.');
        return;
      }
      this.phase = 'roster';
      this.sendRaw(
        `<iq id="outpost-entitlements" type="set"><entitlements xmlns="urn:riotgames:entitlements"><token xmlns="">${xml(c.entitlementsToken)}</token></entitlements></iq>`,
      );
      this.sendRaw(
        '<iq id="outpost-roster" type="get"><query xmlns="jabber:iq:riotgames:roster" last_state="true"/></iq>',
      );
      this.sendRaw('<presence><show>chat</show><status>Outpost mobile</status></presence>');
      return;
    }
    if (
      name === 'iq' &&
      type === 'error' &&
      ['outpost-roster', 'outpost-entitlements'].includes(id ?? '')
    ) {
      this.fail('Riot denied friends or chat access for this session.');
      return;
    }
    if (name === 'iq' && (this.phase === 'roster' || this.phase === 'ready')) {
      const query = child(node, 'query');
      if (
        query?.ns === NS.roster &&
        ((type === 'result' && id === 'outpost-roster') || type === 'set')
      ) {
        if (
          node.attrs.from &&
          node.attrs.from !== c.domain &&
          node.attrs.from !== `${c.subject}@${c.domain}`
        )
          return;
        this.applyRoster(query, type === 'result');
        if (type === 'set' && id) this.sendRaw(`<iq type="result" id="${xml(id)}"/>`);
        if (this.phase === 'roster' && type === 'result') this.ready();
        return;
      }
      if (type === 'get' && !!child(node, 'ping', NS.ping) && id) {
        this.sendRaw(
          `<iq type="result" id="${xml(id)}"${node.attrs.from ? ` to="${xml(node.attrs.from)}"` : ''}/>`,
        );
        return;
      }
    }
    if (this.phase !== 'ready' && this.phase !== 'roster') return;
    if (name === 'presence') this.applyPresence(node);
    if (name === 'message') this.applyMessage(node);
  }
  private ready() {
    this.phase = 'ready';
    clearTimeout(this.timer);
    this.update({ status: 'ready', error: undefined });
    const epoch = this.generation;
    this.heartbeat = setInterval(() => {
      if (epoch !== this.generation) return;
      if (this.now() - this.lastInput > 150000)
        this.fail('Chat stopped responding. Reconnect to refresh friends and messages.');
      else
        this.sendRaw(
          `<iq type="get" id="outpost-ping-${++this.counter}" to="${xml(this.credentials!.domain)}"><ping xmlns="urn:xmpp:ping"/></iq>`,
        );
    }, 45000);
    this.expiry = setTimeout(
      () => {
        if (epoch === this.generation)
          this.fail('Chat session renewal is needed.', 'SESSION_EXPIRED');
      },
      Math.max(1000, this.credentials!.expiresAt - this.now() - 30000),
    );
  }
  private applyRoster(query: XmlNode, full: boolean) {
    const next = full ? new Map<string, Friend>() : new Map(this.roster);
    for (const item of children(query, 'item').slice(0, 1000)) {
      const jid = parseJid(item.attrs.jid ?? '');
      if (!jid || jid.subject === this.credentials?.subject) continue;
      if (item.attrs.subscription && !['both', 'to'].includes(item.attrs.subscription)) {
        next.delete(jid.subject);
        this.resources.delete(jid.subject);
        continue;
      }
      const identity = child(item, 'id'),
        old = this.roster.get(jid.subject);
      next.set(jid.subject, {
        ...old,
        subject: jid.subject,
        jid: jid.bare,
        name: (identity?.attrs.name || item.attrs.name || old?.name || 'Friend').slice(0, 80),
        tag: (identity?.attrs.tagline || old?.tag || '').slice(0, 32),
        presence: old?.presence ?? 'offline',
      });
    }
    this.roster = next;
    for (const id of this.resources.keys()) if (!next.has(id)) this.resources.delete(id);
    this.publishFriends();
  }
  private applyPresence(node: XmlNode) {
    const jid = parseJid(node.attrs.from ?? ''),
      friend = jid && this.roster.get(jid.subject);
    if (
      !jid ||
      !friend ||
      jid.bare !== friend.jid ||
      (node.attrs.type && node.attrs.type !== 'unavailable')
    )
      return;
    const resources = this.resources.get(jid.subject) ?? new Map<string, Partial<Friend>>();
    if (node.attrs.type === 'unavailable') {
      if (jid.resource) resources.delete(jid.resource);
      else resources.clear();
    } else {
      if (resources.size >= 12 && !resources.has(jid.resource))
        resources.delete(resources.keys().next().value!);
      resources.set(jid.resource, friendPresence(node, this.catalog, this.now()));
    }
    this.resources.set(jid.subject, resources);
    const active = [...resources.values()].sort(
      (a, b) =>
        Number(b.presenceSource === 'valorant') - Number(a.presenceSource === 'valorant') ||
        (b.updatedAt ?? 0) - (a.updatedAt ?? 0),
    )[0];
    this.roster.set(jid.subject, {
      ...friend,
      ...(active ?? {
        presence: 'offline' as const,
        map: undefined,
        mapId: undefined,
        status: undefined,
      }),
      updatedAt: this.now(),
    });
    this.publishFriends();
  }
  private publishFriends() {
    const friends = [...this.roster.values()].sort(
      (a, b) =>
        presencePriority(b.presence) - presencePriority(a.presence) || a.name.localeCompare(b.name),
    );
    this.onFriends(friends);
    this.update({ friends });
  }
  private applyMessage(node: XmlNode) {
    const jid = parseJid(node.attrs.from ?? ''),
      friend = jid && this.roster.get(jid.subject);
    if (!jid || !friend || jid.bare !== friend.jid) return;
    if (node.attrs.type === 'error') {
      const messages = this.state.messages[jid.subject] ?? [];
      this.update({
        messages: {
          ...this.state.messages,
          [jid.subject]: messages.map((m) =>
            m.direction === 'outgoing' && m.id === node.attrs.id ? { ...m, state: 'failed' } : m,
          ),
        },
      });
      return;
    }
    if (node.attrs.type && node.attrs.type !== 'chat' && node.attrs.type !== 'normal') return;
    const body = child(node, 'body')?.text;
    if (!body || [...body].length > 1000) return;
    const id = node.attrs.id?.slice(0, 200) || `incoming-${this.now()}-${++this.counter}`;
    if (
      (this.state.messages[jid.subject] ?? []).some(
        (m) => m.id === id && m.direction === 'incoming',
      )
    )
      return;
    const stamp = Date.parse(child(node, 'delay')?.attrs.stamp ?? ''),
      at = Number.isFinite(stamp) && stamp <= this.now() ? stamp : this.now();
    this.addMessage({
      id,
      subject: jid.subject,
      body,
      at,
      direction: 'incoming',
      state: 'received',
    });
  }
  private addMessage(message: ChatMessage) {
    const messages = { ...this.state.messages };
    if (Object.keys(messages).length >= 50 && !messages[message.subject])
      delete messages[Object.keys(messages)[0]!];
    messages[message.subject] = [...(messages[message.subject] ?? []), message].slice(-200);
    this.update({
      messages,
      unread:
        message.direction === 'incoming' && this.openConversation !== message.subject
          ? {
              ...this.state.unread,
              [message.subject]: Math.min(999, (this.state.unread[message.subject] ?? 0) + 1),
            }
          : this.state.unread,
    });
  }
  async send(subject: string, value: string): Promise<void> {
    if (this.credentials && this.credentials.expiresAt <= this.now()) {
      this.fail('Chat session renewal is needed.', 'SESSION_EXPIRED');
      throw new AppError('SESSION_EXPIRED', 'Reconnect to renew chat.');
    }
    const body = messageBody(value),
      friend = this.roster.get(subject);
    if (this.phase !== 'ready' || !this.socket || !friend)
      throw new AppError(
        'CHAT_OFFLINE',
        'Connect to Riot chat and choose a friend before sending.',
      );
    if (this.now() - this.lastSend < 1000)
      throw new AppError('CHAT_COOLDOWN', 'Wait a second before sending another message.');
    this.lastSend = this.now();
    const epoch = this.generation,
      id = `outpost-${this.now()}-${++this.counter}`;
    this.addMessage({ id, subject, body, at: this.now(), direction: 'outgoing', state: 'sending' });
    const settle = (state: 'sent' | 'failed') =>
      this.update({
        messages: {
          ...this.state.messages,
          [subject]: (this.state.messages[subject] ?? []).map((m) =>
            m.id === id && m.state === 'sending' ? { ...m, state } : m,
          ),
        },
      });
    try {
      await this.socket.write(
        `<message type="chat" to="${xml(friend.jid)}" id="${xml(id)}"><body>${xml(body)}</body></message>`,
      );
      if (epoch !== this.generation)
        throw new AppError(
          'CHAT_OFFLINE',
          'The connection changed while sending. Delivery is unconfirmed.',
        );
      settle('sent');
    } catch {
      if (epoch === this.generation) settle('failed');
      throw new AppError(
        'CHAT_SEND',
        'The message could not be confirmed as sent. It was not retried automatically.',
      );
    }
  }
  private fail(message: string, code = 'CHAT_NETWORK') {
    this.disconnect();
    this.update({ status: 'error', error: message, errorCode: code });
  }
  markRead(subject?: string) {
    this.openConversation = subject;
    if (subject && this.state.unread[subject])
      this.update({ unread: { ...this.state.unread, [subject]: 0 } });
  }
  disconnect(clear = false) {
    this.generation++;
    this.phase = 'closed';
    this.openConversation = undefined;
    clearTimeout(this.timer);
    clearTimeout(this.expiry);
    clearInterval(this.heartbeat);
    const socket = this.socket;
    this.socket = undefined;
    this.credentials = undefined;
    socket?.close();
    this.resources.clear();
    if (clear) this.roster.clear();
    const friends = [...this.roster.values()].map((friend) => ({
      ...friend,
      presence: 'offline' as const,
      updatedAt: undefined,
    }));
    this.roster = new Map(friends.map((f) => [f.subject, f]));
    const messages = Object.fromEntries(
      Object.entries(this.state.messages).map(([id, entries]) => [
        id,
        entries.map((m) => (m.state === 'sending' ? { ...m, state: 'failed' as const } : m)),
      ]),
    );
    this.update({
      status: 'disconnected',
      friends,
      error: undefined,
      errorCode: undefined,
      messages,
      ...(clear ? { messages: {}, unread: {} } : {}),
    });
  }
}
