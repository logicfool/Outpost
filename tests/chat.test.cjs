const test = require('node:test');
const assert = require('node:assert/strict');
const { ID, OTHER, session, jwt, catalog, code } = require('./helpers.cjs');
const { RiotChat } = require('../.test-build/chat.js');
const { XmppXml, messageText, xmlEscape, parseJid } = require('../.test-build/xmppXml.js');
const { parseChatBootstrap } = require('../.test-build/chatBootstrap.js');
const { friendPresence } = require('../.test-build/chatPresence.js');
const open =
  '<stream:stream xmlns="jabber:client" xmlns:stream="http://etherx.jabber.org/streams" version="1.0">';
const config = {
  'chat.affinities': { ap: 'ap1.chat.si.riotgames.com' },
  'chat.affinity_domains': { ap: 'ap1.pvp.net' },
  'chat.port': 5223,
};
const bootstrap = () => ({
  subject: ID,
  host: 'ap1.chat.si.riotgames.com',
  domain: 'ap1.pvp.net',
  port: 5223,
  accessToken: 'fixture-access-token-not-real',
  pasToken: 'fixture-pas-token-not-real',
  entitlementsToken: 'fixture-entitlements-not-real',
  expiresAt: Date.now() + 3600000,
});
function harness(t) {
  let events,
    rejectWrite = false,
    closes = 0;
  const writes = [],
    states = [];
  const transport = (_, e) => {
    events = e;
    return {
      write: async (value) => {
        if (rejectWrite) throw Error();
        writes.push(value);
      },
      close: () => {
        closes++;
      },
    };
  };
  const chat = new RiotChat(transport, catalog(), (value) => states.push(value));
  t.after(() => chat.disconnect(true));
  const feed = (value) => events.data(Buffer.from(value));
  function start() {
    chat.start(bootstrap());
    events.secure();
    feed(
      open +
        '<stream:features><mechanisms xmlns="urn:ietf:params:xml:ns:xmpp-sasl"><mechanism>X-Riot-RSO-PAS</mechanism></mechanisms></stream:features>',
    );
    feed('<success xmlns="urn:ietf:params:xml:ns:xmpp-sasl"/>');
    feed(
      open + '<stream:features><bind xmlns="urn:ietf:params:xml:ns:xmpp-bind"/></stream:features>',
    );
    feed(
      `<iq id="outpost-bind" type="result"><bind xmlns="urn:ietf:params:xml:ns:xmpp-bind"><jid>${ID}@ap1.pvp.net/mobile</jid></bind></iq>`,
    );
    feed('<iq id="outpost-session" type="result"/>');
    feed(
      `<iq id="outpost-roster" type="result"><query xmlns="jabber:iq:riotgames:roster"><item jid="${OTHER}@ap1.pvp.net" subscription="both"><id name="Friend" tagline="TEST"/></item></query></iq>`,
    );
  }
  return {
    chat,
    writes,
    states,
    feed,
    start,
    get events() {
      return events;
    },
    get closes() {
      return closes;
    },
    failWrites() {
      rejectWrite = true;
    },
  };
}
test('chat bootstrap validates PAS identity, affinity, expiry, host and port', () => {
  const s = session(),
    pas = jwt({ sub: ID, affinity: 'ap', exp: Math.floor(Date.now() / 1000) + 3600 });
  const result = parseChatBootstrap(s, pas, config);
  assert.equal(result.host, 'ap1.chat.si.riotgames.com');
  assert.equal(result.domain, 'ap1.pvp.net');
  assert.equal(parseChatBootstrap(s, JSON.stringify(pas), config).pasToken, pas);
  assert.throws(
    () =>
      parseChatBootstrap(
        s,
        jwt({ sub: OTHER, affinity: 'ap', exp: Date.now() / 1000 + 3600 }),
        config,
      ),
    code('ACCOUNT_MISMATCH'),
  );
  assert.throws(
    () => parseChatBootstrap(s, pas, { ...config, 'chat.port': 5222 }),
    code('CHAT_CONFIG'),
  );
  assert.throws(
    () =>
      parseChatBootstrap(s, pas, {
        ...config,
        'chat.affinities': { ap: 'riotgames.com.attacker.test' },
      }),
    code('CHAT_CONFIG'),
  );
  assert.throws(
    () =>
      parseChatBootstrap(s, pas, { ...config, 'chat.affinity_domains': { ap: 'attacker.test' } }),
    code('CHAT_CONFIG'),
  );
  assert.throws(
    () => parseChatBootstrap(s, jwt({ sub: ID, affinity: 'ap', exp: 1 }), config),
    code('SESSION_EXPIRED'),
  );
});
test('XML decoder tolerates arbitrary UTF-8 and stanza boundaries', () => {
  const nodes = [],
    parser = new XmppXml(
      (n) => nodes.push(n),
      () => {},
    );
  for (const byte of Buffer.from(
    open + '<message><body>hello 🦊 &amp; नमस्ते</body></message><presence/>',
  ))
    parser.feed(Uint8Array.from([byte]));
  assert.equal(nodes.length, 2);
  assert.equal(nodes[0].children[0].text, 'hello 🦊 & नमस्ते');
});
test('stream restarts are safe even when coalesced in one network packet', () => {
  const nodes = [];
  let parser;
  parser = new XmppXml(
    (node) => {
      nodes.push(node);
      if (node.name === 'success') parser.reset();
    },
    () => {},
  );
  parser.feed(
    Buffer.from(
      open + '<success xmlns="urn:ietf:params:xml:ns:xmpp-sasl"/>' + open + '<presence/>',
    ),
  );
  assert.deepEqual(
    nodes.map((n) => n.name),
    ['success', 'presence'],
  );
});
test('XML entities cannot load external files or expand DTDs', () => {
  const p = new XmppXml(
    () => {},
    () => {},
  );
  assert.throws(
    () =>
      p.feed(
        Buffer.from('<!DOCTYPE stream [<!ENTITY secret SYSTEM "file:///etc/passwd">]>' + open),
      ),
    code('CHAT_XML'),
  );
});
test('XML without stream envelope is rejected', () =>
  assert.throws(
    () =>
      new XmppXml(
        () => {},
        () => {},
      ).feed(Buffer.from('<message/>')),
    code('CHAT_XML'),
  ));
