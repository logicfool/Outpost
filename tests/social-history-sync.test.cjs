const test = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm'),
  ts = require('typescript');
const React = require('react'),
  Renderer = require('react-test-renderer'),
  { act } = Renderer;
global.IS_REACT_ACT_ENVIRONMENT = true;
const { RosterHistorySync } = require('../.test-build/rosterHistorySync.js'),
  { AppError } = require('../.test-build/validation.js');
const { conversationRows } = require('../.test-build/conversations.js');
const { ID, OTHER, catalog } = require('./helpers.cjs');
const peer = (i) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, '0')}`;
async function harness(t, platform = 'android') {
  let model,
    tree,
    activeId = ID,
    hold;
  const calls = [],
    stores = new Map(),
    events = new Map();
  let inFlight = 0,
    maxInFlight = 0;
  const friends = Array.from({ length: 15 }, (_, i) => ({
    subject: peer(i),
    jid: peer(i) + '@jp1.pvp.net',
    name: 'Fixture ' + i,
    tag: 'TEST',
    presence: 'offline',
  }));
  function store(id) {
    if (stores.has(id)) return stores.get(id);
    const roster = new Map(),
      messages = new Map();
    const result = {
      async saveFriends(rows) {
        for (const f of rows) roster.set(f.subject, f);
      },
      async save(m) {
        messages.set(m.subject + ':' + m.id, m);
      },
      async markRead() {},
      async messages(subject) {
        return { messages: [...messages.values()].filter((m) => m.subject === subject) };
      },
      async conversations() {
        return [...roster.values()].map((friend) => {
          const rows = [...messages.values()].filter((m) => m.subject === friend.subject);
          return {
            subject: friend.subject,
            friend,
            count: rows.length,
            unread: 0,
            lastAt: rows.at(-1)?.at ?? 0,
            lastMessage: rows.at(-1),
          };
        });
      },
    };
    stores.set(id, result);
    return result;
  }
  class Chat {
    constructor(_t, _c, emit, onFriends, _now, hooks) {
      this.emit = emit;
      this.onFriends = onFriends;
      this.hooks = hooks;
    }
    restoreMessages() {}
    markRead() {}
    hydrateMessages() {}
    async flushPersistence() {}
    start(config) {
      this.id = config.subject;
      this.state = { status: 'ready', friends, messages: {}, unread: {} };
      this.onFriends(friends);
      this.emit(this.state);
    }
    disconnect() {
      if (this.state) this.emit({ ...this.state, status: 'disconnected' });
    }
    async requestHistory(subject, options = {}) {
      const signal = options.signal;
      calls.push({ id: this.id, subject });
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        if (hold?.subject === subject)
          await new Promise((resolve, reject) => {
            hold.enter();
            hold.release = resolve;
            signal?.addEventListener(
              'abort',
              () => reject(new AppError('CHAT_HISTORY_CANCELLED', 'Stopped')),
              { once: true },
            );
          });
        if (signal?.aborted) throw new AppError('CHAT_HISTORY_CANCELLED', 'Stopped');
        const index = friends.findIndex((f) => f.subject === subject),
          rows =
            index % 3 === 0
              ? [
                  {
                    subject,
                    id: 'archive-' + index,
                    body: 'Retained fixture ' + index,
                    at: 1700000000000 + index,
                    direction: 'incoming',
                    state: 'received',
                    source: 'riot-archive',
                    serverStored: true,
                  },
                ]
              : [];
        for (const row of rows) await this.hooks.saveMessage(row);
        return rows.length;
      } finally {
        inFlight--;
      }
    }
  }
  const load = (name) => {
    if (name === 'react') return React;
    if (name === 'react-native')
      return {
        Platform: { OS: platform },
        AppState: {
          currentState: 'active',
          addEventListener: (name, fn) => {
            events.set(name, fn);
            return { remove: () => events.delete(name) };
          },
        },
      };
    if (name === '../core/chat') return { RiotChat: Chat };
    if (name === '../core/rosterHistorySync')
      return {
        ...require('../.test-build/rosterHistorySync.js'),
        RosterHistorySync: class extends RosterHistorySync {
          constructor(publish) {
            super(publish, Date.now, async () => {
              await Promise.resolve();
            });
          }
        },
      };
    if (name === '../platform/runtime')
      return {
        getRuntime: async () => ({
          client: async (id) => ({
            scope: { remember() {} },
            chatBootstrap: async () => ({ subject: id }),
          }),
        }),
      };
    if (name === '../platform/chatStorage') return { openChatStorage: async (id) => store(id) };
    if (name === '../platform/demoChatStorage') return { demoChatStorage: store('demo') };
    if (name === '../platform/notifications')
      return { notifyChat: async () => assert.fail('History imports must not notify') };
    if (name === '../platform/secure') return { randomHex: () => 'fixture' };
    if (name === '../platform/chatTransport')
      return { chatTransport: () => assert.fail('No network in hook fixture') };
    if (name.startsWith('../core/'))
      return require(path.join(__dirname, '../.test-build', name.slice(8) + '.js'));
    throw Error(name);
  };
  const m = { exports: {} },
    source = ts.transpileModule(
      fs.readFileSync(path.join(__dirname, '../src/state/useSocial.ts'), 'utf8'),
      { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
    ).outputText;
  vm.runInThisContext('(function(require,module,exports){' + source + '\n})')(load, m, m.exports);
  function Probe({ id }) {
    model = m.exports.useSocial(
      { puuid: id, gameName: 'Fixture', tagLine: 'TEST', demo: false },
      catalog(),
    );
    return null;
  }
  await act(async () => {
    tree = Renderer.create(React.createElement(Probe, { id: ID }));
  });
  await act(async () => {
    await model.connectChat();
  });
  t.after(async () => {
    await act(async () => tree.unmount());
  });
  return {
    get model() {
      return model;
    },
    calls,
    get maxInFlight() {
      return maxInFlight;
    },
    store,
    async sync() {
      let result;
      await act(async () => {
        result = await model.syncSavedChatHistory();
      });
      return result;
    },
    async start() {
      let task;
      await act(async () => {
        task = model.syncSavedChatHistory();
        for (let i = 0; i < 10; i++) await Promise.resolve();
      });
      return { task };
    },
    block(index) {
      let enter;
      const started = new Promise((r) => (enter = r));
      hold = { subject: peer(index), enter };
      return {
        started,
        release: () => {
          hold.release?.();
          hold = undefined;
        },
      };
    },
    async cancel() {
      await act(async () => {
        model.cancelChatHistorySync();
      });
    },
    async switch(id) {
      await act(async () => {
        activeId = id;
        tree.update(React.createElement(Probe, { id }));
      });
      await act(async () => {
        await model.connectChat();
      });
    },
    async event(name, value) {
      await act(async () => {
        events.get(name)?.(value);
      });
    },
  };
}
for (const platform of ['android', 'ios'])
  test(
    platform +
      ': fresh-account manual sync discovers all friend conversations without opening them',
    async (t) => {
      const h = await harness(t, platform);
      assert.equal(conversationRows(h.model.chat, h.model.savedConversations, 'recent').length, 0);
      const result = await h.sync();
      assert.equal(result.checked, 15);
      assert.equal(result.status, 'complete');
      assert.equal(h.calls.length, 15);
      assert.equal(h.maxInFlight, 1);
      const recent = conversationRows(h.model.chat, h.model.savedConversations, 'recent');
      assert.equal(recent.length, 5);
      assert.equal(recent[0].lastMessage.body, 'Retained fixture 12');
      assert.ok(recent.every((c) => c.unread === 0));
    },
  );
test('hook-level cancellation keeps imported peers and resuming scans unvisited friends', async (t) => {
  const h = await harness(t),
    blocked = h.block(3),
    run = await h.start();
  await blocked.started;
  await h.cancel();
  await act(async () => {
    await run.task;
  });
  assert.equal(h.model.chatHistorySync.status, 'cancelled');
  assert.equal(h.model.chatHistorySync.checked, 3);
  assert.equal(h.model.savedConversations.filter((c) => c.count).length, 1);
  blocked.release();
  await h.sync();
  assert.equal(h.model.chatHistorySync.checked, 15);
  assert.equal(h.calls.filter((c) => c.subject === peer(0)).length, 1);
});
test('switching accounts stops the old scan and cannot copy progress or messages into the new one', async (t) => {
  const h = await harness(t),
    blocked = h.block(1),
    run = await h.start();
  await blocked.started;
  await h.switch(OTHER);
  await act(async () => {
    await run.task;
  });
  blocked.release();
  assert.equal(h.model.chatHistorySync.status, 'idle');
  assert.equal(h.model.savedConversations.filter((c) => c.count).length, 0);
  await h.sync();
  assert.equal(h.calls.filter((c) => c.id === ID).length, 2);
  assert.equal(h.calls.filter((c) => c.id === OTHER).length, 15);
  assert.equal(h.model.chatHistorySync.checked, 15);
});
test('Android focus loss pauses a scan without disconnecting chat and resume continues safely', async (t) => {
  const h = await harness(t),
    blocked = h.block(1),
    run = await h.start();
  await blocked.started;
  await h.event('blur');
  await act(async () => {
    await run.task;
  });
  assert.equal(h.model.chatHistorySync.status, 'paused');
  assert.equal(h.model.chat.status, 'ready');
  blocked.release();
  await h.event('focus');
  await h.sync();
  assert.equal(h.model.chatHistorySync.checked, 15);
});
test('opening a conversation during bulk sync does not start an automatic competing request', async (t) => {
  const h = await harness(t),
    blocked = h.block(0),
    run = await h.start();
  await blocked.started;
  await act(async () => {
    await h.model.autoSyncChatHistory(peer(2));
  });
  assert.equal(h.calls.length, 1);
  await h.cancel();
  await act(async () => {
    await run.task;
  });
  blocked.release();
});
