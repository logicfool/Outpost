const test = require('node:test'),
  assert = require('node:assert/strict');
const { repositoryFixture } = require('./repository-fixture.cjs');
const {
  snapshot,
  report,
  summary,
  backup,
  hash,
  ID,
  OTHER,
  SKIN,
  MATCH,
  clone,
} = require('./archive-fixture.cjs');
const { encodeBackup, decodeBackup } = require('../.test-build/backup.js');
test('match summaries append new IDs without losing older pages or cached previews', async (t) => {
  const { repo } = await repositoryFixture(t);
  await repo.saveArchivedMatches(ID, ID, [summary(MATCH, 1000), summary(OTHER, 500)]);
  await repo.saveArchivedReport(ID, ID, report());
  await repo.saveArchivedMatches(ID, ID, [summary(MATCH, Date.now())]);
  const rows = await repo.archivedMatches(ID, ID);
  assert.equal(rows.length, 2);
  assert.ok(rows[0].preview);
  assert.equal(rows[1].id, OTHER);
  assert.equal((await repo.archivedMatches(OTHER, OTHER)).length, 0);
});
test('saved reports and observed markets survive cache clearing and old age', async (t) => {
  const { repo } = await repositoryFixture(t);
  const r = report();
  r.savedAt = 1000;
  r.detail.startedAt = 1;
  await repo.saveArchivedReport(ID, ID, r);
  const s = snapshot();
  s.store.data.fetchedAt = 1000;
  await repo.saveSnapshot(s);
  await repo.clearCache();
  assert.ok(await repo.archivedReport(ID, ID, MATCH));
  assert.ok((await repo.archivedMatches(ID, ID)).length);
  assert.ok((await repo.marketHistory(ID)).length);
  assert.ok((await repo.history(ID)).length);
});
test('full backups restore into the matching signed-in account with duplicate-safe merges', async (t) => {
  const { repo, db } = await repositoryFixture(t);
  const data = backup();
  await repo.restoreAccountData(ID, data, true, () => {});
  await repo.restoreAccountData(ID, data, true, () => {});
  assert.equal((await repo.presets(ID)).length, 1);
  assert.equal((await repo.aimPresets(ID)).length, 1);
  assert.equal((await repo.archivedMatches(ID, ID)).length, 1);
  assert.equal((await repo.wishlist(ID)).length, 1);
  assert.equal((await repo.settings()).allowPurchases, false);
  assert.equal((await repo.settings()).videoSound, false);
  assert.equal(await repo.archivedMatchTrusted(ID, ID, MATCH), false);
  assert.equal((await repo.archivedReport(ID, ID, MATCH)).imported, true);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM purchases').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM refresh_gates').get().n, 0);
});
test('restore rejects a different account and rolls back a mid-import cancellation', async (t) => {
  const { repo } = await repositoryFixture(t);
  await assert.rejects(
    repo.restoreAccountData(OTHER, backup(), false, () => {}),
    (e) => e.code === 'BACKUP_ACCOUNT',
  );
  let checks = 0;
  await assert.rejects(
    repo.restoreAccountData(ID, backup(), false, () => {
      if (++checks > 5) throw Error('cancelled');
    }),
  );
  assert.equal((await repo.presets(ID)).length, 0);
  assert.equal((await repo.wishlist(ID)).length, 0);
  assert.equal((await repo.archivedMatches(ID, ID)).length, 0);
});
test('backup restore never overwrites an existing preset or enables phone purchases', async (t) => {
  const { repo } = await repositoryFixture(t),
    data = backup();
  await repo.savePreset({ ...data.presets[0], name: 'Existing wins' });
  await repo.restoreAccountData(ID, data, true, () => {});
  assert.equal((await repo.presets(ID))[0].name, 'Existing wins');
  assert.equal((await repo.settings()).allowPurchases, false);
});
test('repository export is recoverable and contains no login session or request budgets', async (t) => {
  const { repo } = await repositoryFixture(t);
  await repo.saveSnapshot(snapshot());
  await repo.saveArchivedReport(ID, ID, report());
  const b = backup();
  await repo.savePreset(b.presets[0]);
  await repo.saveAimPreset(b.aimPresets[0]);
  await repo.saveRefreshGate(ID, 'live', { attemptedAt: 1, notBefore: 100, failures: 1 });
  const exported = await repo.exportAccountData(ID, true),
    encoded = await encodeBackup(exported, hash),
    file = await decodeBackup(encoded, hash);
  assert.equal(file.data.presets.length, 1);
  assert.equal(file.data.reports.length, 1);
  assert.ok(file.data.markets.some((m) => m.kind === 'night-market'));
  for (const forbidden of [
    'accessToken',
    'entitlementsToken',
    'renewalFailure',
    'notBefore',
    'ssid',
  ])
    assert.ok(!encoded.includes(forbidden), forbidden);
  assert.equal(file.data.account.expiresAt, undefined);
  assert.equal(file.data.account.canReauth, undefined);
  const light = await repo.exportAccountData(ID, false);
  assert.equal(light.reports.length, 0);
  assert.equal(light.matches.length, exported.matches.length);
});
test('imported match summaries stay untrusted when snapshots are saved again', async (t) => {
  const { repo } = await repositoryFixture(t);
  await repo.restoreAccountData(ID, backup(), false, () => {});
  const restored = await repo.snapshot(ID);
  await repo.saveSnapshot(restored);
  assert.equal(await repo.archivedMatchTrusted(ID, ID, MATCH), false);
  await repo.saveArchivedMatches(ID, ID, [summary()]);
  assert.equal(await repo.archivedMatchTrusted(ID, ID, MATCH), true);
});
test('existing sessions, pending aim operations and request gates survive restore', async (t) => {
  const { repo } = await repositoryFixture(t),
    before = await repo.accounts(),
    pending = {
      pending: { id: OTHER, at: 12, desired: { expectedRevision: 'held' } },
      nextReadAt: 100,
    };
  await repo.saveAimState(ID, pending);
  await repo.saveRefreshGate(ID, 'live', { attemptedAt: 1, notBefore: 99, failures: 0 });
  await repo.restoreAccountData(ID, backup(), true, () => {});
  assert.deepEqual(await repo.accounts(), before);
  assert.deepEqual(await repo.aimState(ID), pending);
  assert.equal((await repo.refreshGate(ID, 'live')).notBefore, 99);
});
test('clearing cache does not erase another accounts history, and removal only cascades its owner', async (t) => {
  const { repo } = await repositoryFixture(t);
  await repo.saveArchivedMatches(ID, ID, [summary()]);
  await repo.saveArchivedMatches(OTHER, OTHER, [summary()]);
  await repo.removeAccount(ID);
  assert.equal((await repo.archivedMatches(ID, ID)).length, 0);
  assert.equal((await repo.archivedMatches(OTHER, OTHER)).length, 1);
});
test('existing snapshots are migrated into the durable archive during upgrade', async (t) => {
  const { repo, db } = await repositoryFixture(t);
  const saved = snapshot();
  db.prepare('DELETE FROM settings WHERE key=?').run('archive.migrated.v1');
  db.prepare('INSERT INTO snapshots(account_id,data) VALUES(?,?)').run(ID, JSON.stringify(saved));
  const reopened = await repositoryFixture(t, { db, skipAccounts: true });
  assert.equal((await reopened.repo.archivedMatches(ID, ID)).length, saved.matches.data.length);
  assert.ok((await reopened.repo.marketHistory(ID)).length);
});
test('restoring a profile cannot overwrite existing ready Riot data', async (t) => {
  const { repo } = await repositoryFixture(t),
    s = snapshot();
  s.xp = { status: 'ready', data: { level: 70, xp: 4321 }, fetchedAt: 1000 };
  await repo.saveSnapshot(s);
  const data = backup();
  data.profile.xp = { status: 'ready', data: { level: 1, xp: 1 }, fetchedAt: Date.now() };
  await repo.restoreAccountData(ID, data, false, () => {});
  assert.deepEqual((await repo.snapshot(ID)).xp.data, { level: 70, xp: 4321 });
});
test('writing an ordinary snapshot cannot promote restored IDs into network authorization', async (t) => {
  const { repo } = await repositoryFixture(t);
  await repo.restoreAccountData(ID, backup(), false, () => {});
  await repo.saveSnapshot(await repo.snapshot(ID));
  assert.equal(await repo.archivedMatchTrusted(ID, ID, MATCH), false);
});
test('snapshot reads wait until a backup restore commits', async (t) => {
  let announce, release;
  const reached = new Promise((r) => (announce = r)),
    held = new Promise((r) => (release = r));
  let hold = true;
  const { repo } = await repositoryFixture(t, {
    beforeWrite: async (sql) => {
      if (hold && sql.startsWith('INSERT OR IGNORE INTO aim_presets')) {
        hold = false;
        announce();
        await held;
      }
    },
  });
  const restore = repo.restoreAccountData(ID, backup(), false, () => {});
  await reached;
  let readFinished = false;
  const read = repo.snapshot(ID).then((value) => {
    readFinished = true;
    return value;
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(readFinished, false);
  release();
  await restore;
  const result = await read;
  assert.equal(result.matches.status, 'ready');
  assert.equal(result.matches.data.length, 1);
});