test('oversized unfinished XML is bounded', () => {
  const p = new XmppXml(
    () => {},
    () => {},
  );
  p.feed(Buffer.from(open));
  assert.throws(() => p.feed(Buffer.from('<message a="' + 'x'.repeat(2100000))), code('CHAT_SIZE'));
});
test('excessive XML nesting is bounded', () => {
  const p = new XmppXml(
    () => {},
    () => {},
  );
  assert.throws(() => p.feed(Buffer.from(open + '<a>'.repeat(30))), code('CHAT_SIZE'));
});
test('JID validation and XML escaping block injected recipient tags', () => {
  assert.equal(parseJid(`${OTHER}@ap1.pvp.net/mobile`).subject, OTHER);
  assert.equal(parseJid(`${OTHER}@ap1.pvp.net/x\"/><message>`), undefined);
  assert.equal(xmlEscape('<&"'), '&lt;&amp;&quot;');
});
test('message validation rejects blanks, long messages and invalid Unicode', () => {
  assert.equal(messageText(' hello '), 'hello');
  for (const s of ['', ' ', 'x'.repeat(1001), '\u0000', '\ud800'])
    assert.throws(() => messageText(s), code('CHAT_MESSAGE'));
});
test('complete TLS/SASL/bind/session/roster handshake reaches ready', (t) => {
  const h = harness(t);
  h.start();
  assert.equal(h.chat.snapshot.status, 'ready');
  assert.equal(h.chat.snapshot.friends[0].name, 'Friend');
  assert.ok(h.writes.some((w) => w.includes('X-Riot-RSO-PAS')));
  assert.ok(h.writes.some((w) => w.includes('urn:riotgames:entitlements')));
});
test('credentials are not sent before secure transport and advertised SASL mechanism', (t) => {
  const h = harness(t);
  h.chat.start(bootstrap());
  assert.equal(h.writes.length, 0);
  h.events.secure();
  assert.equal(
    h.writes.some((w) => w.includes('fixture-access')),
    false,
  );
  h.feed(
    open +
      '<stream:features><mechanisms xmlns="urn:ietf:params:xml:ns:xmpp-sasl"><mechanism>PLAIN</mechanism></mechanisms></stream:features>',
  );
  assert.equal(h.chat.snapshot.status, 'error');
  assert.equal(
    h.writes.some((w) => w.includes('fixture-access')),
    false,
  );
});
test('wrong account bind is rejected', (t) => {
  const h = harness(t);
  h.chat.start(bootstrap());
  h.events.secure();
  h.feed(
    open +
      '<stream:features><mechanisms xmlns="urn:ietf:params:xml:ns:xmpp-sasl"><mechanism>X-Riot-RSO-PAS</mechanism></mechanisms></stream:features>',
  );
  h.feed('<success xmlns="urn:ietf:params:xml:ns:xmpp-sasl"/>');
  h.feed(
    open + '<stream:features><bind xmlns="urn:ietf:params:xml:ns:xmpp-bind"/></stream:features>',
  );
  h.feed(
    `<iq id="outpost-bind" type="result"><bind xmlns="urn:ietf:params:xml:ns:xmpp-bind"><jid>${OTHER}@ap1.pvp.net/mobile</jid></bind></iq>`,
  );
  assert.equal(h.chat.snapshot.status, 'error');
});
test('message sends are escaped, friend-scoped and explicitly marked sent', async (t) => {
  const h = harness(t);
  h.start();
  await h.chat.send(OTHER, 'hello <message> & world');
  assert.match(h.writes.at(-1), /hello &lt;message&gt; &amp; world/);
  assert.equal(h.chat.snapshot.messages[OTHER][0].state, 'sent');
  await assert.rejects(h.chat.send(ID, 'No'), code('CHAT_OFFLINE'));
  await assert.rejects(h.chat.send(OTHER, 'Too fast'), code('CHAT_COOLDOWN'));
});
test('failed write is not retried and remains unconfirmed', async (t) => {
  const h = harness(t);
  h.start();
  h.failWrites();
  await assert.rejects(h.chat.send(OTHER, 'hello'), code('CHAT_SEND'));
  assert.equal(h.chat.snapshot.messages[OTHER][0].state, 'failed');
});
test('inbound messages are deduplicated and unread count is cleared on viewing', (t) => {
  const h = harness(t);
  h.start();
  const message = `<message from="${OTHER}@ap1.pvp.net/mobile" type="chat" id="m1"><body>hello</body></message>`;
  h.feed(message);
  h.feed(message);
  assert.equal(h.chat.snapshot.messages[OTHER].length, 1);
  assert.equal(h.chat.snapshot.unread[OTHER], 1);
  h.chat.markRead(OTHER);
  assert.equal(h.chat.snapshot.unread[OTHER], 0);
  h.feed(message.replace('m1', 'm2'));
  assert.equal(h.chat.snapshot.unread[OTHER], 0);
});
test('unsolicited messages and foreign-namespace message stanzas are ignored', (t) => {
  const h = harness(t);
  h.start();
  h.feed(`<message from="${ID}@ap1.pvp.net" type="chat"><body>no</body></message>`);
  h.feed(
    `<message xmlns="urn:invalid" from="${OTHER}@ap1.pvp.net" type="chat"><body>no</body></message>`,
  );
  assert.deepEqual(h.chat.snapshot.messages, {});
});
test('multi-resource presence retains desktop online when mobile disconnects', (t) => {
  const h = harness(t);
  h.start();
  const payload = Buffer.from(
    JSON.stringify({ isValid: true, sessionLoopState: 'INGAME', competitiveTier: 8 }),
  ).toString('base64');
  h.feed(
    `<presence from="${OTHER}@ap1.pvp.net/desktop"><games><valorant><st>chat</st><p>${payload}</p></valorant></games></presence>`,
  );
  h.feed(`<presence from="${OTHER}@ap1.pvp.net/mobile"/>`);
  h.feed(`<presence from="${OTHER}@ap1.pvp.net/mobile" type="unavailable"/>`);
  assert.equal(h.chat.snapshot.friends[0].presence, 'in_game');
  h.feed(`<presence from="${OTHER}@ap1.pvp.net/desktop" type="unavailable"/>`);
  assert.equal(h.chat.snapshot.friends[0].presence, 'offline');
});
test('recent VALORANT menu presence supersedes stale in-game resource', (t) => {
  const h = harness(t);
  h.start();
  for (const [resource, loop, stamp] of [
    ['old', 'INGAME', 1000],
    ['new', 'MENUS', 2000],
  ]) {
    const payload = Buffer.from(JSON.stringify({ isValid: true, sessionLoopState: loop })).toString(
      'base64',
    );
    h.feed(
      `<presence from="${OTHER}@ap1.pvp.net/${resource}"><games><valorant><st>chat</st><s.t>${stamp}</s.t><p>${payload}</p></valorant></games></presence>`,
    );
  }
  assert.equal(h.chat.snapshot.friends[0].presence, 'online');
});
test('roster removal disables further messaging', async (t) => {
  const h = harness(t);
  h.start();
  h.feed(
    `<iq type="set" id="remove"><query xmlns="jabber:iq:riotgames:roster"><item jid="${OTHER}@ap1.pvp.net" subscription="remove"/></query></iq>`,
  );
  assert.equal(h.chat.snapshot.friends.length, 0);
  await assert.rejects(h.chat.send(OTHER, 'Hello'), code('CHAT_OFFLINE'));
});
test('stale socket events after disconnect cannot resurrect the account', (t) => {
  const h = harness(t);
  h.start();
  const stale = h.events;
  h.chat.disconnect(true);
  stale.data(Buffer.from('<presence/>'));
  stale.error();
  assert.equal(h.chat.snapshot.status, 'disconnected');
  assert.equal(h.chat.snapshot.friends.length, 0);
  assert.deepEqual(h.chat.snapshot.messages, {});
});

