import type { ChatMessage, Friend } from './chatTypes';
import { AppError, uuid } from './validation';
import { child, children, messageText, NS, parseJid, type XmlNode } from './xmppXml';

export const ARCHIVE_NS = 'jabber:iq:riotgames:archive';
export const CARBONS_NS = 'urn:xmpp:carbons:2';
export const FORWARD_NS = 'urn:xmpp:forward:0';
export const messageKey = (m: Pick<ChatMessage, 'id' | 'direction'>) => `${m.direction}:${m.id}`;

export function validateMessage(m: ChatMessage): ChatMessage {
  const subject = uuid(m.subject);
  if (
    !m.id ||
    m.id.length > 8192 ||
    !Number.isSafeInteger(m.at) ||
    m.at < 0 ||
    !['incoming', 'outgoing'].includes(m.direction) ||
    !['received', 'sending', 'sent', 'failed'].includes(m.state)
  ) {
    throw new AppError('CHAT_DATA', 'The message format is invalid.');
  }
  messageText(m.body);
  return { ...m, subject };
}

export function mergeMessage(old: ChatMessage | undefined, next: ChatMessage): ChatMessage {
  if (!old) return next;
  if (old.subject !== next.subject || old.body !== next.body || old.direction !== next.direction)
    return old;
  const state =
    next.serverStored || old.serverStored
      ? next.direction === 'incoming'
        ? 'received'
        : 'sent'
      : (next.state === 'sending' && old.state !== 'sending') ||
          (old.state === 'failed' && next.state === 'sent' && next.source === 'outpost')
        ? old.state
        : next.state;
  return { ...old, state, serverStored: old.serverStored || next.serverStored || undefined };
}
export function mergeMessages(
  old: ChatMessage[],
  added: ChatMessage[],
  limit = 200,
): ChatMessage[] {
  const map = new Map(old.map((m) => [messageKey(m), m]));
  for (const m of added) map.set(messageKey(m), mergeMessage(map.get(messageKey(m)), m));
  return [...map.values()]
    .sort(
      (a, b) => a.at - b.at || a.id.localeCompare(b.id) || a.direction.localeCompare(b.direction),
    )
    .slice(-limit);
}

export function chatTimestamp(value: string | undefined): number | undefined {
  if (!value) return;

  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/.test(value)
    ? value.replace(' ', 'T') + 'Z'
    : value;
  if (!/Z$|[+-]\d{2}:?\d{2}$/.test(normalized)) return;
  const n = Date.parse(normalized);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}
function cleanBody(node: XmlNode): string | undefined {
  const body = child(node, 'body')?.text;
  if (!body || !['', NS.client, ARCHIVE_NS].includes(child(node, 'body')!.ns)) return;
  try {
    messageText(body);
    return body;
  } catch {
    return;
  }
}

export function historyMessage(
  node: XmlNode,
  ownBare: string,
  friend: Friend,
  origin: 'riot-archive' | 'riot-client',
  now: number,
  inferred?: 'incoming' | 'outgoing',
): ChatMessage | undefined {
  if (
    node.name !== 'message' ||
    !['', NS.client, ARCHIVE_NS].includes(node.ns) ||
    (node.attrs.type && !['chat', 'normal'].includes(node.attrs.type))
  )
    return;
  const body = cleanBody(node);
  if (!body) return;
  const from = parseJid(node.attrs.from ?? ''),
    to = parseJid(node.attrs.to ?? '');
  if ((node.attrs.from && !from) || (node.attrs.to && !to)) return;
  let direction: ChatMessage['direction'];
  if (from?.bare === friend.jid && (!to || to.bare === ownBare)) direction = 'incoming';
  else if (to?.bare === friend.jid && (!from || from.bare === ownBare)) direction = 'outgoing';
  else return;
  if (inferred && direction !== inferred) return;
  const at = chatTimestamp(node.attrs.stamp ?? child(node, 'delay', 'urn:xmpp:delay')?.attrs.stamp);
  if ((origin === 'riot-archive' && at === undefined) || (at !== undefined && at > now + 60000))
    return;
  const time = at ?? now;

  const id =
    node.attrs.id && node.attrs.id.length <= 512
      ? node.attrs.id
      : JSON.stringify(['archive', time, body]);
  return {
    id,
    subject: friend.subject,
    body,
    at: time,
    direction,
    state: direction === 'incoming' ? 'received' : 'sent',
    source: origin,
    serverStored: origin === 'riot-archive' || undefined,
  };
}
export function parseArchiveResult(
  node: XmlNode,
  ownBare: string,
  friend: Friend,
  now = Date.now(),
): ChatMessage[] {
  const query = child(node, 'query', ARCHIVE_NS);
  const direct = children(node, 'message'),
    nested = query ? children(query, 'message') : [];
  if (
    (!query && !direct.length && node.children.length > 0) ||
    node.children.some((n) => n.name === 'query' && n.ns !== ARCHIVE_NS)
  ) {
    throw new AppError(
      'CHAT_HISTORY_FORMAT',
      'Riot returned an unsupported history format. Saved messages are unchanged.',
    );
  }
  const rows = [...direct, ...nested];
  if (rows.length > 500)
    throw new AppError('CHAT_HISTORY_SIZE', 'Riot returned too much history in one response.');
  const parsed = rows
    .map((n) => historyMessage(n, ownBare, friend, 'riot-archive', now))
    .filter((m): m is ChatMessage => !!m);
  if (rows.length && !parsed.length)
    throw new AppError(
      'CHAT_HISTORY_FORMAT',
      'Riot history could not be validated for this conversation.',
    );
  return mergeMessages([], parsed, 500);
}

export function parseCarbon(
  node: XmlNode,
  ownBare: string,
  friends: Friend[],
  now = Date.now(),
): ChatMessage | undefined {
  if (parseJid(node.attrs.from ?? '')?.bare !== ownBare) return;
  const sent = child(node, 'sent', CARBONS_NS),
    received = child(node, 'received', CARBONS_NS);
  if (!!sent === !!received) return;
  const wrapper = sent ?? received!,
    forwarded = child(wrapper, 'forwarded', FORWARD_NS);
  const raw = forwarded && child(forwarded, 'message');
  if (!raw || !['', NS.client, FORWARD_NS].includes(raw.ns)) return;

  const inner =
    raw.ns === FORWARD_NS
      ? {
          ...raw,
          ns: NS.client,
          children: raw.children.map((n) =>
            n.name === 'body' && n.ns === FORWARD_NS ? { ...n, ns: NS.client } : n,
          ),
        }
      : raw;
  const direction = sent ? 'outgoing' : 'incoming';
  const peerJid = parseJid(inner.attrs[direction === 'outgoing' ? 'to' : 'from'] ?? '');
  const friend = friends.find((f) => f.jid === peerJid?.bare);
  if (!friend) return;
  const delay = child(forwarded!, 'delay', 'urn:xmpp:delay');
  const candidate =
    delay && !inner.attrs.stamp
      ? { ...inner, attrs: { ...inner.attrs, stamp: delay.attrs.stamp ?? '' } }
      : inner;
  return historyMessage(candidate, ownBare, friend, 'riot-client', now, direction);
}
