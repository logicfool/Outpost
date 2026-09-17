const test = require('node:test'),
  assert = require('node:assert/strict');
const { ID, OTHER, session, response, code } = require('./helpers.cjs');
const {
  ownedBuddies,
  applyBuddyChoices,
  equippedBuddy,
  MELEE_ID,
  BUDDY_TYPE,
} = require('../.test-build/buddies.js');
const { preparePreset, validatePreset, verifyPreset } = require('../.test-build/presets.js');
const { buildCatalog } = require('../.test-build/catalog.js');
const { RiotClient } = require('../.test-build/riot.js'),
  { HttpClient } = require('../.test-build/http.js');
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const buddy = { buddyId: U(10), levelId: U(11), instanceId: U(12) };
const catalog = () =>
  buildCatalog({
    buddies: {
      data: [
        {
          uuid: U(10),
          displayName: 'Fixture buddy',
          levels: [{ uuid: U(11), displayName: 'Level 1' }],
        },
      ],
    },
  });
const inventory = () => ({
  ItemTypeID: BUDDY_TYPE,
  Entitlements: [
    { ItemID: U(11), InstanceID: U(12) },
    { ItemID: U(11), InstanceID: U(13) },
  ],
});
const gun = (n) => ({
  ID: U(n),
  SkinID: U(2),
  SkinLevelID: U(3),
  ChromaID: U(4),
  Attachments: ['kept'],
  unknownFlag: true,
});
const raw = () => ({
  Subject: ID,
  Version: 7,
  Guns: [gun(1), gun(5)],
  Identity: { PlayerCardID: U(20) },
  ActiveExpressions: [{ Type: 'spray', ID: U(21) }],
  Incognito: true,
});
const choice = (buddyValue) => ({
  weaponId: U(1),
  skinId: U(2),
  levelId: U(3),
  chromaId: U(4),
  ...(buddyValue === undefined ? {} : { buddy: buddyValue }),
});
const preset = (value) => ({
  id: U(30),
  accountId: ID,
  name: 'Saved',
  weapons: [choice(value)],
  updatedAt: 1,
});
test('buddy metadata keeps both canonical identity and level aliases', () => {
  const c = catalog();
  assert.equal(c.items[U(11)].canonicalId, U(10));
  assert.equal(c.items[U(10)].levels[0].id, U(11));
});
test('inventory keeps multiple owned copies distinct', () => {
  const copies = ownedBuddies(inventory(), catalog());
  assert.equal(copies.length, 2);
  assert.equal(copies[0].levelId, U(11));
  assert.equal(copies[1].instanceId, U(13));
});
test('missing instance IDs are not fabricated from quantities or catalog IDs', () => {
  assert.deepEqual(ownedBuddies({ Entitlements: [{ ItemID: U(11) }] }, catalog()), []);
});
test('wrong buddy inventory category fails before mutation', () =>
  assert.throws(
    () => ownedBuddies({ ...inventory(), ItemTypeID: OTHER }, catalog()),
    code('SCHEMA'),
  ));
