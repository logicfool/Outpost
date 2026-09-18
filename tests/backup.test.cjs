const test = require('node:test'),
  assert = require('node:assert/strict');
const {
  encodeBackup,
  decodeBackup,
  validateBackupData,
  backupCounts,
} = require('../.test-build/backup.js');
const { backup, hash, ID, OTHER, clone } = require('./archive-fixture.cjs');
test('backup round trip includes presets, observed stores and full local reports without auth', async () => {
  const b = backup(),
    file = await encodeBackup(b, hash),
    restored = await decodeBackup(file, hash);
  assert.equal(restored.data.account.puuid, ID);
  assert.equal(restored.data.presets[0].name, 'Cosmetic set');
  assert.equal(restored.data.aimPresets[0].sensitivity.hipfire, 0.25);
  assert.equal(backupCounts(restored.data).matches, 1);
  assert.equal(backupCounts(restored.data).reports, 1);
  assert.ok(!file.includes('accessToken'));
  assert.ok(!file.includes('Cookie'));
});
test('backup checksum changes are rejected before any import', async () => {
  const raw = JSON.parse(await encodeBackup(backup(), hash));
  raw.data.presets[0].name = 'Tampered';
  await assert.rejects(
    decodeBackup(JSON.stringify(raw), hash),
    (e) => e.code === 'BACKUP_CHECKSUM',
  );
});
for (const key of [
  'accessToken',
  'reauthCookies',
  'password',
  'chatEncryptionKey',
  'constructor',
  '__proto__',
])
  test('backup rejects credential or prototype field ' + key, () => {
    const b = backup();
    Object.defineProperty(b, key, { value: 'secret fixture', enumerable: true });
    assert.throws(() => validateBackupData(b));
  });
for (const uri of [
  'file:///private/file',
  'data:image/png;base64,abc',
  'http://example.test/picture',
  'https://example.test/picture',
])
  test('backup rejects untrusted media ' + uri, () => {
    const b = backup();
    b.matches[0].summary.preview.mapImage = uri;
    assert.throws(() => validateBackupData(b));
  });
test('another account preset cannot be smuggled into an otherwise valid backup', () => {
  const b = backup();
  b.aimPresets[0].accountId = OTHER;
  assert.throws(() => validateBackupData(b));
});
test('backup duplicate preset IDs and malformed match previews fail closed', () => {
  const b = backup();
  b.presets.push(clone(b.presets[0]));
  assert.throws(() => validateBackupData(b));
  const c = backup();
  c.matches[0].summary.preview.kills = 'many';
  assert.throws(() => validateBackupData(c));
});
test('broken round event data and profile arrays cannot crash the restored UI', () => {
  const b = backup();
  b.reports[0].detail.analysis.rounds[0].events = 'wrong';
  assert.throws(() => validateBackupData(b));
  const c = backup();
  c.profile.loadout.data.guns = [{}];
  assert.throws(() => validateBackupData(c));
});
test('unknown format or future backup version is not accepted', async () => {
  await assert.rejects(decodeBackup(JSON.stringify({ format: 'other', version: 5 }), hash));
});
test('backup rejects malformed nested images and future freshness timestamps', () => {
  const a = backup();
  a.reports[0].detail.players[0].agentImage = { uri: 'file:///secret' };
  assert.throws(() => validateBackupData(a));
  const b = backup();
  b.profile.rank.data.image = 7;
  assert.throws(() => validateBackupData(b));
  const c = backup();
  c.reports[0].savedAt = Date.now() + 86400000;
  assert.throws(() => validateBackupData(c));
});
test('null backup and malformed collections produce a controlled validation failure', async () => {
  await assert.rejects(decodeBackup('null', hash), (e) => e.code === 'BACKUP_INVALID');
  const b = backup();
  b.markets[0].offers[0].item.levels = 'invalid';
  assert.throws(() => validateBackupData(b));
});
