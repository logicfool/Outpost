const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm'),
  ts = require('typescript'),
  crypto = require('node:crypto');
const { ID, OTHER, session } = require('./helpers.cjs');
const { makeDemo } = require('../.test-build/demo.js');
const compiled = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/platform/notifications.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;
function fixture() {
  const scheduled = [],
    cancelled = [],
    receipts = new Map();
  let permission = true,
    linked = true;
  const prefs = {
    reminders: false,
    backgroundSync: false,
    wishlistAlerts: true,
    chatAlerts: true,
    notificationPreviews: false,
  };
  const notifications = {
    setNotificationHandler() {},
    getPermissionsAsync: async () => ({ granted: permission }),
    requestPermissionsAsync: async () => ({ granted: permission }),
    getAllScheduledNotificationsAsync: async () => [],
    getPresentedNotificationsAsync: async () => [],
    scheduleNotificationAsync: async (n) => {
      scheduled.push(n);
      return n.identifier ?? 'fixture';
    },
    cancelScheduledNotificationAsync: async (id) => cancelled.push(id),
    cancelAllScheduledNotificationsAsync: async () => {},
    dismissAllNotificationsAsync: async () => {},
    SchedulableTriggerInputTypes: { DATE: 'date' },
  };
  const repo = {
    settings: async () => prefs,
    accounts: async () => (linked ? [session().account] : []),
    notificationStamp: async (k) => receipts.get(k) ?? null,
    setNotificationStamp: async (k, v) => receipts.set(k, v),
  };
  const m = { exports: {} },
    load = (name) => {
      if (name === 'react-native') return { Platform: { OS: 'ios' } };
      if (name === 'expo-notifications') return notifications;
      if (name === 'expo-crypto')
        return {
          CryptoDigestAlgorithm: { SHA256: 'sha256' },
          digestStringAsync: async (_, s) => crypto.createHash('sha256').update(s).digest('hex'),
        };
      if (name.startsWith('../core/'))
        return require(path.join(__dirname, '../.test-build', name.slice(8) + '.js'));
      throw Error(name);
    };
  vm.runInThisContext('(function(require,module,exports){' + compiled + '\n})')(load, m, m.exports);
  return {
    ...m.exports,
    scheduled,
    cancelled,
    receipts,
    repo,
    prefs,
    revoke: () => (permission = false),
    remove: () => (linked = false),
  };
}
test('store notifications aggregate sources and repeated sync does not repeat them', async () => {
  const h = fixture(),
    s = makeDemo().snapshot.store.data,
    w = [s.daily[0].item.id, s.nightMarket.offers[0].item.id, s.bundles[0].offers[0].item.id];
  await Promise.all([
    h.updateStoreNotifications(session().account, s, w, h.repo),
    h.updateStoreNotifications(session().account, s, w, h.repo),
  ]);
  assert.equal(h.scheduled.length, 1);
  assert.equal(h.scheduled[0].content.data.kind, 'wishlist');
  assert.match(h.scheduled[0].content.body, /Night Market/);
  assert.ok(!h.scheduled[0].content.body.includes(s.daily[0].item.name));
});
test('disabled preference, revoked permission and removed account do not notify', async () => {
  for (const mode of ['disable', 'permission', 'account']) {
    const h = fixture(),
      s = makeDemo().snapshot.store.data;
    if (mode === 'disable') h.prefs.wishlistAlerts = false;
    if (mode === 'permission') h.revoke();
    if (mode === 'account') h.remove();
    await h.updateStoreNotifications(session().account, s, [s.daily[0].item.id], h.repo);
    assert.equal(h.scheduled.length, 0);
  }
});
test('burst messages coalesce and duplicate/history/open conversation alerts stay quiet', async () => {
  const h = fixture(),
    message = {
      id: 'one',
      subject: OTHER,
      body: 'private text',
      at: Date.now(),
      source: 'live',
      direction: 'incoming',
      state: 'received',
    };
  await h.notifyChat(ID, message, undefined, true, h.repo);
  await h.notifyChat(ID, message, undefined, true, h.repo);
  await h.notifyChat(ID, { ...message, id: 'two' }, undefined, true, h.repo);
  await h.notifyChat(
    ID,
    { ...message, id: 'history', source: 'riot-archive' },
    undefined,
    true,
    h.repo,
  );
  await h.notifyChat(ID, { ...message, id: 'open' }, OTHER, true, h.repo);
  assert.equal(h.scheduled.length, 1);
  assert.equal(h.scheduled[0].content.body.includes('private text'), false);
  assert.equal(h.scheduled[0].content.data.peer, OTHER);
});
test('reset reminder is independent from wishlist and uses local server-corrected expiry', async () => {
  const h = fixture(),
    s = makeDemo().snapshot.store.data;
  h.prefs.wishlistAlerts = false;
  h.prefs.reminders = true;
  s.clockOffsetMs = 5000;
  await h.updateStoreNotifications(session().account, s, [], h.repo);
  assert.equal(h.scheduled.length, 1);
  assert.equal(h.scheduled[0].trigger.date.getTime(), s.dailyExpiresAt - 5000);
});
