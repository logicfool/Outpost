const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createChatStore } = require('../.test-build/chatStore.js');
const { ID, OTHER, code } = require('./helpers.cjs');
function adapter(file = ':memory:') {
  const db = new DatabaseSync(file);
  return {
    raw: db,
    execAsync: async (sql) => db.exec(sql),
    runAsync: async (sql, ...args) => db.prepare(sql).run(...args),
    getAllAsync: async (sql, ...args) => db.prepare(sql).all(...args),
    getFirstAsync: async (sql, ...args) => db.prepare(sql).get(...args) ?? null,
  };
}
const message = (n, patch = {}) => ({
  id: `m-${String(n).padStart(5, '0')}`,
  subject: OTHER,
  body: `Message ${n}`,
  at: 1000 + n,
  direction: 'incoming',
  state: 'received',
  source: 'live',
  ...patch,
});
async function fixture(t, file) {
  const db = adapter(file),
    store = await createChatStore(db);
  t.after(async () => {
    await store.close();
    db.raw.close();
  });
  return store;
}
test('messages persist across close/reopen instead of disappearing on disconnect', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'outpost-chat-test-')),
    file = path.join(dir, 'chat.db');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const first = adapter(file),
    a = await createChatStore(first);
  await a.save(message(1));
  await a.close();
  first.raw.close();
  const second = adapter(file),
    b = await createChatStore(second);
  assert.equal((await b.messages(OTHER)).messages[0].body, 'Message 1');
  await b.close();
  second.raw.close();
});
test('more than 200 saved messages are retained and all pages can be read', async (t) => {
  const s = await fixture(t);
  for (let n = 0; n < 355; n++) await s.save(message(n));
  let cursor,
    count = 0;
  const ids = new Set();
  do {
    const p = await s.messages(OTHER, cursor);
    p.messages.forEach((m) => ids.add(m.id));
    count += p.messages.length;
    cursor = p.older;
  } while (cursor);
  assert.equal(count, 355);
  assert.equal(ids.size, 355);
  assert.equal((await s.conversations())[0].count, 355);
});
test('same timestamp pagination does not lose equal-time message IDs', async (t) => {
  const s = await fixture(t);
  for (let n = 0; n < 205; n++) await s.save(message(n, { at: 1000 }));
  const p1 = await s.messages(OTHER),
    p2 = await s.messages(OTHER, p1.older),
    p3 = await s.messages(OTHER, p2.older);
  assert.equal(
    new Set([...p1.messages, ...p2.messages, ...p3.messages].map((m) => m.id)).size,
    205,
  );
});
test('duplicate archive fetches merge with local sends without duplicating rows', async (t) => {
  const s = await fixture(t),
    m = message(1, { direction: 'outgoing', state: 'sending', source: 'outpost' });
  await s.save(m);
  await s.save({ ...m, state: 'sent' });
  await s.save({ ...m, state: 'sent', source: 'riot-archive', serverStored: true });
  await s.save({ ...m, state: 'sending' });
  const p = await s.messages(OTHER);
  assert.equal(p.messages.length, 1);
  assert.equal(p.messages[0].state, 'sent');
  assert.equal(p.messages[0].serverStored, true);
});
test('unconfirmed outgoing writes become failed on reopening and are not replayed', async () => {
  const db = adapter(),
    s = await createChatStore(db);
  await s.save(message(2, { direction: 'outgoing', state: 'sending' }));
  await s.close();
  const reopened = await createChatStore(db);
  assert.equal((await reopened.messages(OTHER)).messages[0].state, 'failed');
  await reopened.close();
  db.raw.close();
});
test('two account databases never share messages', async (t) => {
  const a = await fixture(t),
    b = await fixture(t);
  await a.save(message(1));
  assert.equal((await b.messages(OTHER)).messages.length, 0);
});
test('deleting one conversation does not delete another or break future writes', async (t) => {
  const s = await fixture(t);
  await s.save(message(1));
  await s.save(message(2, { subject: ID }));
  await s.clear(OTHER);
  assert.equal((await s.messages(OTHER)).messages.length, 0);
  assert.equal((await s.messages(ID)).messages.length, 1);
  await s.save(message(3));
  assert.equal((await s.messages(OTHER)).messages.length, 1);
});
test('stored markup and punctuation are data, never SQL statements', async (t) => {
  const s = await fixture(t);
  const m = message(1, {
    id: "' ; DROP TABLE messages; --",
    body: '<script>hello</script> & नमस्ते',
  });
  await s.save(m);
  assert.equal((await s.messages(OTHER)).messages[0].body, m.body);
});
test('archive retrieval does not create unread notifications for old messages', async (t) => {
  const s = await fixture(t);
  await s.save(message(1));
  await s.save(message(2, { source: 'riot-archive' }));
  assert.equal((await s.conversations())[0].unread, 1);
  await s.markRead(OTHER, 2000);
  assert.equal((await s.conversations())[0].unread, 0);
});
test('closed account storage rejects new writes', async (t) => {
  const s = await fixture(t);
  await s.close();
  await assert.rejects(s.save(message(1)), code('CHAT_STORAGE_CLOSED'));
});

