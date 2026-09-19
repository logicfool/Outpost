const test = require('node:test'),
  assert = require('node:assert/strict');
const { RosterHistorySync, HISTORY_FRIEND_GAP_MS } = require('../.test-build/rosterHistorySync.js');
const { AppError } = require('../.test-build/validation.js');
const friend = (i) => ({
  subject: `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, '0')}`,
  name: 'Friend ' + i,
  tag: 'TEST',
  jid: `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, '0')}@jp1.pvp.net`,
  presence: 'offline',
});
function fixture() {
  let now = 100000;
  const progress = [],
    waits = [];
  const queue = new RosterHistorySync(
    (s) => progress.push(s),
    () => now,
    async (ms, signal) => {
      assert.equal(signal.aborted, false);
      waits.push(ms);
      now += ms;
      await Promise.resolve();
    },
  );
  return {
    queue,
    progress,
    waits,
    get now() {
      return now;
    },
  };
}
test('manual sync scans the entire offline roster without requiring any saved conversations', async () => {
  const h = fixture(),
    friends = Array.from({ length: 87 }, (_, i) => friend(i)),
    calls = [];
  let pending = 0,
    max = 0;
  const result = await h.queue.start(friends, {
    check() {},
    isFriend: () => true,
    async sync(f) {
      pending++;
      max = Math.max(max, pending);
      calls.push(f.subject);
      await Promise.resolve();
      pending--;
      return calls.length % 3 === 0 ? 2 : 0;
    },
  });
  assert.equal(result.status, 'complete');
  assert.equal(result.checked, 87);
  assert.equal(calls.length, 87);
  assert.equal(new Set(calls).size, 87);
  assert.equal(max, 1);
  assert.equal(result.messages, 58);
  assert.equal(result.empty, 58);
  assert.equal(result.conversations, 29);
  assert.equal(h.waits.length, 86);
  assert.ok(h.waits.every((ms) => ms === HISTORY_FRIEND_GAP_MS));
  assert.ok(HISTORY_FRIEND_GAP_MS >= 2000);
});
test('an individual denied request is reported and does not skip all subsequent friends', async () => {
  const h = fixture(),
    calls = [];
  const result = await h.queue.start([friend(1), friend(2), friend(3)], {
    check() {},
    isFriend: () => true,
    async sync(f) {
      calls.push(f.subject);
      if (calls.length === 2) throw new AppError('CHAT_HISTORY_UNAVAILABLE', 'Denied');
      return 1;
    },
  });
  assert.equal(result.checked, 3);
  assert.equal(result.failed, 1);
  assert.equal(result.conversations, 2);
  assert.equal(result.status, 'complete');
});
test('duplicate roster entries scan once and removed friends are explicitly skipped', async () => {
  const h = fixture(),
    calls = [];
  const result = await h.queue.start([friend(1), friend(1), friend(2)], {
    check() {},
    isFriend: (f) => f.subject === friend(1).subject,
    async sync(f) {
      calls.push(f.subject);
      return 0;
    },
  });
  assert.equal(result.total, 2);
  assert.equal(result.checked, 2);
  assert.equal(result.skipped, 1);
  assert.equal(calls.length, 1);
});
test('a local per-peer cooldown delays the same peer instead of claiming a successful sync', async () => {
  const h = fixture();
  let calls = 0;
  const result = await h.queue.start([friend(1)], {
    check() {},
    isFriend: () => true,
    async sync() {
      if (++calls === 1) throw new AppError('CHAT_COOLDOWN', 'Wait', h.now + 15000);
      return 3;
    },
  });
  assert.equal(result.messages, 3);
  assert.equal(result.checked, 1);
  assert.deepEqual(h.waits, [15000]);
});
test('a server throttle pauses without marking the current friend checked and resume honors its deadline', async () => {
  const h = fixture();
  let calls = 0;
  const options = {
    check() {},
    isFriend: () => true,
    async sync() {
      if (++calls === 1) throw new AppError('CHAT_HISTORY_RATE_LIMIT', 'Wait', h.now + 60000);
      return 2;
    },
  };
  const paused = await h.queue.start([friend(1)], options);
  assert.equal(paused.status, 'paused');
  assert.equal(paused.checked, 0);
  const result = await h.queue.resume(options);
  assert.equal(result.checked, 1);
  assert.equal(result.messages, 2);
  assert.deepEqual(h.waits, [60000]);
});
test('the next friend waits for durable storage completion, not merely the arrival of a response', async () => {
  const h = fixture();
  let release, entered;
  const held = new Promise((r) => (release = r)),
    started = new Promise((r) => (entered = r)),
    calls = [];
  const task = h.queue.start([friend(1), friend(2)], {
    check() {},
    isFriend: () => true,
    async sync(f) {
      calls.push(f.subject);
      if (calls.length === 1) {
        entered();
        await held;
      }
      return 1;
    },
  });
  await started;
  assert.equal(calls.length, 1);
  assert.equal(h.queue.progress.checked, 0);
  release();
  await task;
  assert.equal(calls.length, 2);
});
test('cancel stops an outstanding request and resume continues at the first unchecked friend', async () => {
  const h = fixture(),
    calls = [];
  let entered;
  const started = new Promise((r) => (entered = r));
  let block = true;
  const options = {
    check() {},
    isFriend: () => true,
    async sync(f, signal) {
      calls.push(f.subject);
      if (block && f.subject === friend(2).subject) {
        entered();
        await new Promise((_, reject) =>
          signal.addEventListener(
            'abort',
            () => reject(new AppError('CHAT_HISTORY_CANCELLED', 'Stopped')),
            { once: true },
          ),
        );
      }
      return 1;
    },
  };
  const task = h.queue.start([friend(1), friend(2), friend(3)], options);
  await started;
  h.queue.stop();
  const stopped = await task;
  assert.equal(stopped.status, 'cancelled');
  assert.equal(stopped.checked, 1);
  assert.equal(calls.length, 2);
  block = false;
  const done = await h.queue.resume(options);
  assert.equal(done.checked, 3);
  assert.equal(done.messages, 3);
  assert.deepEqual(calls, [
    friend(1).subject,
    friend(2).subject,
    friend(2).subject,
    friend(3).subject,
  ]);
});
test('account or lifecycle invalidation stops dispatching additional requests', async () => {
  const h = fixture();
  let valid = true,
    calls = 0;
  const state = await h.queue.start([friend(1), friend(2)], {
    check() {
      if (!valid) throw new AppError('ACCOUNT_CHANGED', 'Changed');
    },
    isFriend: () => true,
    async sync() {
      calls++;
      valid = false;
      return 1;
    },
  });
  assert.equal(calls, 1);
  assert.equal(state.status, 'paused');
  assert.equal(state.checked, 0);
});
test('double presses cannot launch overlapping roster scans', async () => {
  const h = fixture();
  let release;
  const hold = new Promise((r) => (release = r)),
    options = {
      check() {},
      isFriend: () => true,
      sync: async () => {
        await hold;
        return 0;
      },
    };
  const first = h.queue.start([friend(1)], options);
  assert.throws(
    () => h.queue.start([friend(2)], options),
    (e) => e.code === 'CHAT_HISTORY_BUSY',
  );
  release();
  await first;
});
test('an empty roster completes honestly without issuing a history request', async () => {
  const h = fixture();
  const result = await h.queue.start([], {
    check() {},
    isFriend: () => true,
    sync: () => assert.fail('No peers'),
  });
  assert.equal(result.status, 'complete');
  assert.equal(result.total, 0);
});
