const test = require('node:test'),
  assert = require('node:assert/strict');
const { BrowseMemory } = require('../.test-build/browseMemory.js');
const { ID, OTHER } = require('./helpers.cjs');
for (const kind of ['skin', 'buddy', 'spray', 'card', 'title', 'chroma', 'agent'])
  test(kind + ': return navigation retains scope, search, weapon and scroll', () => {
    const memory = new BrowseMemory(),
      route = { type: 'collection', kind };
    const view = memory.collection(ID, route, kind, 'owned');
    Object.assign(view, {
      scope: 'catalog',
      query: 'example',
      weapon: kind === 'skin' ? 'Vandal' : 'all',
      offset: 780,
    });
    memory.markets(ID, { type: 'market-history' });
    const back = memory.collection(ID, route, kind, 'owned');
    assert.equal(back, view);
    assert.equal(back.scope, 'catalog');
    assert.equal(back.offset, 780);
    assert.equal(back.query, 'example');
    back.scope = 'wishlist';
    assert.equal(memory.collection(ID, route).scope, 'wishlist');
  });
test('different stack entries with the same category do not share browse state', () => {
  const m = new BrowseMemory(),
    a = {},
    b = {};
  const first = m.collection(ID, a, 'skin', 'catalog');
  first.query = 'One';
  const second = m.collection(ID, b, 'skin', 'catalog');
  assert.notEqual(first.navigationId, second.navigationId);
  assert.equal(second.query, '');
});
test('switching accounts outside a collection route clears its old browse state', () => {
  const m = new BrowseMemory(),
    route = {};
  m.collection(ID, route).scope = 'wishlist';
  m.syncAccount(OTHER);
  m.syncAccount(ID);
  assert.equal(m.collection(ID, route).scope, 'owned');
});
test('Saved Stores filters and offsets survive an item-detail roundtrip', () => {
  const m = new BrowseMemory(),
    route = {};
  const view = m.markets(ID, route);
  view.filter = 'bundle';
  view.offset = 500;
  m.collection(ID, {});
  assert.equal(m.markets(ID, route), view);
  assert.equal(view.filter, 'bundle');
  assert.equal(view.offset, 500);
});
