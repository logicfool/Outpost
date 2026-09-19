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
async function harness(t, platform = 'android', backgroundNative = false) {
  let model,
    tree,
    activeId = ID,
    hold;
  const calls = [],
    stores = new Map(),
    events = new Map(),
    reads = [];
  let inFlight = 0,
    maxInFlight = 0,
    leaseActive = false,
    nativeStop;
  const leases = [];
  const app = {
    currentState: 'active',
    addEventListener: (name, fn) => {
      events.set(name, fn);
      return { remove: () => events.delete(name) };
    },
  };
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
      async markRead(subject) {
        reads.push({ id, subject });
      },
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
    if (name === 'react-native') return { Platform: { OS: platform }, AppState: app };
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
    if (name === '../platform/historySyncBackground')
      return {
        startHistoryBackground: async (guard, stop) => {
          guard();
          nativeStop = stop;
          leaseActive = backgroundNative;
          const lease = {
            supported: backgroundNative,
            active: () => leaseActive,
            update: (p) => leases.push(p.status),
            check: async () => {
              if (!leaseActive) throw new AppError('SYNC_STOPPED', 'Stopped');
            },
            finish: async () => {
              leaseActive = false;
            },
          };
          return lease;
        },
      };
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
    reads,
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
    get leaseActive() {
      return leaseActive;
    },
    async notificationStop() {
      await act(async () => {
        leaseActive = false;
        nativeStop?.('Sync stopped from the notification.');
      });
    },
    async event(name, value, wait = 550) {
      await act(async () => {
        if (name === 'change') app.currentState = value;
        events.get(name)?.(value);
        await new Promise((r) => setTimeout(r, wait));
      });
    },
    async wait() {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 600));
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
test('Android Modal window blur and focus do not pause the account-wide scan', async (t) => {
  const h = await harness(t),
    blocked = h.block(1),
    run = await h.start();
  await blocked.started;
  await h.event('blur');
  assert.equal(h.model.chatHistorySync.status, 'running');
  assert.equal(h.model.chat.status, 'ready');
  await h.event('focus');
  blocked.release();
  await act(async () => {
    await run.task;
  });
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
test('Android with an active native service continues syncing across real background changes', async (t) => {
  const h = await harness(t, 'android', true),
    blocked = h.block(2),
    run = await h.start();
  await blocked.started;
  await h.event('change', 'background');
  assert.equal(h.model.chatHistorySync.status, 'running');
  assert.equal(h.model.chat.status, 'ready');
  assert.equal(h.leaseActive, true);
  blocked.release();
  await act(async () => {
    await run.task;
  });
  assert.equal(h.model.chatHistorySync.checked, 15);
  assert.equal(h.leaseActive, false);
});
test('notification Stop aborts the pending request and keeps imported messages', async (t) => {
  const h = await harness(t, 'android', true),
    blocked = h.block(3),
    run = await h.start();
  await blocked.started;
  await h.notificationStop();
  await act(async () => {
    await run.task;
  });
  assert.equal(h.model.chatHistorySync.status, 'paused');
  assert.equal(h.calls.length, 4);
  assert.equal(h.model.savedConversations.filter((c) => c.count).length, 1);
  blocked.release();
});
test('iOS inactive transitions do not pause an in-app scan', async (t) => {
  const h = await harness(t, 'ios'),
    blocked = h.block(1),
    run = await h.start();
  await blocked.started;
  await h.event('change', 'inactive');
  assert.equal(h.model.chatHistorySync.status, 'running');
  await h.event('change', 'active');
  blocked.release();
  await act(async () => {
    await run.task;
  });
  assert.equal(h.model.chatHistorySync.checked, 15);
});
test('foreground-only fallback pauses on real background and resumes on return', async (t) => {
  const h = await harness(t, 'ios'),
    blocked = h.block(1),
    run = await h.start();
  await blocked.started;
  await h.event('change', 'background');
  await act(async () => {
    await run.task;
  });
  assert.equal(h.model.chatHistorySync.status, 'paused');
  assert.equal(h.model.chat.status, 'disconnected');
  blocked.release();
  await h.event('change', 'active');
  assert.equal(h.model.chatHistorySync.status, 'complete');
  assert.equal(h.model.chatHistorySync.checked, 15);
});
test('foreground fallback remembers resume intent when a reply arrives during background debounce', async (t) => {
  const h = await harness(t, 'ios'),
    blocked = h.block(1),
    run = await h.start();
  await blocked.started;
  await h.event('change', 'background', 0);
  blocked.release();
  await act(async () => {
    await run.task;
  });
  assert.equal(h.model.chatHistorySync.status, 'paused');
  await h.wait();
  await h.event('change', 'active');
  assert.equal(h.model.chatHistorySync.status, 'complete');
  assert.equal(h.model.chatHistorySync.checked, 15);
});
test('opening or rehydrating a chat while background sync runs does not mark messages read', async (t) => {
  const h = await harness(t, 'android', true),
    blocked = h.block(1),
    run = await h.start();
  await blocked.started;
  await h.event('change', 'background');
  const before = h.reads.length;
  await act(async () => {
    h.model.markChatRead(peer(1));
    await Promise.resolve();
  });
  assert.equal(h.reads.length, before);
  await h.cancel();
  await act(async () => {
    await run.task;
  });
  blocked.release();
});
test('switching accounts terminates the native background lifetime without transferring its progress', async (t) => {
  const h = await harness(t, 'android', true),
    blocked = h.block(1),
    run = await h.start();
  await blocked.started;
  assert.equal(h.leaseActive, true);
  await h.switch(OTHER);
  await act(async () => {
    await run.task;
  });
  blocked.release();
  assert.equal(h.leaseActive, false);
  assert.equal(h.model.chatHistorySync.status, 'idle');
  assert.equal(h.model.savedConversations.filter((c) => c.count).length, 0);
});
