const fs = require('node:fs'),
  vm = require('node:vm'),
  path = require('node:path'),
  ts = require('typescript');
const { DatabaseSync } = require('node:sqlite');
const { ID, OTHER, session } = require('./helpers.cjs');
async function repositoryFixture(t, options = {}) {
  const db = options.db ?? new DatabaseSync(':memory:');
  if (!options.db) t.after(() => db.close());
  const adapter = {
    execAsync: async (sql) => db.exec(sql),
    runAsync: async (sql, ...args) => {
      await options.beforeWrite?.(sql, args);
      return db.prepare(sql).run(...args);
    },
    getFirstAsync: async (sql, ...args) => db.prepare(sql).get(...args) ?? null,
    getAllAsync: async (sql, ...args) => db.prepare(sql).all(...args),
    withTransactionAsync: async (fn) => {
      db.exec('BEGIN');
      try {
        await fn();
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
  const modules = new Map();
  const load = (name) => {
    if (name === 'expo-sqlite') return { openDatabaseAsync: async () => adapter };
    if (name.startsWith('../core/'))
      return require(path.join(__dirname, '../.test-build', name.slice(8) + '.js'));
    if (!['./storage', './matchRepository', './backupRepository'].includes(name))
      throw Error('Unexpected storage dependency ' + name);
    if (modules.has(name)) return modules.get(name).exports;
    const mod = { exports: {} };
    modules.set(name, mod);
    const source = fs.readFileSync(
      path.join(__dirname, '../src/platform', name.slice(2) + '.ts'),
      'utf8',
    );
    const js = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInThisContext('(function(require,module,exports){' + js + '\n})')(load, mod, mod.exports);
    return mod.exports;
  };
  const repo = await load('./storage').openRepository();
  if (!options.skipAccounts) {
    await repo.saveAccount(session(ID).account);
    await repo.saveAccount(session(OTHER).account);
  }
  return { repo, db, adapter };
}
module.exports = { repositoryFixture };
