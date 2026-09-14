const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { SessionVault } = require('../.test-build/vault.js');
const { ID, OTHER, session, code } = require('./helpers.cjs');
function fixture() {
  const data = new Map();
  const storage = {
    get: async (key) => data.get(key) ?? null,
    set: async (key, value) => {
      data.set(key, value);
    },
    remove: async (key) => {
      data.delete(key);
    },
  };
  return { data, storage, vault: new SessionVault(storage, randomUUID) };
}
test('secure vault round-trips a session using bounded ASCII chunks', async () => {
  const { vault, data } = fixture(),
    s = session();
  s.account.gameName = 'नाम'.repeat(100);
  s.accessToken += 'a'.repeat(7000);
  await vault.write(s);
  assert.deepEqual(await vault.read(ID), s);
  assert.ok(data.size > 5);
  for (const value of data.values()) {
    assert.ok(Buffer.byteLength(value, 'utf8') <= 1200);
  }
});
test('separate accounts have separate manifests and secrets', async () => {
  const { vault } = fixture(),
    a = session(ID),
    b = session(OTHER);
  await Promise.all([vault.write(a), vault.write(b)]);
  assert.equal((await vault.read(ID)).account.puuid, ID);
  assert.equal((await vault.read(OTHER)).account.puuid, OTHER);
});
test('failed chunk write rolls back without destroying old session', async () => {
  const { vault, storage } = fixture(),
    old = session();
  await vault.write(old);
  const normal = storage.set;
  let writes = 0;
  storage.set = async (...args) => {
    if (++writes === 2) throw Error('simulated native failure');
    return normal(...args);
  };
  const next = session();
  next.accessToken += 'b'.repeat(6000);
  await assert.rejects(vault.write(next));
  assert.deepEqual(await vault.read(ID), old);
});
test('failed manifest switch leaves previous committed generation intact', async () => {
  const { vault, storage } = fixture(),
    old = session();
  await vault.write(old);
  const normal = storage.set;
  storage.set = async (key, value) => {
    if (key.endsWith('.manifest')) throw Error('simulated commit failure');
    return normal(key, value);
  };
  const next = session();
  next.account.gameName = 'New';
  await assert.rejects(vault.write(next));
  assert.deepEqual(await vault.read(ID), old);
});
test('successful replacement removes the previous generation', async () => {
  const { vault, data } = fixture(),
    s = session();
  await vault.write(s);
  const keys = [...data.keys()].filter((k) => !k.endsWith('.manifest'));
  s.account.gameName = 'Updated';
  await vault.write(s);
  assert.ok(keys.every((key) => !data.has(key)));
  assert.equal((await vault.read(ID)).account.gameName, 'Updated');
});
test('corrupt or missing chunk is an explicit error', async () => {
  const { vault, data } = fixture();
  await vault.write(session());
  const chunk = [...data.keys()].find((k) => !k.endsWith('.manifest'));
  data.delete(chunk);
  await assert.rejects(vault.read(ID), code('VAULT_CORRUPT'));
});
test('concurrent writes serialize and produce one readable latest session', async () => {
  const { vault } = fixture();
  const a = session(),
    b = session();
  a.account.gameName = 'First';
  b.account.gameName = 'Second';
  await Promise.all([vault.write(a), vault.write(b)]);
  assert.equal((await vault.read(ID)).account.gameName, 'Second');
});
test('account removal erases its known chunks without touching another account', async () => {
  const { vault, data } = fixture();
  await vault.write(session(ID));
  await vault.write(session(OTHER));
  await vault.remove(ID);
  assert.equal(await vault.read(ID), null);
  assert.ok((await vault.read(OTHER)).account);
  assert.ok([...data.keys()].every((k) => !k.includes(ID)));
});
test('vault rejects path-like account identifiers', async () => {
  const { vault } = fixture();
  await assert.rejects(vault.read('../other-account'), code('INVALID_ID'));
});
test('recovery after crash before manifest commit erases incomplete token generation', async () => {
  const { vault, data } = fixture(),
    s = session();
  await vault.write(s);
  const prefix = `outpost.session.${ID}`,
    previous = JSON.parse(data.get(`${prefix}.manifest`)),
    next = { generation: 'a'.repeat(32), chunks: 2 };
  data.set(`${prefix}.journal`, JSON.stringify({ previous, next }));
  data.set(`${prefix}.${next.generation}.0`, 'incomplete-secret');
  assert.deepEqual(await vault.read(ID), s);
  assert.equal(data.has(`${prefix}.${next.generation}.0`), false);
  assert.equal(data.has(`${prefix}.journal`), false);
});
test('recovery after committed write erases previous generation and retains new session', async () => {
  const { vault, data } = fixture(),
    s = session();
  await vault.write(s);
  const prefix = `outpost.session.${ID}`,
    next = JSON.parse(data.get(`${prefix}.manifest`)),
    previous = { generation: 'a'.repeat(32), chunks: 1 };
  data.set(`${prefix}.journal`, JSON.stringify({ previous, next }));
  data.set(`${prefix}.${previous.generation}.0`, 'previous-secret');
  assert.deepEqual(await vault.read(ID), s);
  assert.equal(data.has(`${prefix}.${previous.generation}.0`), false);
});
test('remove also cleans an interrupted journaled write', async () => {
  const { vault, data } = fixture();
  await vault.write(session());
  const prefix = `outpost.session.${ID}`,
    previous = JSON.parse(data.get(`${prefix}.manifest`)),
    next = { generation: 'a'.repeat(32), chunks: 1 };
  data.set(`${prefix}.journal`, JSON.stringify({ previous, next }));
  data.set(`${prefix}.${next.generation}.0`, 'incomplete-secret');
  await vault.remove(ID);
  assert.equal(data.size, 0);
});