test('equip alters three charm fields and leaves skins and attachments untouched', () => {
  const before = raw(),
    out = applyBuddyChoices(
      before.Guns,
      new Map([[U(1), { buddy }]]),
      ownedBuddies(inventory(), catalog()),
    );
  assert.deepEqual(equippedBuddy(out[0]), buddy);
  assert.equal(out[0].SkinID, before.Guns[0].SkinID);
  assert.deepEqual(out[0].Attachments, ['kept']);
  assert.equal(before.Guns[0].CharmID, undefined);
});
test('remove omits charm fields, preserving the remainder of the gun', () => {
  const g = { ...gun(1), CharmID: U(10), CharmLevelID: U(11), CharmInstanceID: U(12) };
  const out = applyBuddyChoices([g], new Map([[U(1), { buddy: null }]]), []);
  assert.equal(Object.hasOwn(out[0], 'CharmID'), false);
  assert.equal(equippedBuddy(out[0]), null);
  assert.equal(out[0].unknownFlag, true);
});
test('old presets without buddy fields preserve currently equipped buddy', () => {
  const r = raw();
  Object.assign(r.Guns[0], { CharmID: U(10), CharmLevelID: U(11), CharmInstanceID: U(12) });
  assert.deepEqual(
    equippedBuddy(preparePreset(r, preset(), ID, new Set(), new Set(), catalog()).Guns[0]),
    buddy,
  );
});
test('new preset persists explicit removal and verifies absence in readback', () => {
  const p = validatePreset(preset(null), ID);
  assert.equal(p.weapons[0].buddy, null);
  const out = preparePreset(raw(), p, ID, new Set(), new Set(), catalog());
  assert.doesNotThrow(() => verifyPreset(out, p.weapons));
});
test('same owned buddy copy cannot be reused on two guns', () => {
  const r = raw();
  Object.assign(r.Guns[1], { CharmID: U(10), CharmLevelID: U(11), CharmInstanceID: U(12) });
  assert.throws(
    () =>
      applyBuddyChoices(r.Guns, new Map([[U(1), { buddy }]]), ownedBuddies(inventory(), catalog())),
    code('BUDDY_IN_USE'),
  );
});
test('explicit preset move is valid when the old slot is explicitly cleared', () => {
  const r = raw();
  Object.assign(r.Guns[1], { CharmID: U(10), CharmLevelID: U(11), CharmInstanceID: U(12) });
  const out = applyBuddyChoices(
    r.Guns,
    new Map([
      [U(1), { buddy }],
      [U(5), { buddy: null }],
    ]),
    ownedBuddies(inventory(), catalog()),
  );
  assert.equal(equippedBuddy(out[1]), null);
  assert.equal(equippedBuddy(out[0]).instanceId, U(12));
});
test('unowned and mismatched-level instances are denied', () => {
  assert.throws(
    () =>
      applyBuddyChoices(
        [gun(1)],
        new Map([[U(1), { buddy: { ...buddy, levelId: U(99) } }]]),
        ownedBuddies(inventory(), catalog()),
      ),
    code('BUDDY_NOT_OWNED'),
  );
});
test('melee buddy mutation is denied', () =>
  assert.throws(
    () =>
      applyBuddyChoices([{ ...gun(1), ID: MELEE_ID }], new Map([[MELEE_ID, { buddy: null }]]), []),
    code('BUDDY_MELEE'),
  ));
function fixture() {
  let current = raw(),
    puts = 0,
    reads = 0,
    changed = false,
    wrong = false,
    uncertain = false;
  const c = new RiotClient(
    session(),
    new HttpClient(async (url, init) => {
      if (url.includes('/entitlements/')) return response(inventory());
      if (init.method === 'PUT') {
        puts++;
        if (uncertain) throw Error('network');
        if (!wrong) current = { ...current, ...JSON.parse(init.body), Version: 8 };
        return response(current);
      }
      reads++;
      if (changed && reads === 2) current.Version++;
      return response(current);
    }),
    { version: async () => 'release-fixture' },
    catalog(),
  );
  return {
    c,
    get current() {
      return current;
    },
    get puts() {
      return puts;
    },
    conflict: () => (changed = true),
    wrong: () => (wrong = true),
    uncertain: () => (uncertain = true),
  };
}
test('direct buddy equip performs one PUT and readback on own v3 loadout', async () => {
  const f = fixture();
  await f.c.saveBuddy(U(1), buddy, 7);
  assert.equal(f.puts, 1);
  assert.deepEqual(equippedBuddy(f.current.Guns[0]), buddy);
  assert.equal(f.current.Incognito, true);
  assert.equal(f.current.Guns[0].SkinID, U(2));
});
test('stale editor version stops before changing anything', async () => {
  const f = fixture();
  await assert.rejects(f.c.saveBuddy(U(1), buddy, 6), code('LOADOUT_CONFLICT'));
  assert.equal(f.puts, 0);
});
test('intervening client edit stops before mutation', async () => {
  const f = fixture();
  f.conflict();
  await assert.rejects(f.c.saveBuddy(U(1), buddy, 7), code('LOADOUT_CONFLICT'));
  assert.equal(f.puts, 0);
});
test('successful status without confirmed buddy readback remains unconfirmed', async () => {
  const f = fixture();
  f.wrong();
  await assert.rejects(f.c.saveBuddy(U(1), buddy, 7), code('SAVE_UNCONFIRMED'));
  assert.equal(f.puts, 1);
});
test('uncertain buddy write is not automatically repeated', async () => {
  const f = fixture();
  f.uncertain();
  await assert.rejects(f.c.saveBuddy(U(1), buddy, 7));
  assert.equal(f.puts, 1);
});

test('account-change guard aborts buddy write immediately before dispatch', async () => {
  const f = fixture();
  await assert.rejects(
    f.c.saveBuddy(U(1), buddy, 7, () => {
      throw Object.assign(new Error('Changed'), { code: 'ACCOUNT_CHANGED' });
    }),
    (e) => e.code === 'ACCOUNT_CHANGED',
  );
  assert.equal(f.puts, 0);
});
