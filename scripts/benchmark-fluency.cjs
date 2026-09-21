// Controlled JS-work benchmark, not native startup time or a device FPS measurement.
// Run after npm test has compiled .test-build: node scripts/benchmark-fluency.cjs
const assert = require('node:assert/strict'),
  { performance } = require('node:perf_hooks');
const { ownedBrowse, catalogueBrowse } = require('../.test-build/catalogBrowse.js');
const { hydrateItem } = require('../.test-build/catalog.js');
const { sharedViewStyles } = require('../.test-build/viewCache.js');
const { sameScreenModel } = require('../.test-build/screenInputs.js');
const items = {},
  owned = [];
for (let i = 0; i < 12000; i++) {
  const id = String(i).padStart(32, '0'),
    item = {
      id,
      canonicalId: id,
      kind: i % 2 ? 'card' : 'skin',
      name: 'Fixture ' + String(12000 - i).padStart(5, '0'),
      weapon: i % 2 ? undefined : 'Vandal',
    };
  items[id] = item;
  if (i < 300) owned.push(item);
}
let enumerations = 0;
const catalog = {
  items: new Proxy(items, {
    ownKeys(target) {
      enumerations++;
      return Reflect.ownKeys(target);
    },
  }),
};
// The previous CollectionBrowser always prepared all public items before showing Owned.
function before() {
  const all = [
    ...new Map(
      Object.values(catalog.items).map((i) => [
        i.kind === 'chroma' ? i.id : `${i.kind}:${i.canonicalId}`,
        i.kind === 'chroma' ? i : { ...i, id: i.canonicalId },
      ]),
    ).values(),
  ];
  const weapons = [
    ...new Set(all.filter((i) => i.kind === 'skin' && i.weapon).map((i) => i.weapon)),
  ].sort();
  const result = owned
    .map((i) => hydrateItem(catalog, i))
    .filter((i) => i.kind !== 'chroma' && i.kind !== 'currency')
    .sort((a, b) => a.name.localeCompare(b.name));
  return { result, weapons };
}
const quantiles = (times) => {
  const s = [...times].sort((a, b) => a - b);
  return {
    medianMs: +s[Math.floor(s.length / 2)].toFixed(3),
    p95Ms: +s[Math.floor((s.length - 1) * 0.95)].toFixed(3),
  };
};
const run = (fn) => {
  const times = [];
  for (let i = 0; i < 25; i++) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }
  return quantiles(times);
};
const expected = before().result.map((i) => i.id);
enumerations = 0;
const original = run(before),
  originalScans = enumerations;
enumerations = 0;
const optimized = run(() => ownedBrowse(owned, catalog)),
  optimizedScans = enumerations;
assert.deepEqual(
  ownedBrowse(owned, catalog).map((i) => i.id),
  expected,
);
let builds = 0;
const factory = (palette) => {
  builds++;
  return Object.fromEntries(
    Array.from({ length: 90 }, (_, i) => ['style' + i, { color: palette.ink, padding: i % 16 }]),
  );
};
const palette = { ink: '#ffffff' };
const originalStyles = run(() => {
    for (let i = 0; i < 100; i++) factory(palette);
  }),
  originalBuilds = builds;
builds = 0;
const optimizedStyles = run(() => {
    for (let i = 0; i < 100; i++) sharedViewStyles(factory, palette);
  }),
  optimizedBuilds = builds;
const store = { status: 'ready', data: {} },
  model = { snapshot: { accountId: 'fixture', store, liveGame: { state: 'idle' } } };
let storeUpdates = 0;
for (let i = 0; i < 120; i++) {
  const next = { ...model, snapshot: { ...model.snapshot, liveGame: { counter: i } } };
  if (!sameScreenModel('store', model, next)) storeUpdates++;
}
assert.equal(storeUpdates, 0);
console.log(
  JSON.stringify(
    {
      environment: 'Node.js ' + process.version,
      kind: 'synthetic JS-work benchmark; not device FPS or real network timing',
      catalogueItems: 12000,
      ownedItems: 300,
      repetitions: 25,
      ownedReopen: {
        before: { ...original, fullCatalogueScans: originalScans },
        after: { ...optimized, fullCatalogueScans: optimizedScans },
        sameItemOrder: true,
      },
      styleConstruction: {
        before: { ...originalStyles, factoryCalls: originalBuilds },
        after: { ...optimizedStyles, factoryCalls: optimizedBuilds },
      },
      unrelatedLiveTicks: 120,
      unnecessaryStoreUpdates: storeUpdates,
    },
    null,
    2,
  ),
);
