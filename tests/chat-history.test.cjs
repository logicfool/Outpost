const test = require('node:test'),
  assert = require('node:assert/strict');
const { ID, OTHER, catalog, code } = require('./helpers.cjs');
const { XmppXml } = require('../.test-build/xmppXml.js');
const { RiotChat } = require('../.test-build/chat.js');
const {
  parseArchiveResult,
  parseCarbon,
  chatTimestamp,
  ARCHIVE_NS,
  CARBONS_NS,
  FORWARD_NS,
} = require('../.test-build/messageHistory.js');
const open =
  '<stream:stream xmlns="jabber:client" xmlns:stream="http://etherx.jabber.org/streams">';
const own = ID + '@ap1.pvp.net',
  peer = OTHER + '@ap1.pvp.net';
const friend = { subject: OTHER, jid: peer, name: 'Friend', tag: 'TEST', presence: 'online' };
const stamp = '2026-09-10 12:34:56.789';
function parse(s) {
  let n;
  new XmppXml(
    (v) => {
      n = v;
    },
    () => {},
  ).feed(Buffer.from(open + s));
  return n;
}
const msg = (attrs, body = 'hello') =>
  `<message ${attrs} stamp="${stamp}" id="archive-fixture" type="chat"><body>${body}</body></message>`;
test('Riot custom UTC and ISO timestamps agree', () => {
  assert.equal(chatTimestamp(stamp), Date.parse('2026-09-10T12:34:56.789Z'));
  assert.equal(chatTimestamp('invalid'), undefined);
});
test('direct IQ archive messages normalize incoming and outgoing correctly', () => {
  const n = parse(
    `<iq type="result">${msg(`from="${peer}" to="${own}"`)}${msg(`from="${own}" to="${peer}"`)}</iq>`,
  );
  const result = parseArchiveResult(n, own, friend);
  assert.equal(result.length, 2);
  assert.deepEqual(new Set(result.map((m) => m.direction)), new Set(['incoming', 'outgoing']));
  assert.ok(result.every((m) => m.serverStored));
});
test('namespaced query archive messages and exact bodies are preserved', () => {
  const n = parse(
    `<iq type="result"><query xmlns="${ARCHIVE_NS}">${msg(`from="${peer}"`, 'Hello &amp; नमस्ते 🦊')}</query></iq>`,
  );
  assert.equal(parseArchiveResult(n, own, friend)[0].body, 'Hello & नमस्ते 🦊');
});
test('archive messages cannot import another account or peer conversation', () => {
  const foreign = '33333333-3333-4333-8333-333333333333@ap1.pvp.net';
  assert.throws(
    () =>
      parseArchiveResult(parse(`<iq>${msg(`from="${foreign}" to="${own}"`)}</iq>`), own, friend),
    code('CHAT_HISTORY_FORMAT'),
  );
  assert.throws(
    () =>
      parseArchiveResult(parse(`<iq>${msg(`from="${peer}" to="${foreign}"`)}</iq>`), own, friend),
    code('CHAT_HISTORY_FORMAT'),
  );
});
test('nonstandard archive namespaces and missing timestamps fail explicitly', () => {
  assert.throws(
    () => parseArchiveResult(parse('<iq><query xmlns="unexpected"/></iq>'), own, friend),
    code('CHAT_HISTORY_FORMAT'),
  );
  assert.throws(
    () =>
      parseArchiveResult(
        parse(`<iq><message from="${peer}"><body>x</body></message></iq>`),
        own,
        friend,
      ),
    code('CHAT_HISTORY_FORMAT'),
  );
});
test('archive repeated rows deduplicate by peer/direction/stanza id', () => {
  const m = msg(`from="${peer}"`);
  assert.equal(parseArchiveResult(parse(`<iq>${m}${m}</iq>`), own, friend).length, 1);
});
const carbon = (from, type = 'sent') =>
  parse(
    `<message from="${from}"><${type} xmlns="${CARBONS_NS}"><forwarded xmlns="${FORWARD_NS}">${msg(type === 'sent' ? `to="${peer}"` : `from="${peer}" to="${own}"`)}</forwarded></${type}></message>`,
  );
