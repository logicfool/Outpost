const test = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs'),
  vm = require('node:vm'),
  path = require('node:path'),
  ts = require('typescript');
const { DatabaseSync } = require('node:sqlite');
const { ID, OTHER, session } = require('./helpers.cjs');
const { repositoryFixture: fixture } = require('./repository-fixture.cjs');
test('refresh reservations persist by account and purpose in SQLite', async (t) => {
  const { repo } = await fixture(t),
    gate = { attemptedAt: 1, notBefore: 60001, failures: 0 };
  await repo.saveRefreshGate(ID, 'live', gate);
  assert.deepEqual(await repo.refreshGate(ID, 'live'), gate);
  assert.equal(await repo.refreshGate(ID, 'sync'), null);
  assert.equal(await repo.refreshGate(OTHER, 'live'), null);
});
test('clearing game cache does not remove request cooldowns', async (t) => {
  const { repo } = await fixture(t),
    gate = { attemptedAt: 1, notBefore: 60001, failures: 0 };
  await repo.saveRefreshGate(ID, 'sync', gate);
  await repo.clearCache();
  assert.deepEqual(await repo.refreshGate(ID, 'sync'), gate);
});
test('removing an account cascades its gates without erasing other account budgets', async (t) => {
  const { repo } = await fixture(t),
    gate = { attemptedAt: 1, notBefore: 60001, failures: 0 };
  await repo.saveRefreshGate(ID, 'live', gate);
  await repo.saveRefreshGate(OTHER, 'live', gate);
  await repo.removeAccount(ID);
  assert.equal(await repo.refreshGate(ID, 'live'), null);
  assert.deepEqual(await repo.refreshGate(OTHER, 'live'), gate);
});

test('saved presets and purchase records survive game-cache clearing but cascade on account removal', async (t) => {
  const { repo } = await fixture(t),
    p = {
      id: OTHER,
      accountId: ID,
      name: 'Saved set',
      updatedAt: 1,
      weapons: [{ weaponId: ID, skinId: ID, levelId: ID, chromaId: ID }],
    };
  await repo.savePreset(p);
  await repo.savePurchaseRecord({ id: OTHER, accountId: ID, state: 'unknown', at: 1 });
  await repo.clearCache();
  assert.equal((await repo.presets(ID)).length, 1);
  assert.equal((await repo.purchaseRecords(ID)).length, 1);
  assert.equal((await repo.presets(OTHER)).length, 0);
  await repo.removeAccount(ID);
  assert.equal((await repo.presets(ID)).length, 0);
  assert.equal((await repo.purchaseRecords(ID)).length, 0);
});

test('aim presets and pending settings checks persist independently for both accounts', async (t) => {
  const { repo, db } = await fixture(t),
    { defaultCrosshair } = require('../.test-build/crosshair.js'),
    { aimSnapshot } = require('../.test-build/aimSettings.js'),
    { document, change } = require('./aim-helpers.cjs');
  const p = {
    id: OTHER,
    accountId: ID,
    name: 'Aim',
    profile: defaultCrosshair('Aim'),
    sensitivity: { hipfire: 0.25, ads: 1, scoped: 1 },
    updatedAt: 1,
  };
  const state = {
    snapshot: aimSnapshot(document(), ID, 10),
    pending: { id: OTHER, at: 11, desired: change() },
    lastApplyAt: 11,
    nextReadAt: 60011,
  };
  await repo.saveAimPreset(p);
  await repo.saveAimState(ID, state);
  assert.equal((await repo.aimPresets(ID)).length, 1);
  assert.deepEqual(await repo.aimState(ID), state);
  assert.equal(await repo.aimState(OTHER), null);
  await repo.clearCache();
  assert.equal((await repo.aimPresets(ID)).length, 1);
  assert.equal((await repo.aimState(ID)).nextReadAt, 60011);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 5);
  await repo.removeAccount(ID);
  assert.deepEqual(await repo.aimPresets(ID), []);
  assert.equal(await repo.aimState(ID), null);
  assert.equal((await repo.accounts()).length, 1);
});
test('an aim cache row cannot be saved under a different account', async (t) => {
  const { repo } = await fixture(t),
    { aimSnapshot } = require('../.test-build/aimSettings.js'),
    { document } = require('./aim-helpers.cjs');
  await assert.rejects(
    repo.saveAimState(ID, { snapshot: aimSnapshot(document(), OTHER) }),
    (e) => e.code === 'ACCOUNT_MISMATCH',
  );
});
