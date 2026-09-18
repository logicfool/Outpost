const test = require('node:test'),
  assert = require('node:assert/strict');
const { conversationRows, conversationSnippet } = require('../.test-build/conversations.js');
const { ID, OTHER } = require('./helpers.cjs');
const friend = (subject, name) => ({
  subject,
  name,
  tag: 'TEST',
  jid: subject + '@ap1.pvp.net',
  presence: 'online',
});
const msg = (subject, at, body) => ({
  subject,
  at,
  body,
  id: 'm' + at,
  direction: 'incoming',
  state: 'received',
});
const state = () => ({
  status: 'ready',
  friends: [friend(ID, 'Alpha'), friend(OTHER, 'Beta')],
  messages: {},
  unread: {},
});
test('recent chat order is newest-message first rather than presence or name order', () => {
  const chat = state(),
    saved = [
      { subject: ID, lastAt: 10, count: 1, unread: 0 },
      { subject: OTHER, lastAt: 20, count: 1, unread: 1 },
    ];
  assert.deepEqual(
    conversationRows(chat, saved, 'recent').map((r) => r.subject),
    [OTHER, ID],
  );
  chat.friends[0].presence = 'in_game';
  assert.deepEqual(
    conversationRows(chat, saved, 'recent').map((r) => r.subject),
    [OTHER, ID],
  );
});
test('a new live message moves its conversation to the top before the disk refresh', () => {
  const chat = state();
  chat.messages[ID] = [msg(ID, 30, 'Newest')];
  const rows = conversationRows(
    chat,
    [{ subject: OTHER, lastAt: 20, count: 1, unread: 0 }],
    'recent',
  );
  assert.equal(rows[0].subject, ID);
  assert.equal(rows[0].lastMessage.body, 'Newest');
});
test('cached conversations remain available offline, with no empty friends in Recent', () => {
  const chat = state();
  chat.status = 'disconnected';
  const saved = [
    { subject: OTHER, lastAt: 20, count: 1, unread: 0, lastMessage: msg(OTHER, 20, 'Saved') },
  ];
  assert.equal(conversationRows(chat, saved, 'recent').length, 1);
  assert.equal(conversationRows(chat, saved, 'online').length, 0);
});
test('chat snippets preserve message text without markup interpretation or multiline expansion', () => {
  assert.equal(
    conversationSnippet({ ...msg(ID, 1, 'Hello\n  <script>'), direction: 'outgoing' }),
    'You: Hello <script>',
  );
  assert.ok(conversationSnippet(msg(ID, 1, 'x'.repeat(1000))).length <= 160);
});
test('read live state overrides a stale unread counter while names stay searchable', () => {
  const chat = state();
  chat.unread[OTHER] = 0;
  const saved = [{ subject: OTHER, lastAt: 1, count: 1, unread: 3 }];
  const rows = conversationRows(chat, saved, 'recent', 'beta#test');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].unread, 0);
});
