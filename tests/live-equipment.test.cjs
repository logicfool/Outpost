const test = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm'),
  ts = require('typescript');
const {
  ID,
  OTHER,
  MATCH,
  SKIN,
  LEVEL,
  session,
  response,
  catalog,
  code,
} = require('./helpers.cjs');
const { normalizeLiveEquipment } = require('../.test-build/liveEquipment.js');
const { RiotClient } = require('../.test-build/riot.js');
const { HttpClient } = require('../.test-build/http.js');
const { AppError } = require('../.test-build/validation.js');
const GUN = '66666666-6666-4666-8666-666666666666',
  CHROMA = '77777777-7777-4777-8777-777777777777';
const game = () => ({
  matchId: MATCH,
  state: 'in_game',
  players: [
    { subject: ID, name: 'You', tag: '', self: true, teamId: 'Blue' },
    { subject: OTHER, name: 'Rival', tag: '', teamId: 'Red' },
  ],
});
const cat = () => {
  const c = catalog();
  c.items[SKIN].weaponId = GUN;
  c.items[LEVEL].weaponId = GUN;
  c.items[CHROMA] = {
    id: CHROMA,
    canonicalId: SKIN,
    kind: 'chroma',
    weaponId: GUN,
    weapon: 'Vandal',
    name: 'Blue variant',
  };
  c.weapons = { [GUN]: { id: GUN, name: 'Vandal' } };
  return c;
};
const loadouts = () => ({
  Loadouts: [
    {
      CharacterID: SKIN,
      Loadout: {
        Subject: ID,
        Items: {
          [GUN]: {
            ID: GUN,
            Sockets: { level: { Item: { ID: LEVEL } }, chroma: { Item: { ID: CHROMA } } },
          },
        },
      },
    },
    {
      Loadout: {
        Subject: OTHER,
        Items: { [GUN]: { ID: GUN, Sockets: { skin: { Item: { ID: LEVEL } } } } },
      },
    },
  ],
});
test('live sockets resolve selected variant and canonical skin without ownership fetches', () => {
  const d = normalizeLiveEquipment(loadouts(), game(), ID, cat());
  assert.equal(d.players.length, 2);
  assert.equal(d.players[0].weapons[0].skin.name, 'Blue variant');
  assert.equal(d.players[0].weapons[0].levelId, LEVEL);
});
test('pre-game direct loadout rows normalize without the nested wrapper', () => {
  const r = loadouts();
  r.Loadouts = r.Loadouts.map((x) => x.Loadout);
  assert.equal(
    normalizeLiveEquipment(r, { ...game(), state: 'agent_select' }, ID, cat()).players.length,
    2,
  );
});
test('hidden and foreign participants are excluded from match skins', () => {
  const r = loadouts(),
    g = game();
  g.players[1].hidden = true;
  r.Loadouts.push({ Loadout: { Subject: SKIN, Items: {} } });
  assert.deepEqual(
    normalizeLiveEquipment(r, g, ID, cat()).players.map((p) => p.subject),
    [ID],
  );
});
test('different match ID or roster lacking own account fails closed', () => {
  assert.throws(
    () => normalizeLiveEquipment({ ...loadouts(), MatchID: SKIN }, game(), ID, cat()),
    code('MATCH_SCOPE'),
  );
  assert.throws(
    () =>
      normalizeLiveEquipment(loadouts(), { ...game(), players: [game().players[1]] }, ID, cat()),
    code('MATCH_SCOPE'),
  );
});
test('unknown cosmetics are not misrepresented as owned or equipped known skins', () => {
  const r = loadouts();
  r.Loadouts[0].Loadout.Items[GUN].Sockets = { bad: { Item: { ID: MATCH } } };
  const w = normalizeLiveEquipment(r, game(), ID, cat()).players[0].weapons[0];
  assert.equal(w.weapon, 'Vandal');
  assert.equal(w.skin, undefined);
});
test('invalid response is distinct from an explicitly empty returned cosmetics list', () => {
  assert.throws(() => normalizeLiveEquipment({}, game(), ID, cat()), code('SCHEMA'));
  assert.deepEqual(normalizeLiveEquipment({ Loadouts: [] }, game(), ID, cat()).players, []);
});
test('client sends a read-only request to own current-match cosmetics endpoint', async () => {
  const calls = [],
    c = new RiotClient(
      session(),
      new HttpClient(async (url, init) => {
        calls.push({ url, method: init.method });
        return response(loadouts());
      }),
      { version: async () => 'release-fixture-1' },
      cat(),
    );
  c.liveGame = async () => game();
  const r = await c.liveEquipment(MATCH);
  assert.equal(r.players.length, 2);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, new RegExp('/core-game/v1/matches/' + MATCH + '/loadouts$'));
  assert.equal(calls[0].method, 'GET');
});
test('client rejects an arbitrary match before any cosmetics request', async () => {
  let n = 0;
  const c = new RiotClient(
    session(),
    new HttpClient(async () => {
      n++;
      return response(loadouts());
    }),
    { version: async () => 'release-fixture-1' },
    cat(),
  );
  c.liveGame = async () => game();
  await assert.rejects(c.liveEquipment(SKIN), code('MATCH_SCOPE'));
  assert.equal(n, 0);
});
const compiled = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/platform/runtime.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;
function runtimeFixture() {
  let now = Date.now(),
    calls = 0,
    fail,
    hold;
  const gates = new Map();
  const repo = {
    refreshGate: async (id, k) => gates.get(id + ':' + k) || null,
    saveRefreshGate: async (id, k, g) => gates.set(id + ':' + k, structuredClone(g)),
  };
  const m = { exports: {} },
    load = (name) => {
      if (name === 'react-native') return { Platform: { OS: 'android' } };
      if (name === './network') return { nativeFetcher: fetch };
      if (name === './secure') return { vault: {}, randomHex: () => 'a'.repeat(64) };
      if (name === './chatStorage')
        return { activateChatStorage() {}, removeChatStorage: async () => {} };
      if (name === './storage') return { openRepository: async () => repo };
      if (name === './notifications')
        return {
          cancelAccountNotifications: async () => {},
          updateStoreNotifications: async () => {},
        };
      if (name.startsWith('../core/'))
        return require(path.join(__dirname, '../.test-build', name.slice(8) + '.js'));
      throw Error(name);
    };
  vm.runInThisContext('(function(require,module,exports){' + compiled + '\n})')(load, m, m.exports);
  const create = () => {
    const r = new m.exports.Runtime(repo, () => now);
    r.loadCatalog = async () => cat();
    r.live = async () => ({ status: 'ready', data: game(), fetchedAt: now });
    r.client = async () => ({
      liveEquipment: async () => {
        calls++;
        if (hold) await hold;
        if (fail) throw fail;
        return normalizeLiveEquipment(loadouts(), game(), ID, cat(), now);
      },
    });
    return r;
  };
  return {
    runtime: create(),
    create,
    gates,
    get calls() {
      return calls;
    },
    advance: (ms) => (now += ms),
    fail: (e) => (fail = e),
    hold() {
      let release;
      hold = new Promise((r) => (release = r));
      return () => {
        release();
        hold = undefined;
      };
    },
    get now() {
      return now;
    },
  };
}
test('all player skin screens share one request while in flight', async () => {
  const f = runtimeFixture(),
    release = f.hold();
  const a = f.runtime.liveEquipment(ID, MATCH),
    b = f.runtime.liveEquipment(ID, MATCH);
  release();
  await Promise.all([a, b]);
  assert.equal(f.calls, 1);
});
test('cosmetic request cooldown survives a runtime restart', async () => {
  const f = runtimeFixture();
  await f.runtime.liveEquipment(ID, MATCH);
  await f.create().liveEquipment(ID, MATCH);
  assert.equal(f.calls, 1);
  f.advance(60001);
  await f.runtime.liveEquipment(ID, MATCH);
  assert.equal(f.calls, 2);
});
test('Riot Retry-After limits apply to live equipment without automatic retries', async () => {
  const f = runtimeFixture();
  f.fail(new AppError('RATE_LIMIT', 'Wait', f.now + 600000, 429));
  const r = await f.runtime.liveEquipment(ID, MATCH);
  assert.equal(r.code, 'RATE_LIMIT');
  f.advance(60001);
  await f.create().liveEquipment(ID, MATCH);
  assert.equal(f.calls, 1);
});
test('old match route does not get the next matches equipment', async () => {
  const f = runtimeFixture();
  const r = await f.runtime.liveEquipment(ID, SKIN);
  assert.equal(r.code, 'MATCH_SCOPE');
  assert.equal(f.calls, 0);
});
