const test = require('node:test'),
  assert = require('node:assert/strict');
const { ID, session, response, code } = require('./helpers.cjs');
const {
  spraySlots,
  ownedSprays,
  prepareSprayEdit,
  verifySprayEdit,
  sprayArrayKey,
  SPRAY_TYPE,
} = require('../.test-build/sprays.js');
const { RiotClient } = require('../.test-build/riot.js'),
  { HttpClient } = require('../.test-build/http.js');

const S = (n) => `00000000-0000-4000-800a-${String(n).padStart(12, '0')}`;
const SLOT = (n) => `00000000-0000-4000-800b-${String(n).padStart(12, '0')}`;
const EMPTY = '00000000-0000-0000-0000-000000000000';
const catalog = () => ({
  items: Object.fromEntries(
    [1, 2, 3, 4].map((n) => [
      S(n),
      { id: S(n), canonicalId: S(n), name: `Spray ${n}`, kind: 'spray' },
    ]),
  ),
  bundles: {},
  maps: {},
  tiers: {},
  contracts: {},
  fetchedAt: 0,
});
const inventory = (ids = [1, 2, 3]) => ({
  ItemTypeID: SPRAY_TYPE,
  Entitlements: ids.map((n) => ({ ItemID: S(n) })),
});
const gun = { ID: S(9), SkinID: S(9), SkinLevelID: S(9), ChromaID: S(9), Attachments: ['kept'] };
const raw = (extra = {}) => ({
  Subject: ID,
  Version: 7,
  Guns: [gun],
  Sprays: [
    { EquipSlotID: SLOT(1), SprayID: S(1), SprayLevelID: null },
    { EquipSlotID: SLOT(2), SprayID: S(2), SprayLevelID: null, unknownFlag: true },
    { EquipSlotID: SLOT(3), SprayID: EMPTY, SprayLevelID: null },
  ],
  Identity: { PlayerCardID: S(8), PlayerTitleID: S(8), AccountLevel: 240 },
  Incognito: false,
  ...extra,
});
const v3 = () => {
  const { Sprays, ...rest } = raw();
  return {
    ...rest,
    ActiveExpressions: Sprays.map((s) => ({ TypeID: s.EquipSlotID, AssetID: s.SprayID })),
  };
};
const owned = new Set([1, 2, 3].map(S));

test('slots are read in wheel order with the labels the game uses', () => {
  const slots = spraySlots(raw(), catalog());
  assert.deepEqual(
    slots.map((s) => s.label),
    ['Pre-round', 'Mid-round', 'Post-round'],
  );
  assert.equal(slots[0].sprayId, S(1));
  assert.equal(slots[0].item.name, 'Spray 1');
  assert.equal(slots[2].sprayId, null);
  assert.equal(slots[2].item, undefined);
});
test('the v3 ActiveExpressions shape is read through the same slots', () => {
  assert.equal(sprayArrayKey(v3()), 'ActiveExpressions');
  assert.deepEqual(
    spraySlots(v3(), catalog()).map((s) => s.sprayId),
    [S(1), S(2), null],
  );
});
test('a loadout with neither spray array is a schema error', () => {
  assert.throws(() => sprayArrayKey({ Guns: [] }), code('SCHEMA'));
});
test('owned sprays come from the spray entitlement category only', () => {
  assert.deepEqual(
    ownedSprays(inventory(), catalog()).map((s) => s.name),
    ['Spray 1', 'Spray 2', 'Spray 3'],
  );
  assert.throws(
    () => ownedSprays({ ItemTypeID: S(7), Entitlements: [] }, catalog()),
    code('SCHEMA'),
  );
  assert.deepEqual(ownedSprays({ ItemTypeID: SPRAY_TYPE, Entitlements: [] }, catalog()), []);
});

