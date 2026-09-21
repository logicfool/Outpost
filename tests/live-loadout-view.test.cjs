const test = require('node:test'),
  assert = require('node:assert/strict');
const {
  liveLoadoutRows,
  liveLoadoutCategories,
  liveWeaponLabels,
} = require('../.test-build/liveLoadoutView.js');
const { catalog, SKIN, LEVEL } = require('./helpers.cjs');
const GUN = '66666666-6666-4666-8666-666666666666',
  PISTOL = '77777777-7777-4777-8777-777777777777';
const data = () => {
  const c = catalog();
  c.items[SKIN] = {
    ...c.items[SKIN],
    weaponId: GUN,
    name: 'Fixture Vandal',
    levels: [
      { id: LEVEL, name: 'Level 1' },
      { id: 'level-2', name: 'Level 2' },
    ],
  };
  return {
    c,
    rows: [
      {
        weaponId: GUN,
        weapon: 'Vandal',
        category: 'EEquippableCategory::Rifle',
        skin: c.items[SKIN],
        levelId: 'level-2',
        buddy: { name: 'Lucky charm' },
      },
      { weaponId: PISTOL, weapon: 'Classic', category: 'EEquippableCategory::Sidearm' },
    ],
  };
};
test('loadout categories group weapons locally without inventing missing cosmetics', () => {
  const { c, rows } = data();
  assert.deepEqual(liveLoadoutCategories(rows, c), ['All', 'Sidearms', 'Rifles']);
  assert.equal(liveLoadoutRows(rows, c)[0].weapon, 'Classic');
  assert.equal(liveWeaponLabels(rows[1], c).name, 'Skin not reported');
});
test('search includes weapon, selected skin and buddy names', () => {
  const { c, rows } = data();
  assert.equal(liveLoadoutRows(rows, c, 'All', 'lucky')[0].weapon, 'Vandal');
  assert.equal(liveLoadoutRows(rows, c, 'Sidearms', 'vandal').length, 0);
  assert.equal(liveLoadoutRows(rows, c, 'All', 'classic').length, 1);
});
test('selected upgrade level is derived from returned level id, not its display name', () => {
  const { c, rows } = data();
  assert.equal(liveWeaponLabels(rows[0], c).levelLabel, 'Level 2');
  assert.equal(liveWeaponLabels({ ...rows[0], levelId: 'absent' }, c).levelLabel, undefined);
});
