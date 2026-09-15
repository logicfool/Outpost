const test = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs'),
  vm = require('node:vm'),
  path = require('node:path'),
  ts = require('typescript');
const { DatabaseSync } = require('node:sqlite');
const { ID, OTHER, session } = require('./helpers.cjs');
const compiled = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/platform/storage.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;
async function fixture(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const adapter = {
    execAsync: async (sql) => db.exec(sql),
    runAsync: async (sql, ...args) => db.prepare(sql).run(...args),
    getFirstAsync: async (sql, ...args) => db.prepare(sql).get(...args) ?? null,
    getAllAsync: async (sql, ...args) => db.prepare(sql).all(...args),
    withTransactionAsync: async (f) => {
      db.exec('BEGIN');
      try {
        await f();
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
  const m = { exports: {} };
  const load = (n) =>
    n === 'expo-sqlite'
      ? { openDatabaseAsync: async () => adapter }
      : n.startsWith('../core/')
        ? require(path.join(__dirname, '../.test-build', n.slice(8) + '.js'))
        : (() => {
            throw Error(n);
          })();
  vm.runInThisContext('(function(require,module,exports){' + compiled + '\n})')(load, m, m.exports);
  const repo = await m.exports.openRepository();
  await repo.saveAccount(session(ID).account);
  await repo.saveAccount(session(OTHER).account);
  return { repo, db };
}
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