test('equipping one slot leaves every other slot and unrelated field untouched', () => {
  const body = prepareSprayEdit(raw(), [{ slotIndex: 2, sprayId: S(3) }], owned, 7);
  assert.equal(body.Sprays[2].SprayID, S(3));
  assert.equal(body.Sprays[2].EquipSlotID, SLOT(3));
  assert.deepEqual(body.Sprays[0], { EquipSlotID: SLOT(1), SprayID: S(1), SprayLevelID: null });
  assert.equal(body.Sprays[1].unknownFlag, true);
  assert.deepEqual(body.Guns, [gun]);
  assert.equal(body.Incognito, false);
  assert.equal(body.Identity.PlayerTitleID, S(8));
});
test('clearing a slot writes the empty identifier rather than dropping the slot', () => {
  const body = prepareSprayEdit(raw(), [{ slotIndex: 0, sprayId: null }], owned, 7);
  assert.equal(body.Sprays.length, 3);
  assert.equal(body.Sprays[0].SprayID, EMPTY);
  assert.equal(body.Sprays[0].EquipSlotID, SLOT(1));
});
test('a v3 loadout is edited in its own field without inventing a Sprays array', () => {
  const body = prepareSprayEdit(v3(), [{ slotIndex: 0, sprayId: S(3) }], owned, 7);
  assert.equal(body.ActiveExpressions[0].AssetID, S(3));
  assert.equal(body.ActiveExpressions[0].TypeID, SLOT(1));
  assert.equal(body.Sprays, undefined);
});
test('unowned sprays, unknown slots, duplicate slots and no selection are refused', () => {
  assert.throws(
    () => prepareSprayEdit(raw(), [{ slotIndex: 0, sprayId: S(4) }], owned, 7),
    code('ITEM_NOT_OWNED'),
  );
  assert.throws(
    () => prepareSprayEdit(raw(), [{ slotIndex: 9, sprayId: S(1) }], owned, 7),
    code('SPRAY_SLOT'),
  );
  assert.throws(
    () => prepareSprayEdit(raw(), [{ slotIndex: -1, sprayId: S(1) }], owned, 7),
    code('SPRAY_SLOT'),
  );
  assert.throws(
    () =>
      prepareSprayEdit(
        raw(),
        [
          { slotIndex: 0, sprayId: S(1) },
          { slotIndex: 0, sprayId: S(2) },
        ],
        owned,
        7,
      ),
    code('SPRAY_SLOT'),
  );
  assert.throws(() => prepareSprayEdit(raw(), [], owned, 7), code('NO_CHANGE'));
});
test('the same spray cannot fill two wheel slots', () => {
  assert.throws(
    () => prepareSprayEdit(raw(), [{ slotIndex: 2, sprayId: S(1) }], owned, 7),
    code('SPRAY_IN_USE'),
  );
  assert.doesNotThrow(() =>
    prepareSprayEdit(
      raw(),
      [
        { slotIndex: 0, sprayId: S(3) },
        { slotIndex: 2, sprayId: S(1) },
      ],
      owned,
      7,
    ),
  );
});
test('a stale loadout version stops before anything is changed', () => {
  assert.throws(
    () => prepareSprayEdit(raw(), [{ slotIndex: 0, sprayId: S(3) }], owned, 6),
    code('LOADOUT_CONFLICT'),
  );
});
test('an incomplete loadout is refused rather than partially rebuilt', () => {
  assert.throws(
    () => prepareSprayEdit(raw({ Guns: undefined }), [{ slotIndex: 0, sprayId: S(3) }], owned),
    code('SCHEMA'),
  );
  assert.throws(
    () => prepareSprayEdit(raw({ Incognito: undefined }), [{ slotIndex: 0, sprayId: S(3) }], owned),
    code('SCHEMA'),
  );
});
test('readback confirms every slot Riot returned', () => {
  const body = prepareSprayEdit(raw(), [{ slotIndex: 0, sprayId: S(3) }], owned, 7);
  assert.doesNotThrow(() => verifySprayEdit({ Sprays: body.Sprays }, body));
  assert.throws(() => verifySprayEdit(raw(), body), code('SAVE_UNCONFIRMED'));
  assert.throws(
    () => verifySprayEdit({ Sprays: body.Sprays.slice(0, 2) }, body),
    code('SAVE_UNCONFIRMED'),
  );
});

function fixture() {
  let current = raw(),
    puts = 0,
    wrong = false;
  const client = new RiotClient(
    session(),
    new HttpClient(async (url, init) => {
      if (url.includes('/entitlements/')) return response(inventory());
      if (init.method === 'PUT') {
        puts++;
        if (!wrong) current = { ...current, ...JSON.parse(init.body), Version: 8 };
        return response(current);
      }
      return response(current);
    }),
    { version: async () => 'release-fixture' },
    catalog(),
  );
  return {
    client,
    get current() {
      return current;
    },
    get puts() {
      return puts;
    },
    wrong: () => {
      wrong = true;
    },
  };
}

test('the editor reads the current slots and the owned sprays together', async () => {
  const editor = await fixture().client.sprayEditor();
  assert.deepEqual(
    editor.slots.map((s) => s.label),
    ['Pre-round', 'Mid-round', 'Post-round'],
  );
  assert.deepEqual(
    editor.owned.map((s) => s.name),
    ['Spray 1', 'Spray 2', 'Spray 3'],
  );
  assert.equal(editor.version, 7);
});
test('saving sprays performs one write and confirms the readback', async () => {
  const f = fixture();
  await f.client.saveSprays([{ slotIndex: 2, sprayId: S(3) }], 7);
  assert.equal(f.puts, 1);
  assert.equal(f.current.Sprays[2].SprayID, S(3));
  assert.deepEqual(f.current.Guns, [gun]);
});
test('an unconfirmed readback is reported and never retried', async () => {
  const f = fixture();
  f.wrong();
  await assert.rejects(
    f.client.saveSprays([{ slotIndex: 2, sprayId: S(3) }], 7),
    code('SAVE_UNCONFIRMED'),
  );
  assert.equal(f.puts, 1);
});
test('an account change immediately before dispatch stops the spray write', async () => {
  const f = fixture();
  await assert.rejects(
    f.client.saveSprays([{ slotIndex: 2, sprayId: S(3) }], 7, () => {
      throw Object.assign(new Error('Changed'), { code: 'ACCOUNT_CHANGED' });
    }),
    (e) => e.code === 'ACCOUNT_CHANGED',
  );
  assert.equal(f.puts, 0);
});