function ownPresence(resource, loop = 'INGAME', extra = {}) {
  const data = {
    isValid: true,
    matchPresenceData: {
      sessionLoopState: loop,
      queueId: 'competitive',
      matchMap: 'ascent',
      ...extra,
    },
    partyPresenceData: {
      isPartyOwner: true,
      partyOwnerMatchScoreAllyTeam: 7,
      partyOwnerMatchScoreEnemyTeam: 5,
    },
  };
  return `<presence from="${ID}@ap1.pvp.net/${resource}"><games><valorant><st>chat</st><p>${Buffer.from(JSON.stringify(data)).toString('base64')}</p></valorant></games></presence>`;
}
test('own account presence supplies round progress without entering the friend roster', (t) => {
  const h = harness(t);
  h.start();
  h.feed(ownPresence('desktop'));
  assert.equal(h.chat.snapshot.selfPresence.subject, ID);
  assert.equal(h.chat.snapshot.selfPresence.progress.allyScore, 7);
  assert.equal(h.chat.snapshot.selfPresence.progress.roundNumber, 13);
  assert.equal(h.chat.snapshot.friends.length, 1);
  assert.equal(h.chat.snapshot.friends[0].subject, OTHER);
});
test('a phone resource cannot replace active own VALORANT presence', (t) => {
  const h = harness(t);
  h.start();
  h.feed(ownPresence('desktop'));
  h.feed(`<presence from="${ID}@ap1.pvp.net/mobile"/>`);
  assert.equal(h.chat.snapshot.selfPresence.presence, 'in_game');
  assert.equal(h.chat.snapshot.selfPresence.progress.enemyScore, 5);
});
test('own match progress clears on menus and disconnect', (t) => {
  const h = harness(t);
  h.start();
  h.feed(ownPresence('desktop'));
  h.feed(ownPresence('desktop', 'MENUS'));
  assert.equal(h.chat.snapshot.selfPresence.progress, undefined);
  h.feed(ownPresence('desktop'));
  h.chat.disconnect();
  assert.equal(h.chat.snapshot.selfPresence, undefined);
});
test('a forged own presence from a different domain is ignored', (t) => {
  const h = harness(t);
  h.start();
  h.feed(ownPresence('desktop').replace('@ap1.pvp.net/', '@other.pvp.net/'));
  assert.equal(h.chat.snapshot.selfPresence, undefined);
});

