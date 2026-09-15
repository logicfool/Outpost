import type { ChatMessage, Conversation, Friend, MessageCursor } from './chatTypes';
import { mergeMessage, validateMessage } from './messageHistory';
import { AppError, uuid } from './validation';

export interface ChatDatabase {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...args: any[]): Promise<any>;
  getFirstAsync<T>(sql: string, ...args: any[]): Promise<T | null>;
  getAllAsync<T>(sql: string, ...args: any[]): Promise<T[]>;
}
export interface ChatStore {
  save(message: ChatMessage): Promise<void>;
  saveFriends(friends: Friend[]): Promise<void>;
  conversations(): Promise<Conversation[]>;
  messages(
    subject: string,
    before?: MessageCursor,
  ): Promise<{ messages: ChatMessage[]; older?: MessageCursor }>;
  markRead(subject: string, now?: number): Promise<void>;
  clear(subject?: string): Promise<void>;
  flush(): Promise<void>;
  close(): Promise<void>;
}

export async function createChatStore(db: ChatDatabase): Promise<ChatStore> {
  await db.execAsync(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON;
    CREATE TABLE IF NOT EXISTS conversations (peer TEXT PRIMARY KEY, identity TEXT, read_at INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS messages (peer TEXT NOT NULL, id TEXT NOT NULL, direction TEXT NOT NULL, at INTEGER NOT NULL, data TEXT NOT NULL, origin TEXT NOT NULL, PRIMARY KEY(peer,direction,id));
    CREATE INDEX IF NOT EXISTS chat_timeline ON messages(peer,at DESC,id DESC,direction DESC);
    PRAGMA user_version=1;`);

  const interrupted = await db.getAllAsync<{
    peer: string;
    id: string;
    direction: string;
    data: string;
  }>("SELECT peer,id,direction,data FROM messages WHERE json_extract(data,'$.state')='sending'");
  for (const row of interrupted) {
    const m = JSON.parse(row.data) as ChatMessage;
    m.state = 'failed';
    await db.runAsync(
      'UPDATE messages SET data=? WHERE peer=? AND id=? AND direction=?',
      JSON.stringify(m),
      row.peer,
      row.id,
      row.direction,
    );
  }
  let queue: Promise<unknown> = Promise.resolve(),
    closed = false;
  const write = <T>(fn: () => Promise<T>): Promise<T> => {
    if (closed)
      return Promise.reject(
        new AppError('CHAT_STORAGE_CLOSED', 'The account chat storage was closed.'),
      );
    const work = queue.catch(() => {}).then(fn);
    queue = work;
    return work;
  };
  const read = async () => {
    if (closed) throw new AppError('CHAT_STORAGE_CLOSED', 'Chat storage is closed.');
    await queue.catch(() => {});
  };
  return {
    save(message) {
      message = { ...validateMessage(message) };
      return write(async () => {
        const old = await db.getFirstAsync<{ data: string }>(
          'SELECT data FROM messages WHERE peer=? AND id=? AND direction=?',
          uuid(message.subject),
          message.id,
          message.direction,
        );
        const merged = mergeMessage(
          old ? (JSON.parse(old.data) as ChatMessage) : undefined,
          message,
        );
        await db.runAsync('INSERT OR IGNORE INTO conversations(peer) VALUES(?)', message.subject);
        await db.runAsync(
          'INSERT INTO messages(peer,id,direction,at,data,origin) VALUES(?,?,?,?,?,?) ON CONFLICT(peer,direction,id) DO UPDATE SET data=excluded.data',
          message.subject,
          message.id,
          message.direction,
          merged.at,
          JSON.stringify(merged),
          merged.source ?? 'live',
        );
      });
    },
    saveFriends(friends) {
      const rows = friends.slice(0, 1500).map((f) => ({
        subject: uuid(f.subject),
        data: JSON.stringify({
          subject: f.subject,
          jid: f.jid,
          name: f.name,
          tag: f.tag,
          card: f.card,
          title: f.title,
          level: f.level,
          hideLevel: f.hideLevel,
          tier: f.tier,
          presence: 'offline',
        }),
      }));
      return write(async () => {
        for (const row of rows)
          await db.runAsync(
            'INSERT INTO conversations(peer,identity) VALUES(?,?) ON CONFLICT(peer) DO UPDATE SET identity=excluded.identity',
            row.subject,
            row.data,
          );
      });
    },
    async conversations() {
      await read();
      const rows = await db.getAllAsync<{
        peer: string;
        identity: string | null;
        last_at: number;
        count: number;
        unread: number;
      }>(`SELECT c.peer,c.identity,COALESCE(MAX(m.at),0) AS last_at,COUNT(m.id) AS count,
        COALESCE(SUM(CASE WHEN m.direction='incoming' AND m.at>c.read_at AND m.origin!='riot-archive' THEN 1 ELSE 0 END),0) AS unread
        FROM conversations c LEFT JOIN messages m ON m.peer=c.peer GROUP BY c.peer ORDER BY last_at DESC,c.peer`);
      return rows.map((r) => ({
        subject: r.peer,
        friend: r.identity ? (JSON.parse(r.identity) as Friend) : undefined,
        lastAt: r.last_at,
        count: r.count,
        unread: r.unread,
      }));
    },
    async messages(subject, before) {
      uuid(subject);
      await read();
      if (
        before &&
        (!Number.isSafeInteger(before.at) ||
          !before.id ||
          before.id.length > 8192 ||
          !['incoming', 'outgoing'].includes(before.direction))
      )
        throw new AppError('CHAT_CURSOR', 'Invalid history position.');
      const rows = before
        ? await db.getAllAsync<{ data: string }>(
            'SELECT data FROM messages WHERE peer=? AND (at<? OR (at=? AND id<?) OR (at=? AND id=? AND direction<?)) ORDER BY at DESC,id DESC,direction DESC LIMIT 101',
            subject,
            before.at,
            before.at,
            before.id,
            before.at,
            before.id,
            before.direction,
          )
        : await db.getAllAsync<{ data: string }>(
            'SELECT data FROM messages WHERE peer=? ORDER BY at DESC,id DESC,direction DESC LIMIT 101',
            subject,
          );
      const more = rows.length > 100;
      const messages = rows
          .slice(0, 100)
          .map((r) => validateMessage(JSON.parse(r.data) as ChatMessage))
          .reverse(),
        first = messages[0];
      return {
        messages,
        ...(more && first
          ? { older: { at: first.at, id: first.id, direction: first.direction } }
          : {}),
      };
    },
    markRead(subject, now = Date.now()) {
      uuid(subject);
      return write(async () => {
        await db.runAsync(
          'INSERT INTO conversations(peer,read_at) VALUES(?,?) ON CONFLICT(peer) DO UPDATE SET read_at=MAX(read_at,excluded.read_at)',
          subject,
          now,
        );
      });
    },

    clear(subject) {
      if (subject) uuid(subject);
      return write(async () => {
        if (subject) await db.runAsync('DELETE FROM messages WHERE peer=?', subject);
        else await db.execAsync('DELETE FROM messages;');
      });
    },
    async flush() {
      await queue;
    },
    async close() {
      closed = true;
      await queue.catch(() => {});
    },
  };
}
