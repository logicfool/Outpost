const test = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm'),
  ts = require('typescript');
const { ID, OTHER, code } = require('./helpers.cjs');
const compiled = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/platform/chatStorage.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;
function fixture(options = {}) {
  const keys = new Map(),
    events = [],
    files = new Set(),
    accounts = new Set([ID, OTHER]);
  let opens = 0;
  const dbs = new Map();
  const SQLite = {
    defaultDatabaseDirectory: 'file:///fixture/sqlite',
    openDatabaseAsync: async (name) => {
      opens++;
      files.add(name);
      const db = {
        name,
        execAsync: async (sql) => {
          events.push(['sql', name, sql]);
        },
        getFirstAsync: async () => (options.noCipher ? null : { cipher_version: 'fixture' }),
        closeAsync: async () => events.push(['closeDb', name]),
      };
      dbs.set(name, db);
      return db;
    },
    deleteDatabaseAsync: async (name) => {
      events.push(['deleteDb', name]);
      files.delete(name);
    },
  };
  class File {
    constructor(...parts) {
      this.name = parts.at(-1);
    }
    get exists() {
      return files.has(this.name);
    }
    delete() {
      events.push(['deleteFile', this.name]);
      files.delete(this.name);
    }
  }
  const SecureStore = {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 7,
    getItemAsync: async (key) => keys.get(key) ?? null,
    setItemAsync: async (key, value) => {
      keys.set(key, value);
      events.push(['setKey', key]);
    },
    deleteItemAsync: async (key) => {
      keys.delete(key);
      events.push(['deleteKey', key]);
    },
  };
  let n = 0;
  const load = (name) => {
    if (name === 'expo-sqlite') return SQLite;
    if (name === 'expo-file-system') return { File };
    if (name === 'expo-secure-store') return SecureStore;
    if (name === './secure') return { randomHex: () => String(++n).padStart(64, '0') };
    if (name === './storage')
      return {
        openRepository: async () => ({
          accounts: async () => [...accounts].map((puuid) => ({ puuid })),
        }),
      };
    if (name === '../core/chatStore')
      return {
        createChatStore: async (db) => {
          if (options.schemaFailure) throw Error('fixture unlock failure');
          return { close: async () => events.push(['closeStore', db.name]) };
        },
      };
    if (name.startsWith('../core/'))
      return require(path.join(__dirname, '../.test-build', name.slice(8) + '.js'));
    throw Error(name);
  };
  const module = { exports: {} };
  vm.runInThisContext('(function(require,module,exports){' + compiled + '\n})')(
    load,
    module,
    module.exports,
  );
  return {
    ...module.exports,
    keys,
    events,
    files,
    accounts,
    dbs,
    get opens() {
      return opens;
    },
  };
}
test('native chat storage refuses a build lacking SQLCipher before generating a key', async () => {
  const h = fixture({ noCipher: true });
  await assert.rejects(h.openChatStorage(ID), code('CHAT_ENCRYPTION'));
  assert.equal(h.keys.size, 0);
  assert.equal(h.events.filter((e) => e[0] === 'closeDb').length, 1);
});
test('unlinked accounts cannot create new chat databases or keys', async () => {
  const h = fixture();
  h.accounts.delete(ID);
  await assert.rejects(h.openChatStorage(ID), code('CHAT_ACCOUNT'));
  assert.equal(h.opens, 0);
  assert.equal(h.keys.size, 0);
});
test('parallel opens share one native database and never rotate its encryption key', async () => {
  const h = fixture(),
    [a, b] = await Promise.all([h.openChatStorage(ID), h.openChatStorage(ID)]);
  assert.equal(a, b);
  assert.equal(h.opens, 1);
  assert.equal(h.keys.size, 1);
  const sql = h.events.find((e) => e[0] === 'sql')[2];
  assert.match(sql, /^PRAGMA key = "x'[0-9a-f]{64}'";$/);
});
test('different linked accounts use independent native files and keys', async () => {
  const h = fixture();
  await h.openChatStorage(ID);
  await h.openChatStorage(OTHER);
  assert.equal(h.keys.size, 2);
  assert.equal(new Set(h.keys.values()).size, 2);
  assert.equal(h.dbs.size, 2);
});
test('an existing encryption key is preserved on unlock failure', async () => {
  const h = fixture({ schemaFailure: true }),
    key = 'outpost.chat.key.' + ID;
  h.keys.set(key, 'a'.repeat(64));
  await assert.rejects(h.openChatStorage(ID), code('CHAT_STORAGE'));
  assert.equal(h.keys.get(key), 'a'.repeat(64));
  assert.equal(
    h.events.some((e) => e[0] === 'deleteDb'),
    false,
  );
});
test('account removal closes then removes only its encrypted database, sidecars and key', async () => {
  const h = fixture();
  await h.openChatStorage(ID);
  await h.openChatStorage(OTHER);
  const base = 'outpost-chat-' + ID + '.db';
  h.files.add(base + '-wal');
  h.files.add(base + '-shm');
  await h.removeChatStorage(ID);
  assert.equal(h.keys.has('outpost.chat.key.' + ID), false);
  assert.equal(h.keys.has('outpost.chat.key.' + OTHER), true);
  assert.equal(h.files.has(base), false);
  assert.equal(h.files.has(base + '-wal'), false);
  assert.equal(h.files.has('outpost-chat-' + OTHER + '.db'), true);
  assert.ok(
    h.events.findIndex((e) => e[0] === 'closeStore') <
      h.events.findIndex((e) => e[0] === 'deleteDb'),
  );
});

test('removed account is tombstoned against stale opens until a new link activates it', async () => {
  const h = fixture();
  await h.openChatStorage(ID);
  await h.removeChatStorage(ID);
  await assert.rejects(h.openChatStorage(ID), code('CHAT_ACCOUNT'));
  assert.equal(h.keys.size, 0);
  h.activateChatStorage(ID);
  await h.openChatStorage(ID);
  assert.equal(h.keys.size, 1);
});
