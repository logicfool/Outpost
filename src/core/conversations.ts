import type { ChatMessage, ChatState, Conversation, Friend } from './chatTypes';
export interface ConversationRow {
  subject: string;
  friend?: Friend;
  lastAt: number;
  lastMessage?: ChatMessage;
  count: number;
  unread: number;
}

export function conversationRows(
  chat: ChatState,
  saved: readonly Conversation[],
  filter: 'recent' | 'all' | 'online',
  search = '',
): ConversationRow[] {
  const rows = new Map<string, ConversationRow>();
  for (const item of saved) rows.set(item.subject, { ...item });
  for (const friend of chat.friends) {
    const old = rows.get(friend.subject);
    rows.set(friend.subject, {
      subject: friend.subject,
      lastAt: 0,
      count: 0,
      unread: 0,
      ...old,
      friend,
    });
  }
  for (const [subject, messages] of Object.entries(chat.messages)) {
    const old = rows.get(subject) ?? { subject, lastAt: 0, count: 0, unread: 0 };
    const last = messages.reduce<ChatMessage | undefined>(
      (a, b) => (!a || b.at > a.at || (b.at === a.at && b.id.localeCompare(a.id) > 0) ? b : a),
      undefined,
    );
    if (last && last.at >= old.lastAt)
      rows.set(subject, {
        ...old,
        lastMessage: last,
        lastAt: last.at,
        count: Math.max(old.count, messages.length),
      });
  }
  const liveIds = new Set(chat.friends.map((f) => f.subject)),
    query = search.trim().toLocaleLowerCase();
  return [...rows.values()]
    .map((row) => ({ ...row, unread: chat.unread[row.subject] ?? row.unread }))
    .filter((row) => {
      if (filter === 'recent' && row.count === 0) return false;
      if (filter === 'all' && !liveIds.has(row.subject)) return false;
      if (
        filter === 'online' &&
        (chat.status !== 'ready' ||
          !liveIds.has(row.subject) ||
          !row.friend ||
          row.friend.presence === 'offline')
      )
        return false;
      return (
        !query ||
        `${row.friend?.name ?? 'Saved conversation'}#${row.friend?.tag ?? ''}`
          .toLocaleLowerCase()
          .includes(query)
      );
    })
    .sort(
      (a, b) =>
        b.lastAt - a.lastAt ||
        (a.friend?.name ?? a.subject).localeCompare(b.friend?.name ?? b.subject) ||
        a.subject.localeCompare(b.subject),
    );
}
export function conversationSnippet(message?: ChatMessage): string {
  if (!message) return 'Start a conversation';
  return (
    (message.direction === 'outgoing' ? 'You: ' : '') +
    message.body.replace(/\s+/g, ' ').slice(0, 160)
  );
}
export function conversationTime(at: number, now = Date.now()): string {
  if (!at) return '';
  const date = new Date(at),
    today = new Date(now);
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
