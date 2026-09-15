const test = require('node:test'),
  assert = require('node:assert/strict');
const {
  preparePreset,
  validatePreset,
  verifyPreset,
  weaponChoices,
} = require('../.test-build/presets.js');
const { ID, OTHER, code } = require('./helpers.cjs');
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const gun = {
  ID: U(1),
  SkinID: U(2),
  SkinLevelID: U(3),
  ChromaID: U(4),
  CharmID: U(15),
  CharmInstanceID: U(16),
  unknownFlag: true,
};
const raw = () => ({
  Guns: [{ ...gun }],
  Version: 7,
  Identity: { PlayerCardID: U(20), PlayerTitleID: U(21), HideAccountLevel: true },
  ActiveExpressions: [{ Type: 'spray', ID: U(22) }],
  Incognito: true,
});
const desired = { weaponId: U(1), skinId: U(5), levelId: U(6), chromaId: U(7) };
const preset = () => ({
  id: U(10),
  accountId: ID,
  name: 'Evening',
  weapons: [{ ...desired }],
  updatedAt: 1,
});
const catalog = {
  items: {
    [U(5)]: {
      id: U(5),
      canonicalId: U(5),
      name: 'Owned skin',
      kind: 'skin',
      weaponId: U(1),
      levels: [{ id: U(6) }],
      chromas: [{ id: U(7) }, { id: U(8) }],
    },
  },
};
test('apply preset changes only selected skin fields and preserves buddies and privacy', () => {
  const r = raw(),
    out = preparePreset(r, preset(), ID, new Set([U(6)]), new Set(), catalog);
  assert.equal(out.Guns[0].SkinID, U(5));
  assert.equal(out.Guns[0].CharmInstanceID, U(16));
  assert.equal(out.Guns[0].unknownFlag, true);
  assert.deepEqual(out.Identity, r.Identity);
  assert.deepEqual(out.ActiveExpressions, r.ActiveExpressions);
  assert.equal(out.Incognito, true);
  assert.equal(r.Guns[0].SkinID, U(2));
});
test('foreign account preset and duplicate weapon entries are rejected', () => {
  assert.throws(() => validatePreset(preset(), OTHER), code('ACCOUNT_MISMATCH'));
  const p = preset();
  p.weapons.push({ ...desired });
  assert.throws(() => validatePreset(p, ID), code('PRESET_INVALID'));
});
test('unowned skin levels and colour upgrades cannot be applied', () => {
  assert.throws(
    () => preparePreset(raw(), preset(), ID, new Set(), new Set(), catalog),
    code('ITEM_NOT_OWNED'),
  );
  const p = preset();
  p.weapons[0].chromaId = U(8);
  assert.throws(
    () => preparePreset(raw(), p, ID, new Set([U(6)]), new Set(), catalog),
    code('ITEM_NOT_OWNED'),
  );
});
test('skin and level must belong to the exact target weapon', () => {
  const p = preset();
  p.weapons[0].levelId = U(99);
  assert.throws(
    () => preparePreset(raw(), p, ID, new Set([U(99)]), new Set(), catalog),
    code('PRESET_CATALOG'),
  );
});
test('unchanged current defaults do not need a fabricated entitlement', () => {
  const p = preset();
  p.weapons = weaponChoices(raw());
  assert.equal(preparePreset(raw(), p, ID, new Set(), new Set(), catalog).Guns[0].SkinID, U(2));
});
test('readback requires every selected weapon slot to match', () => {
  assert.throws(() => verifyPreset(raw(), [desired]), code('SAVE_UNCONFIRMED'));
  const updated = preparePreset(raw(), preset(), ID, new Set([U(6)]), new Set(), catalog);
  assert.doesNotThrow(() => verifyPreset(updated, [desired]));
});
test('invalid shape or empty name is refused before a mutation', () => {
  assert.throws(() => validatePreset({ ...preset(), name: '  ' }, ID), code('PRESET_INVALID'));
  assert.throws(
    () =>
      preparePreset(
        { ...raw(), ActiveExpressions: undefined },
        preset(),
        ID,
        new Set([U(6)]),
        new Set(),
        catalog,
      ),
    code('SCHEMA'),
  );
});

const { RiotClient } = require('../.test-build/riot.js'),
  { HttpClient } = require('../.test-build/http.js');
const { session, response } = require('./helpers.cjs');
function apiFixture() {
  let current = raw(),
    reads = 0,
    puts = 0,
    conflict = false;
  const requests = [];
  const meta = {
    ...catalog,
    items: { ...catalog.items, [U(6)]: { ...catalog.items[U(5)], id: U(6) } },
    maps: {},
    tiers: {},
    bundles: {},
    contracts: {},
  };
  const client = new RiotClient(
    session(),
    new HttpClient(async (url, init) => {
      requests.push({ url, method: init.method, body: init.body });
      if (url.includes('/entitlements/'))
        return response({
          Subject: ID,
          Entitlements: url.includes('e7c63390') ? [{ ItemID: U(6) }] : [],
        });
      if (init.method === 'PUT') {
        puts++;
        current = { ...current, ...JSON.parse(init.body), Version: 8 };
        return response(current);
      }
      reads++;
      if (conflict && reads === 2) current = { ...current, Version: 9 };
      return response(current);
    }),
    { version: async () => 'release-fixture' },
    meta,
  );
  return {
    client,
    requests,
    get puts() {
      return puts;
    },
    get current() {
      return current;
    },
    conflict() {
      conflict = true;
    },
  };
}
test('native service applies v3 preset once and verifies the returned weapon skin', async () => {
  const h = apiFixture(),
    result = await h.client.applyPreset(preset());
  assert.equal(h.puts, 1);
  assert.equal(result.guns[0].skin.id, U(6));
  assert.ok(
    h.requests
      .filter((r) => r.method === 'PUT')
      .every((r) => r.url.includes('/personalization/v3/')),
  );
  assert.equal(h.current.Guns[0].CharmID, U(15));
});
test('a concurrent game-client version change aborts before preset PUT', async () => {
  const h = apiFixture();
  h.conflict();
  await assert.rejects(h.client.applyPreset(preset()), code('LOADOUT_CONFLICT'));
  assert.equal(h.puts, 0);
});