test('observed delivery rejection cannot be overwritten by a late local-write success', async (t) => {
  const s = await fixture(t),
    m = message(1, { direction: 'outgoing', source: 'outpost', state: 'sending' });
  await s.save(m);
  await s.save({ ...m, state: 'failed' });
  await s.save({ ...m, state: 'sent' });
  assert.equal((await s.messages(OTHER)).messages[0].state, 'failed');
  await s.save({ ...m, state: 'sent', source: 'riot-archive', serverStored: true });
  assert.equal((await s.messages(OTHER)).messages[0].state, 'sent');
});
test('FULL synchronous commits are enabled for durable message writes', async () => {
  const db = adapter(),
    s = await createChatStore(db);
  assert.equal(db.raw.prepare('PRAGMA synchronous').get().synchronous, 2);
  await s.close();
  db.raw.close();
});
test('UUID case is normalized before message indexing', async (t) => {
  const s = await fixture(t),
    peer = 'abcdefab-cdef-4123-8123-abcdefabcdef';
  await s.save(message(1, { subject: peer.toUpperCase() }));
  assert.equal((await s.messages(peer)).messages[0].subject, peer);
});

test('sparse roster reconnect preserves the saved player card on disk', async (t) => {
  const s = await fixture(t),
    card = { id: ID, canonicalId: ID, kind: 'card', name: 'Cached banner' };
  await s.saveFriends([
    {
      subject: OTHER,
      jid: OTHER + '@ap1.pvp.net',
      name: 'Old',
      tag: 'TEST',
      presence: 'online',
      card,
      cardObservedAt: 100,
    },
  ]);
  await s.saveFriends([
    { subject: OTHER, jid: OTHER + '@ap1.pvp.net', name: 'New', tag: 'TEST', presence: 'offline' },
  ]);
  const f = (await s.conversations())[0].friend;
  assert.equal(f.name, 'New');
  assert.equal(f.card.id, ID);
  assert.equal(f.cardObservedAt, 100);
});
test('conversation summaries retain the latest message text and order after reopening', async (t) => {
  const s = await fixture(t);
  await s.save(message(1, { subject: OTHER, at: 1000, body: 'Older' }));
  await s.save(message(2, { subject: ID, at: 2000, body: 'Latest' }));
  const rows = await s.conversations();
  assert.deepEqual(
    rows.map((r) => r.subject),
    [ID, OTHER],
  );
  assert.equal(rows[0].lastMessage.body, 'Latest');
  await s.save(message(3, { subject: OTHER, at: 3000, body: 'Now first' }));
  assert.equal((await s.conversations())[0].lastMessage.body, 'Now first');
  await s.markRead(OTHER, 4000);
  assert.equal((await s.conversations())[0].unread, 0);
});