test('Riot-client outgoing copies are accepted only from the authenticated account', () => {
  assert.equal(parseCarbon(carbon(own + '/desktop'), own, [friend]).direction, 'outgoing');
  assert.equal(parseCarbon(carbon(peer), own, [friend]), undefined);
  assert.equal(parseCarbon(carbon(own), own, []), undefined);
});
test('incoming server copies retain direction and never appear as a second outgoing send', () => {
  assert.equal(parseCarbon(carbon(own, 'received'), own, [friend]).direction, 'incoming');
});
function connected(t, hooks = {}) {
  const writes = [];
  let events;
  const chat = new RiotChat(
    (_, e) => {
      events = e;
      return {
        write: async (s) => {
          writes.push(s);
        },
        close() {},
      };
    },
    catalog(),
    () => {},
    () => {},
    Date.now,
    hooks,
  );
  const feed = (s) => events.data(Buffer.from(s));
  t.after(() => chat.disconnect(true));
  chat.start({
    subject: ID,
    host: 'ap1.chat.si.riotgames.com',
    domain: 'ap1.pvp.net',
    port: 5223,
    accessToken: 'fixture-not-real',
    pasToken: 'fixture-not-real',
    entitlementsToken: 'fixture-not-real',
    expiresAt: Date.now() + 3600000,
  });
  events.secure();
  feed(
    open +
      '<stream:features><mechanisms xmlns="urn:ietf:params:xml:ns:xmpp-sasl"><mechanism>X-Riot-RSO-PAS</mechanism></mechanisms></stream:features>',
  );
  feed('<success xmlns="urn:ietf:params:xml:ns:xmpp-sasl"/>' + open + '<stream:features/>');
  feed(
    `<iq id="outpost-bind" type="result"><bind xmlns="urn:ietf:params:xml:ns:xmpp-bind"><jid>${own}/mobile</jid></bind></iq>`,
  );
  feed('<iq id="outpost-session" type="result"/>');
  feed(
    `<iq id="outpost-roster" type="result"><query xmlns="jabber:iq:riotgames:roster"><item jid="${peer}" subscription="both"><id name="Friend"/></item></query></iq>`,
  );
  return { chat, writes, feed };
}
const lastId = (h) => h.writes.at(-1).match(/id="([^"]+)"/)[1];
test('history request is roster-scoped, correlated and saved before completion', async (t) => {
  const saved = [],
    h = connected(t, {
      saveMessage: async (m) => {
        saved.push(m);
      },
    }),
    pending = h.chat.requestHistory(OTHER),
    id = lastId(h);
  assert.ok(h.writes.at(-1).includes(`<with>${peer}</with>`));
  h.feed(`<iq type="result" id="${id}">${msg(`from="${peer}" to="${own}"`)}</iq>`);
  assert.equal(await pending, 1);
  assert.equal(saved.length, 1);
  assert.equal(h.chat.snapshot.archive[OTHER].status, 'ready');
  assert.equal(h.chat.snapshot.unread[OTHER], undefined);
});
test('denied Riot history leaves the live connection and local messages intact', async (t) => {
  const h = connected(t);
  await h.chat.send(OTHER, 'hello');
  const pending = h.chat.requestHistory(OTHER),
    reject = assert.rejects(pending, code('CHAT_HISTORY_UNAVAILABLE')),
    id = lastId(h);
  h.feed(`<iq type="error" id="${id}"/>`);
  await reject;
  assert.equal(h.chat.snapshot.status, 'ready');
  assert.equal(h.chat.snapshot.messages[OTHER].length, 1);
});
test('peer-forged history IQ does not satisfy the outstanding server request', async (t) => {
  const h = connected(t),
    pending = h.chat.requestHistory(OTHER),
    id = lastId(h);
  h.feed(`<iq type="result" id="${id}" from="${peer}">${msg(`from="${peer}"`)}</iq>`);
  assert.equal(h.chat.snapshot.archive[OTHER].status, 'loading');
  h.feed(`<iq type="result" id="${id}"/>`);
  assert.equal(await pending, 0);
});
test('message is durably recorded before socket write and a store failure prevents sending', async (t) => {
  const h = connected(t, {
    saveMessage: async () => {
      throw Error('disk full');
    },
  });
  await assert.rejects(h.chat.send(OTHER, 'hello'), code('CHAT_SEND'));
  assert.equal(
    h.writes.some((s) => s.startsWith('<message')),
    false,
  );
  assert.equal(h.chat.snapshot.messages[OTHER][0].state, 'failed');
});
test('disconnect during durable outbox wait does not write on a changed connection', async (t) => {
  let done;
  const hold = new Promise((resolve) => {
      done = resolve;
    }),
    h = connected(t, {
      saveMessage: async (m) => {
        if (m.state === 'sending') await hold;
      },
    });
  const send = h.chat.send(OTHER, 'hello'),
    reject = assert.rejects(send, code('CHAT_SEND'));
  h.chat.disconnect();
  done();
  await reject;
  assert.equal(
    h.writes.some((s) => s.startsWith('<message')),
    false,
  );
});
