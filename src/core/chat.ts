import {
  FRIEND_ACTION_COOLDOWN,
  rosterEntry,
  friendMutationXml,
  validFriendTarget,
} from './friendRequests';
import type { FriendRequest, FriendAction } from './chatTypes';
import type { PlayerRef } from './playerTypes';
import { detailedDiagnosticEvent } from './detailedDiagnostics';
import type { Catalog } from './types';
import type {
  ChatBootstrap,
  ChatMessage,
  ChatState,
  Friend,
  ChatConnection,
  ChatTransport,
  ChatHooks,
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
import {
  ARCHIVE_NS,
  CARBONS_NS,
  chatTimestamp,
  mergeMessages,
  messageKey,
  parseArchiveResult,
  parseCarbon,
} from './messageHistory';

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
  private probe?: { id: string; at: number };
  private lastSend = -Infinity;
  private openConversation?: string;
  private counter = 0;
  private presenceTimer?: ReturnType<typeof setTimeout>;
  private owner?: string;
  private historyRequests = new Map<
    string,
    {
      friend: Friend;
      timer: ReturnType<typeof setTimeout>;
      receiving: boolean;
      signal?: AbortSignal;
      hydrate: boolean;
      resolve(count: number): void;
      reject(error: AppError): void;
    }
  >();
  private historyTimes = new Map<string, number>();
  private persistence = new Set<Promise<unknown>>();
  private sends = new Set<Promise<unknown>>();
  private roster = new Map<string, Friend>();
  private requests = new Map<string, FriendRequest>();
  private friendWrites = new Map<
    string,
    {
      subject: string;
      action: FriendAction;
      timer: ReturnType<typeof setTimeout>;
      resolve(): void;
      reject(error: AppError): void;
    }
  >();
  private friendChecks = new Map<string, string>();
  private friendTimes = new Map<string, number>();
  private lastFriendWrite = -Infinity;
  private resources = new Map<string, Map<string, Partial<Friend>>>();
  private state: ChatState = { status: 'disconnected', unread: {}, friends: [], messages: {} };
  constructor(
    private transport: ChatTransport,
    private catalog: Catalog,
    private emit: (state: ChatState) => void,
    private onFriends: (friends: Friend[]) => void = () => {},
    private now: () => number = Date.now,
    private hooks: ChatHooks = {},
  ) {}
  get snapshot() {
    return this.state;
  }
  restoreMessages(previous: ChatState) {
    if (this.phase === 'closed') {
      this.state = {
        ...this.state,
        messages: previous.messages,
        unread: previous.unread,
        friendRequests: previous.friendRequests,
        friendActions: previous.friendActions,
      };
      this.requests = new Map((previous.friendRequests ?? []).map((r) => [r.subject, r]));
      for (const [id, op] of Object.entries(previous.friendActions ?? {}))
        this.friendTimes.set(id, op.retryAt);
    }
  }
  private update(next: Partial<ChatState>) {
    this.state = { ...this.state, ...next };
    this.emit(this.state);
  }
  private sendRaw(value: string) {
    const epoch = this.generation;
    if (!this.socket) return;
    detailedDiagnosticEvent('xmpp-out', { stanza: value });
    void this.socket.write(value).catch(() => {
      if (epoch === this.generation)
        this.fail('The chat connection could not send data. Reconnecting automatically.');
    });
  }
  start(credentials: ChatBootstrap) {
    this.disconnect(!!this.owner && this.owner !== credentials.subject);
    this.owner = credentials.subject;
    if (credentials.expiresAt <= this.now() + 30000)
      throw new AppError('SESSION_EXPIRED', 'The chat session is renewing automatically.');
    this.credentials = credentials;
    const epoch = ++this.generation;
    this.phase = 'features';
    this.lastInput = this.now();
    this.parser = new XmppXml(
      (node) => {
        if (epoch === this.generation) this.receive(node);
      },
      () => {
        if (epoch === this.generation) this.fail('Riot returned an invalid chat stream.');
      },
    );
    this.update({ status: 'connecting', error: undefined, errorCode: undefined });
    this.timer = setTimeout(() => {
      if (epoch === this.generation)
        this.fail('Chat connection timed out. Retrying automatically.');
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
            this.fail('Riot chat disconnected. Reconnecting automatically.');
        },
      });
    } catch (e) {
      const error = safeError(e);
      this.fail(error.message, error.code);
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
    detailedDiagnosticEvent('xmpp-in', { stanza: node });
    const name = node.name,
      type = node.attrs.type,
      id = node.attrs.id;
    if (node.name === 'error' && node.ns === NS.stream) {
      const limited = !!child(node, 'resource-constraint');
      this.fail(
        limited
          ? 'Riot asked chat to slow down. Retrying later.'
          : 'Riot closed the chat connection.',
        limited ? 'RATE_LIMIT' : 'CHAT_NETWORK',
        limited ? this.now() + 60000 : undefined,
      );
      return;
    }
    if (name === 'failure' && node.ns === NS.sasl) {
      this.fail('Riot rejected chat authorization.', 'CHAT_AUTH');
      return;
    }
    if (
      this.probe &&
      name === 'iq' &&
      id === this.probe.id &&
      ['result', 'error'].includes(type ?? '') &&
      (!node.attrs.from || node.attrs.from === c.domain)
    ) {
      this.probe = undefined;
      return;
    }

    if (name === 'features' && node.ns === NS.stream && this.phase === 'features') {
      const mechanisms = child(node, 'mechanisms', NS.sasl);
      if (
        !mechanisms ||
        !children(mechanisms, 'mechanism').some((m) => m.text === 'X-Riot-RSO-PAS')
      ) {
        this.fail(
          'Riot chat authentication changed. No chat credentials were submitted.',
          'CHAT_PROTOCOL',
        );
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
        this.fail('Riot returned an unexpected chat identity.', 'CHAT_IDENTITY');
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
      this.fail('Riot denied friends or chat access for this session.', 'CHAT_AUTH');
      return;
    }
    if (
      name === 'iq' &&
      this.phase === 'ready' &&
      id &&
      this.friendWrites.has(id) &&
      ['result', 'error'].includes(type ?? '')
    ) {
      if (
        node.attrs.from &&
        node.attrs.from !== c.domain &&
        node.attrs.from !== `${c.subject}@${c.domain}`
      )
        return;
      this.friendReply(node);
      return;
    }
    if (name === 'iq' && type === 'error' && id && this.friendChecks.has(id)) {
      if (
        node.attrs.from &&
        node.attrs.from !== c.domain &&
        node.attrs.from !== `${c.subject}@${c.domain}`
      )
        return;
      const subject = this.friendChecks.get(id);
      for (const [key, op] of this.friendWrites)
        if (op.subject === subject)
          this.finishFriend(
            key,
            new AppError(
              'FRIEND_UNCONFIRMED',
              'Riot accepted the command but did not return the updated request list.',
            ),
          );
      return;
    }
    if (name === 'iq' && this.phase === 'ready' && id && this.historyRequests.has(id)) {
      void this.receiveHistory(node).catch(() => {});
      return;
    }
    if (name === 'iq' && id === 'outpost-carbons') return;
    if (name === 'iq' && (this.phase === 'roster' || this.phase === 'ready')) {
      const query = child(node, 'query');
      if (
        query?.ns === NS.roster &&
        ((type === 'result' && (id === 'outpost-roster' || (!!id && this.friendChecks.has(id)))) ||
          type === 'set')
      ) {
        if (
          node.attrs.from &&
          node.attrs.from !== c.domain &&
          node.attrs.from !== `${c.subject}@${c.domain}`
        )
          return;
        this.applyRoster(query, type === 'result');
        if (type === 'result' && id && this.friendChecks.has(id)) {
          const subject = this.friendChecks.get(id);
          for (const [key, op] of this.friendWrites)
            if (op.subject === subject)
              this.finishFriend(
                key,
                this.friendMatches(op.subject, op.action)
                  ? undefined
                  : new AppError(
                      'FRIEND_UNCONFIRMED',
                      'The returned roster does not yet confirm this change.',
                    ),
              );
          this.friendChecks.delete(id);
        }
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
    this.sendRaw(`<iq type="set" id="outpost-carbons"><enable xmlns="${CARBONS_NS}"/></iq>`);
    const epoch = this.generation;
    this.heartbeat = setInterval(() => {
      if (epoch !== this.generation) return;
      const now = this.now();
      if (this.probe && this.lastInput >= this.probe.at) this.probe = undefined;
      if (this.probe) {
        if (now - this.probe.at >= 30000)
          this.fail('Chat stopped responding. Reconnecting automatically.');
        return;
      }
      if (now - this.lastInput < 60000) return;
      const id = `outpost-ping-${++this.counter}`;
      this.probe = { id, at: now };
      this.sendRaw(
        `<iq type="get" id="${id}" to="${xml(this.credentials!.domain)}"><ping xmlns="urn:xmpp:ping"/></iq>`,
      );
    }, 30000);
    this.expiry = setTimeout(
      () => {
        if (epoch === this.generation)
          this.fail('Chat session renewal is needed.', 'SESSION_EXPIRED');
      },
      Math.max(1000, this.credentials!.expiresAt - this.now() - 30000),
    );
  }
  private applyRoster(query: XmlNode, full: boolean) {
    if (full && children(query, 'item').length > 1000) {
      this.fail(
        'The roster exceeds the supported size. No pending request was changed.',
        'CHAT_ROSTER_SIZE',
      );
      return;
    }
    const next = full ? new Map<string, Friend>() : new Map(this.roster);
    const requests = full ? new Map<string, FriendRequest>() : new Map(this.requests);
    const changed = new Set<string>();
    for (const item of children(query, 'item').slice(0, 1000)) {
      const jid = parseJid(item.attrs.jid ?? '');
      if (!jid) continue;
      const entry = rosterEntry(
        item,
        this.credentials!.subject,
        this.now(),
        this.roster.get(jid.subject) ?? this.requests.get(jid.subject),
      );
      if (!entry) continue;
      changed.add(jid.subject);
      if (entry.kind === 'friend') {
        next.set(jid.subject, entry.friend);
        requests.delete(jid.subject);
      } else {
        next.delete(jid.subject);
        this.resources.delete(jid.subject);
        if (entry.kind === 'request') requests.set(jid.subject, entry.request);
        else requests.delete(jid.subject);
      }
    }
    this.roster = next;
    this.requests = requests;
    for (const id of this.resources.keys())
      if (!next.has(id) && id !== this.credentials?.subject) this.resources.delete(id);
    const actions = { ...this.state.friendActions };
    for (const [subject, op] of Object.entries(actions))
      if (
        (full || changed.has(subject)) &&
        this.friendMatches(subject, op.action) &&
        ![...this.friendWrites.values()].some((w) => w.subject === subject)
      )
        delete actions[subject];
    this.update({
      friendActions: actions,
      friendRequests: [...requests.values()].sort(
        (a, b) =>
          Number(a.direction === 'outgoing') - Number(b.direction === 'outgoing') ||
          a.name.localeCompare(b.name),
      ),
    });
    for (const [id, op] of this.friendWrites)
      if ((full || changed.has(op.subject)) && this.friendMatches(op.subject, op.action))
        this.finishFriend(id);
    this.publishFriends();
  }
  private applyPresence(node: XmlNode) {
    const jid = parseJid(node.attrs.from ?? ''),
      c = this.credentials;
    const own =
      !!jid && !!c && jid.subject === c.subject && jid.bare === `${c.subject}@${c.domain}`;
    const friend = own
      ? { subject: c!.subject, jid: jid!.bare, name: 'You', tag: '', presence: 'offline' as const }
      : jid && this.roster.get(jid.subject);
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
      resources.delete(jid.resource);
      resources.set(jid.resource, friendPresence(node, this.catalog, this.now()));
    }
    this.resources.set(jid.subject, resources);
    const active = [...resources.values()]
      .reverse()
      .sort(
        (a, b) =>
          Number(b.presenceSource === 'valorant') - Number(a.presenceSource === 'valorant') ||
          (b.updatedAt ?? 0) - (a.updatedAt ?? 0),
      )[0];
    const next = {
      ...friend,
      ...(active ?? {
        presence: 'offline' as const,
        map: undefined,
        mapId: undefined,
        status: undefined,
        progress: undefined,
        matchId: undefined,
      }),
      updatedAt: this.now(),
    };
    if (own) {
      this.update({ selfPresence: next });
      return;
    }
    this.roster.set(jid.subject, next);
    this.publishFriends(true);
  }
  private publishFriends(defer = false) {
    if (defer && this.hooks.presenceDelayMs) {
      if (!this.presenceTimer)
        this.presenceTimer = setTimeout(() => {
          this.presenceTimer = undefined;
          if (this.credentials) this.publishFriends();
        }, this.hooks.presenceDelayMs);
      return;
    }
    const friends = [...this.roster.values()].sort(
      (a, b) =>
        presencePriority(b.presence) - presencePriority(a.presence) || a.name.localeCompare(b.name),
    );
    this.onFriends(friends);
    this.update({ friends });
  }
  private applyMessage(node: XmlNode) {
    if (this.credentials) {
      const copy = parseCarbon(
        node,
        `${this.credentials.subject}@${this.credentials.domain}`,
        [...this.roster.values()],
        this.now(),
      );
      if (copy) {
        void this.addMessage(copy).catch(() => {});
        return;
      }
    }
    const jid = parseJid(node.attrs.from ?? ''),
      friend = jid && this.roster.get(jid.subject);
    if (!jid || !friend || jid.bare !== friend.jid) return;
    if (node.attrs.type === 'error') {
      const messages = this.state.messages[jid.subject] ?? [];
      const failed = messages.find((m) => m.direction === 'outgoing' && m.id === node.attrs.id);
      if (failed) void this.addMessage({ ...failed, state: 'failed' }, false).catch(() => {});
      return;
    }
    if (node.attrs.type && node.attrs.type !== 'chat' && node.attrs.type !== 'normal') return;
    const body = child(node, 'body')?.text;
    if (!body || !['', NS.client].includes(child(node, 'body')!.ns)) return;
    try {
      messageBody(body);
    } catch {
      return;
    }
    if (
      node.attrs.to &&
      parseJid(node.attrs.to)?.bare !== `${this.credentials?.subject}@${this.credentials?.domain}`
    )
      return;
    const id = node.attrs.id?.slice(0, 512) || `incoming-${this.now()}-${++this.counter}`;
    if (
      (this.state.messages[jid.subject] ?? []).some(
        (m) => m.id === id && m.direction === 'incoming',
      )
    )
      return;
    const stamp = chatTimestamp(node.attrs.stamp ?? child(node, 'delay')?.attrs.stamp),
      at = stamp !== undefined && stamp <= this.now() ? stamp : this.now();
    void this.addMessage({
      id,
      subject: jid.subject,
      body,
      at,
      direction: 'incoming',
      state: 'received',
      source: 'live',
    }).catch(() => {});
  }
  private persistMessage(message: ChatMessage): Promise<void> {
    const work = Promise.resolve()
      .then(() => this.hooks.saveMessage?.(message))
      .then(() => {
        if (this.state.storageError) this.update({ storageError: undefined });
      })
      .catch(() => {
        this.update({
          storageError: 'A message could not be saved to local history. Check available storage.',
        });
        throw new AppError('CHAT_STORAGE', 'The message could not be saved locally.');
      });
    this.persistence.add(work);
    void work.then(
      () => this.persistence.delete(work),
      () => this.persistence.delete(work),
    );
    return work;
  }

  async flushPersistence(): Promise<void> {
    while (this.persistence.size || this.sends.size)
      await Promise.allSettled([...this.persistence, ...this.sends]);
  }
  private async addMessage(message: ChatMessage, notify = true) {
    const old = this.state.messages[message.subject] ?? [],
      exists = old.some((m) => messageKey(m) === messageKey(message));
    const messages = { ...this.state.messages };
    if (Object.keys(messages).length >= 50 && !messages[message.subject])
      delete messages[Object.keys(messages)[0]!];
    messages[message.subject] = mergeMessages(old, [message]);
    this.update({
      messages,
      unread:
        notify &&
        !exists &&
        message.direction === 'incoming' &&
        this.openConversation !== message.subject
          ? {
              ...this.state.unread,
              [message.subject]: Math.min(999, (this.state.unread[message.subject] ?? 0) + 1),
            }
          : this.state.unread,
    });
    await this.persistMessage(message);
    if (notify && !exists && message.direction === 'incoming' && message.source !== 'riot-archive')
      void this.hooks.incoming?.(message).catch(() => {});
  }
  hydrateMessages(subject: string, messages: ChatMessage[]) {
    this.update({
      messages: {
        ...this.state.messages,
        [subject]: mergeMessages(messages, this.state.messages[subject] ?? []),
      },
    });
  }
  async requestHistory(
    subject: string,
    options: { signal?: AbortSignal; hydrate?: boolean } = {},
  ): Promise<number> {
    const c = this.credentials,
      friend = this.roster.get(subject),
      signal = options.signal;
    if (signal?.aborted) throw new AppError('CHAT_HISTORY_CANCELLED', 'History sync stopped.');
    if (this.phase !== 'ready' || !c || !friend || !this.socket)
      throw new AppError(
        'CHAT_OFFLINE',
        'Chat is reconnecting. History sync is available once the friend list is ready.',
      );
    if (c.expiresAt <= this.now())
      throw new AppError('SESSION_EXPIRED', 'Chat is renewing automatically before history sync.');
    if (this.historyRequests.size)
      throw new AppError(
        'CHAT_HISTORY_BUSY',
        'Another conversation is syncing.',
        this.now() + 2000,
      );
    const allowed = this.historyTimes.get(subject) ?? 0;
    if (allowed > this.now())
      throw new AppError('CHAT_COOLDOWN', 'Wait before syncing this conversation again.', allowed);
    this.historyTimes.set(subject, this.now() + 15000);
    const id = `outpost-history-${++this.counter}`,
      generation = this.generation;
    this.update({ archive: { ...this.state.archive, [subject]: { status: 'loading' } } });
    return new Promise<number>((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        this.historyRequests.delete(id);
      };
      const fail = (error: AppError) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (generation === this.generation)
          this.update({
            archive: {
              ...this.state.archive,
              [subject]: { status: 'error', message: error.message },
            },
          });
        reject(error);
      };
      const abort = () =>
        fail(
          new AppError('CHAT_HISTORY_CANCELLED', 'History sync stopped. Saved messages are kept.'),
        );
      const timer = setTimeout(
        () =>
          fail(
            new AppError(
              'CHAT_HISTORY_TIMEOUT',
              'Riot did not answer this history request. Saved messages are unchanged.',
            ),
          ),
        20000,
      );
      this.historyRequests.set(id, {
        friend,
        timer,
        reject: fail,
        receiving: false,
        signal,
        hydrate: options.hydrate !== false,
        resolve: (count) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(count);
        },
      });
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) {
        abort();
        return;
      }
      this.sendRaw(
        `<iq type="get" id="${id}"><query xmlns="${ARCHIVE_NS}"><with>${xml(friend.jid)}</with></query></iq>`,
      );
    });
  }
  private async receiveHistory(node: XmlNode): Promise<void> {
    const request = this.historyRequests.get(node.attrs.id ?? ''),
      c = this.credentials;
    if (!request || !c || request.receiving || request.signal?.aborted) return;
    const ownBare = `${c.subject}@${c.domain}`;
    if (
      node.attrs.from &&
      node.attrs.from !== c.domain &&
      parseJid(node.attrs.from)?.bare !== ownBare
    )
      return;
    if (!['result', 'error'].includes(node.attrs.type ?? '')) return;
    const generation = this.generation;
    clearTimeout(request.timer);
    request.receiving = true;
    try {
      if (node.attrs.type === 'error') {
        const condition = child(node, 'error')?.children.find(
          (n) => n.ns === 'urn:ietf:params:xml:ns:xmpp-stanzas',
        )?.name;
        if (['resource-constraint', 'policy-violation'].includes(condition ?? ''))
          throw new AppError(
            'CHAT_HISTORY_RATE_LIMIT',
            'Riot asked chat history to slow down. Resume later.',
            this.now() + 60000,
          );
        if (['feature-not-implemented', 'service-unavailable'].includes(condition ?? ''))
          throw new AppError(
            'CHAT_HISTORY_UNSUPPORTED',
            'Riot history is unavailable on this connection.',
          );
        throw new AppError(
          'CHAT_HISTORY_UNAVAILABLE',
          'Riot did not allow this conversation history. Saved messages are kept.',
        );
      }
      const messages = parseArchiveResult(node, ownBare, request.friend, this.now());
      for (const message of messages) {
        if (request.signal?.aborted)
          throw new AppError('CHAT_HISTORY_CANCELLED', 'History sync stopped.');
        if (generation !== this.generation)
          throw new AppError('CHAT_OFFLINE', 'History sync stopped when the connection changed.');
        await this.persistMessage(message);
      }
      if (request.signal?.aborted)
        throw new AppError('CHAT_HISTORY_CANCELLED', 'History sync stopped.');
      if (generation !== this.generation)
        throw new AppError('CHAT_OFFLINE', 'The chat connection changed.');
      this.update({
        messages: request.hydrate
          ? {
              ...this.state.messages,
              [request.friend.subject]: mergeMessages(
                this.state.messages[request.friend.subject] ?? [],
                messages,
              ),
            }
          : this.state.messages,
        archive: {
          ...this.state.archive,
          [request.friend.subject]: {
            status: 'ready',
            count: messages.length,
            at: this.now(),
            message: messages.length
              ? `${messages.length} messages returned by Riot. Saved history is deduplicated.`
              : 'Riot returned no retained messages for this conversation.',
          },
        },
      });
      request.resolve(messages.length);
    } catch (reason) {
      request.reject(safeError(reason));
    }
  }
  send(subject: string, value: string): Promise<void> {
    const work = this.sendMessage(subject, value);
    this.sends.add(work);
    void work.then(
      () => this.sends.delete(work),
      () => this.sends.delete(work),
    );
    return work;
  }
  private async sendMessage(subject: string, value: string): Promise<void> {
    if (this.credentials && this.credentials.expiresAt <= this.now()) {
      this.fail('Chat session renewal is needed.', 'SESSION_EXPIRED');
      throw new AppError('SESSION_EXPIRED', 'Your chat session is renewing automatically.');
    }
    const body = messageBody(value),
      friend = this.roster.get(subject);
    if (this.phase !== 'ready' || !this.socket || !friend)
      throw new AppError(
        'CHAT_OFFLINE',
        'Chat is reconnecting. Your draft is kept until the friend list is ready.',
      );
    if (this.now() - this.lastSend < 1000)
      throw new AppError('CHAT_COOLDOWN', 'Wait a second before sending another message.');
    this.lastSend = this.now();
    const epoch = this.generation,
      id = `outpost-${this.hooks.newId?.() ?? `${this.now()}-${++this.counter}`}`;
    const outgoing: ChatMessage = {
      id,
      subject,
      body,
      at: this.now(),
      direction: 'outgoing',
      state: 'sending',
      source: 'outpost',
    };
    const socket = this.socket;
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
      await this.addMessage(outgoing);
      if (
        epoch !== this.generation ||
        this.phase !== 'ready' ||
        this.socket !== socket ||
        !this.roster.has(subject) ||
        !this.credentials ||
        this.credentials.expiresAt <= this.now()
      )
        throw new AppError('CHAT_OFFLINE', 'The connection changed before sending.');
      await socket.write(
        `<message type="chat" to="${xml(friend.jid)}" id="${xml(id)}"><body>${xml(body)}</body></message>`,
      );
      if (epoch !== this.generation)
        throw new AppError(
          'CHAT_OFFLINE',
          'The connection changed while sending. Delivery is unconfirmed.',
        );
      settle('sent');
      await this.persistMessage({ ...outgoing, state: 'sent' });
    } catch {
      if (epoch === this.generation) settle('failed');
      await this.persistMessage({ ...outgoing, state: 'failed' }).catch(() => {});
      throw new AppError(
        'CHAT_SEND',
        'The message could not be confirmed as sent. It was not retried automatically.',
      );
    }
  }
  changeFriend(action: FriendAction, player: PlayerRef): Promise<void> {
    const c = this.credentials,
      subject = validFriendTarget(player, c?.subject ?? '');
    if (!['add', 'accept', 'decline'].includes(action))
      throw new AppError('FRIEND_ACTION', 'Unknown friend action.');
    if (this.phase !== 'ready' || !c || !this.socket || c.expiresAt <= this.now())
      throw new AppError(
        'CHAT_OFFLINE',
        'Friends are reconnecting automatically. Try the request once connected.',
      );
    const incoming = this.requests.get(subject);
    if (action !== 'add' && incoming?.direction !== 'incoming')
      throw new AppError('FRIEND_REQUEST_CHANGED', 'This incoming request is no longer available.');
    if (this.roster.has(subject)) throw new AppError('ALREADY_FRIENDS', 'You are already friends.');
    if (action === 'add' && incoming)
      throw new AppError(
        'FRIEND_REQUEST_PENDING',
        incoming.direction === 'incoming'
          ? 'Accept the incoming request instead.'
          : 'A request has already been sent.',
      );
    if (
      this.friendWrites.size >= 3 ||
      [...this.friendWrites.values()].some((v) => v.subject === subject)
    )
      throw new AppError('FRIEND_BUSY', 'A friend request is already being processed.');
    const allowed = Math.max(this.lastFriendWrite + 2000, this.friendTimes.get(subject) ?? 0);
    if (allowed > this.now())
      throw new AppError('FRIEND_COOLDOWN', 'Wait before changing this request again.', allowed);
    const id = `outpost-friend-${++this.counter}`,
      epoch = this.generation,
      at = this.now(),
      socket = this.socket;
    for (const [key, until] of this.friendTimes) if (until <= at) this.friendTimes.delete(key);
    this.lastFriendWrite = at;
    this.friendTimes.set(subject, at + FRIEND_ACTION_COOLDOWN);
    this.update({
      friendActions: {
        ...this.state.friendActions,
        [subject]: { action, state: 'sending', at, retryAt: at + FRIEND_ACTION_COOLDOWN },
      },
    });
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          this.finishFriend(
            id,
            new AppError(
              'FRIEND_UNCONFIRMED',
              'Riot has not confirmed this request. It was not sent again automatically.',
            ),
          ),
        15000,
      );
      this.friendWrites.set(id, { subject, action, resolve, reject, timer });
      const value = friendMutationXml(id, action, subject, incoming);
      detailedDiagnosticEvent('xmpp-out', { stanza: value });
      void socket.write(value).catch(() => {
        if (epoch === this.generation)
          this.finishFriend(
            id,
            new AppError(
              'FRIEND_UNCONFIRMED',
              'The connection changed. Check requests before trying again.',
            ),
          );
      });
    });
  }
  private finishFriend(id: string, error?: AppError): void {
    const operation = this.friendWrites.get(id);
    if (!operation) return;
    clearTimeout(operation.timer);
    this.friendWrites.delete(id);
    for (const [query, subject] of this.friendChecks)
      if (subject === operation.subject) this.friendChecks.delete(query);
    const actions = { ...this.state.friendActions },
      old = actions[operation.subject];
    if (error && old)
      actions[operation.subject] = {
        ...old,
        state: 'error',
        code: error.code,
        message: error.message,
      };
    else delete actions[operation.subject];
    this.update({ friendActions: actions });
    error ? operation.reject(error) : operation.resolve();
  }
  private friendMatches(subject: string, action: FriendAction): boolean {
    return action === 'accept'
      ? this.roster.has(subject)
      : action === 'add'
        ? this.roster.has(subject) || this.requests.get(subject)?.direction === 'outgoing'
        : !this.requests.has(subject) && !this.roster.has(subject);
  }
  private friendReply(node: XmlNode): void {
    const id = node.attrs.id!,
      operation = this.friendWrites.get(id);
    if (!operation) return;
    if (node.attrs.type === 'error') {
      const reason = child(node, 'error')?.children.find(
        (n) => n.ns === 'urn:ietf:params:xml:ns:xmpp-stanzas',
      )?.name;
      this.finishFriend(
        id,
        new AppError(
          'FRIEND_REJECTED',
          reason ? `Riot rejected the request (${reason}).` : 'Riot rejected this friend request.',
        ),
      );
      return;
    }
    const old = this.state.friendActions?.[operation.subject];
    if (old?.state === 'awaiting') return;
    if (old)
      this.update({
        friendActions: {
          ...this.state.friendActions,
          [operation.subject]: { ...old, state: 'awaiting' },
        },
      });
    const query = `outpost-friends-check-${++this.counter}`;
    this.friendChecks.set(query, operation.subject);
    this.sendRaw(
      `<iq id="${query}" type="get"><query xmlns="jabber:iq:riotgames:roster" last_state="true"/></iq>`,
    );
  }
  private fail(message: string, code = 'CHAT_NETWORK', retryAt?: number) {
    this.disconnect();
    this.update({ status: 'error', error: message, errorCode: code, retryAt });
  }
  markRead(subject?: string) {
    this.openConversation = subject;
    if (subject && this.state.unread[subject])
      this.update({ unread: { ...this.state.unread, [subject]: 0 } });
  }
  disconnect(clear = false) {
    for (const id of [...this.friendWrites.keys()])
      this.finishFriend(
        id,
        new AppError(
          'FRIEND_UNCONFIRMED',
          'Chat disconnected before the request was confirmed. Check requests after reconnecting.',
        ),
      );
    this.friendChecks.clear();
    if (clear) {
      this.requests.clear();
      this.friendTimes.clear();
    }
    for (const request of this.historyRequests.values()) {
      clearTimeout(request.timer);
      request.reject(
        new AppError('CHAT_OFFLINE', 'History sync stopped because chat disconnected.'),
      );
    }
    this.historyRequests.clear();
    this.historyTimes.clear();
    for (const entries of Object.values(this.state.messages))
      for (const m of entries)
        if (m.state === 'sending')
          void this.persistMessage({ ...m, state: 'failed' }).catch(() => {});
    this.generation++;
    this.probe = undefined;
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
    clearTimeout(this.presenceTimer);
    this.presenceTimer = undefined;
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
      selfPresence: undefined,
      status: 'disconnected',
      friends,
      error: undefined,
      errorCode: undefined,
      messages,
      ...(clear ? { messages: {}, unread: {}, friendRequests: [], friendActions: {} } : {}),
    });
  }
}