const REQUEST_ID = '77777777-7777-4777-8777-777777777777';
const pendingPlayer = { subject: REQUEST_ID, name: 'New friend', tag: 'TEST' };
const rosterItem = (id, subscription, name = 'New friend') =>
  `<item jid="${id}@ap1.pvp.net" puuid="${id}" subscription="${subscription}"><id name="${name}" tagline="TEST"/></item>`;
const pushRoster = (h, item, from = '') =>
  h.feed(
    `<iq type="set" id="roster-push"${from ? ` from="${from}"` : ''}><query xmlns="jabber:iq:riotgames:roster">${item}</query></iq>`,
  );
test('incoming and outgoing requests are separate from confirmed messaging friends', (t) => {
  const h = harness(t);
  h.start();
  pushRoster(h, rosterItem(REQUEST_ID, 'pending_in'));
  assert.equal(h.chat.snapshot.friends.length, 1);
  assert.equal(h.chat.snapshot.friendRequests[0].direction, 'incoming');
  pushRoster(h, rosterItem(REQUEST_ID, 'pending_out'));
  assert.equal(h.chat.snapshot.friendRequests[0].direction, 'outgoing');
  assert.equal(h.chat.snapshot.friendRequests.length, 1);
});
test('accept sends the Riot pending_out mutation once and waits for a confirmed friendship', async (t) => {
  const h = harness(t);
  h.start();
  pushRoster(h, rosterItem(REQUEST_ID, 'pending_in'));
  const work = h.chat.changeFriend('accept', pendingPlayer);
  const sent = h.writes.at(-1);
  assert.match(sent, /subscription="pending_out"/);
  assert.match(sent, new RegExp(`puuid="${REQUEST_ID}"`));
  assert.equal(
    h.chat.snapshot.friends.some((f) => f.subject === REQUEST_ID),
    false,
  );
  pushRoster(h, rosterItem(REQUEST_ID, 'both'));
  await work;
  assert.equal(
    h.chat.snapshot.friends.some((f) => f.subject === REQUEST_ID),
    true,
  );
  assert.equal(h.chat.snapshot.friendRequests.length, 0);
});
test('decline targets only a known incoming request and leaves existing friends untouched', async (t) => {
  const h = harness(t);
  h.start();
  pushRoster(h, rosterItem(REQUEST_ID, 'pending_in'));
  const work = h.chat.changeFriend('decline', pendingPlayer);
  assert.match(h.writes.at(-1), /subscription="remove"/);
  pushRoster(h, rosterItem(REQUEST_ID, 'remove'));
  await work;
  assert.equal(h.chat.snapshot.friends.length, 1);
  assert.equal(h.chat.snapshot.friendRequests.length, 0);
  const before = h.writes.length;
  assert.throws(
    () => h.chat.changeFriend('decline', { subject: OTHER, name: 'Friend', tag: 'TEST' }),
    /no longer available|already friends/i,
  );
  assert.equal(h.writes.length, before);
});
test('adding from a profile uses a validated UUID and an acknowledged roster refresh', async (t) => {
  const h = harness(t);
  h.start();
  const work = h.chat.changeFriend('add', pendingPlayer),
    sent = h.writes.at(-1),
    id = /id="([^"]+)"/.exec(sent)[1];
  h.feed(`<iq type="result" id="${id}"/>`);
  const query = /id="([^"]+)"/.exec(h.writes.at(-1))[1];
  assert.equal(h.chat.snapshot.friendActions[REQUEST_ID].state, 'awaiting');
  h.feed(
    `<iq type="result" id="${query}"><query xmlns="jabber:iq:riotgames:roster">${rosterItem(OTHER, 'both', 'Friend')}${rosterItem(REQUEST_ID, 'pending_out')}</query></iq>`,
  );
  await work;
  assert.equal(h.chat.snapshot.friendRequests[0].direction, 'outgoing');
  assert.equal(h.chat.snapshot.friendActions[REQUEST_ID], undefined);
});
test('foreign friend acknowledgements and roster pushes cannot confirm a mutation', async (t) => {
  const h = harness(t);
  h.start();
  const work = h.chat.changeFriend('add', pendingPlayer),
    id = /id="([^"]+)"/.exec(h.writes.at(-1))[1];
  h.feed(`<iq from="${OTHER}@ap1.pvp.net" type="result" id="${id}"/>`);
  pushRoster(h, rosterItem(REQUEST_ID, 'both'), `${OTHER}@ap1.pvp.net`);
  assert.equal(h.chat.snapshot.friendActions[REQUEST_ID].state, 'sending');
  assert.equal(h.chat.snapshot.friends.length, 1);
  pushRoster(h, rosterItem(REQUEST_ID, 'pending_out'));
  await work;
});
test('self, hidden, forged and duplicate request attempts never issue an extra mutation', async (t) => {
  const h = harness(t);
  h.start();
  for (const p of [
    { ...pendingPlayer, subject: ID },
    { ...pendingPlayer, hidden: true },
    { ...pendingPlayer, subject: 'bad-id' },
  ])
    assert.throws(() => h.chat.changeFriend('add', p));
  const work = h.chat.changeFriend('add', pendingPlayer),
    count = h.writes.length;
  assert.throws(() => h.chat.changeFriend('add', pendingPlayer), /already being processed/i);
  assert.equal(h.writes.length, count);
  pushRoster(h, rosterItem(REQUEST_ID, 'pending_out'));
  await work;
  assert.throws(() => h.chat.changeFriend('add', pendingPlayer), /already been sent/i);
});
test('friend-operation rejection does not disconnect working chat', async (t) => {
  const h = harness(t);
  h.start();
  const work = h.chat.changeFriend('add', pendingPlayer),
    id = /id="([^"]+)"/.exec(h.writes.at(-1))[1];
  const rejected = assert.rejects(work, (e) => e.code === 'FRIEND_REJECTED');
  h.feed(
    `<iq id="${id}" type="error"><error><forbidden xmlns="urn:ietf:params:xml:ns:xmpp-stanzas"/></error></iq>`,
  );
  await rejected;
  assert.equal(h.chat.snapshot.status, 'ready');
  assert.equal(h.chat.snapshot.friendActions[REQUEST_ID].state, 'error');
  assert.throws(
    () => h.chat.changeFriend('add', pendingPlayer),
    (e) => e.code === 'FRIEND_COOLDOWN',
  );
});
test('an unconfirmed friend write is never automatically repeated after disconnect', async (t) => {
  const h = harness(t);
  h.start();
  const work = h.chat.changeFriend('add', pendingPlayer);
  const rejection = assert.rejects(work, (e) => e.code === 'FRIEND_UNCONFIRMED');
  h.chat.disconnect();
  await rejection;
  const before = h.writes.filter((s) => s.includes('subscription="pending_out"')).length;
  h.start();
  assert.equal(h.writes.filter((s) => s.includes('subscription="pending_out"')).length, before);
});
test('friend action times out without treating absence of a reply as success', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness(t);
  h.start();
  const work = h.chat.changeFriend('add', pendingPlayer),
    rejected = assert.rejects(work, (e) => e.code === 'FRIEND_UNCONFIRMED');
  t.mock.timers.tick(15001);
  await rejected;
  assert.equal(h.chat.snapshot.status, 'ready');
  assert.equal(h.chat.snapshot.friendRequests.length, 0);
  assert.equal(h.writes.filter((s) => s.includes('subscription="pending_out"')).length, 1);
});
test('a mismatched roster puuid cannot redirect an incoming request to someone else', (t) => {
  const h = harness(t);
  h.start();
  pushRoster(
    h,
    rosterItem(REQUEST_ID, 'pending_in').replace(`puuid="${REQUEST_ID}"`, `puuid="${OTHER}"`),
  );
  assert.equal(h.chat.snapshot.friendRequests.length, 0);
});
