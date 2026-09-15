import type { ChatStore } from '../core/chatStore';
import type { ChatMessage, Friend } from '../core/chatTypes';
import { mergeMessage, messageKey } from '../core/messageHistory';

const key = 'outpost.demo.chat.v1';
let data: { messages: ChatMessage[]; friends: Friend[]; read: Record<string, number> } = {
  messages: [],
  friends: [],
  read: {},
};
try {
  if (typeof localStorage !== 'undefined') {
    const raw = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (raw?.messages && raw.friends && raw.read) data = raw;
  }
} catch {}
const persist = () => {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, JSON.stringify(data));
  } catch {}
};
export const demoChatStorage: ChatStore = {
  async save(m) {
    const index = data.messages.findIndex(
      (old) => old.subject === m.subject && messageKey(old) === messageKey(m),
    );
    if (index < 0) data.messages.push(m);
    else data.messages[index] = mergeMessage(data.messages[index], m);
    persist();
  },
  async saveFriends(friends) {
    data.friends = friends;
    persist();
  },
  async conversations() {
    const peers = [
      ...new Set([...data.friends.map((f) => f.subject), ...data.messages.map((m) => m.subject)]),
    ];
    return peers.map((subject) => {
      const msgs = data.messages.filter((m) => m.subject === subject);
      return {
        subject,
        friend: data.friends.find((f) => f.subject === subject),
        lastAt: Math.max(0, ...msgs.map((m) => m.at)),
        count: msgs.length,
        unread: msgs.filter((m) => m.direction === 'incoming' && m.at > (data.read[subject] ?? 0))
          .length,
      };
    });
  },
  async messages(subject, before) {
    const rows = data.messages
      .filter(
        (m) =>
          m.subject === subject &&
          (!before || m.at < before.at || (m.at === before.at && m.id < before.id)),
      )
      .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
    const messages = rows.slice(-100),
      first = messages[0];
    return {
      messages,
      ...(rows.length > 100 && first
        ? { older: { at: first.at, id: first.id, direction: first.direction } }
        : {}),
    };
  },
  async markRead(subject, at = Date.now()) {
    data.read[subject] = at;
    persist();
  },
  async clear(subject) {
    data.messages = subject ? data.messages.filter((m) => m.subject !== subject) : [];
    persist();
  },
  async flush() {},
  async close() {},
};
