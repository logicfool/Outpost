const test = require('node:test'),
  assert = require('node:assert/strict');
const { DiagnosticRedactor } = require('../.test-build/diagnosticRedaction.js');
const { buildCatalog, buildCatalogAsync } = require('../.test-build/catalog.js');
const { drainCooperatively } = require('../.test-build/cooperative.js');
const secret = 'synthetic-credential-not-a-real-token';
const rows = Array.from({ length: 1800 }, (_, i) => ({
  id: i,
  name: 'Public item ' + i,
  url: 'https://media.valorant-api.com/example/' + i + '.png',
  echo: secret,
}));
test('cooperative work releases the event loop before processing starts', async () => {
  let phase = 'pending';
  setTimeout(() => (phase = 'touch handled'), 0);
  const result = await drainCooperatively(
    (function* () {
      assert.equal(phase, 'touch handled');
      yield;
      return 42;
    })(),
  );
  assert.equal(result, 42);
});
test('large diagnostic bodies retain full fields and identical redaction while yielding', async () => {
  const body = JSON.stringify({
    password: secret,
    items: rows,
    meaningful: 'keep this error detail',
  });
  const expected = new DiagnosticRedactor().body(body);
  let beats = 0;
  const timer = setInterval(() => beats++, 0);
  try {
    const output = await new DiagnosticRedactor().bodyAsync(body);
    assert.deepEqual(output, expected);
    assert.ok(beats > 1, 'Large redaction must yield repeatedly, not only before it starts');
    assert.ok(!JSON.stringify(output).includes(secret));
    assert.equal(output.parsed.items.length, 1800);
  } finally {
    clearInterval(timer);
  }
});
test('concurrent async diagnostic inspections have independent traversal counters', async () => {
  const r = new DiagnosticRedactor(),
    body = JSON.stringify({ password: secret, items: rows });
  const outputs = await Promise.all([r.bodyAsync(body), r.bodyAsync(body)]);
  assert.deepEqual(outputs[0], outputs[1]);
  assert.equal(outputs[0].parsed.items.length, 1800);
  assert.ok(!JSON.stringify(outputs).includes(secret));
  assert.ok(!JSON.stringify(outputs).includes('inspection limit'));
});
test('asynchronous compressed aim diagnostics preserve non-secret settings and redact credentials', async () => {
  const { encodeAimDocument } = require('../.test-build/aimCodec.js');
  const body = JSON.stringify(
    encodeAimDocument({
      password: secret,
      floatSettings: [{ settingEnum: 'EAresFloatSettingName::MouseSensitivity', value: 0.25 }],
      stringSettings: [],
    }),
  );
  const expected = new DiagnosticRedactor().body(body);
  assert.deepEqual(await new DiagnosticRedactor().bodyAsync(body), expected);
  assert.ok(!JSON.stringify(expected).includes(secret));
});
const uuid = (i) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, '0')}`;
function catalogFixture(count = 1000) {
  return {
    themes: { data: [{ uuid: uuid(90000), displayName: 'Example' }] },
    weapons: {
      data: [
        {
          uuid: uuid(90001),
          displayName: 'Vandal',
          skins: Array.from({ length: count }, (_, i) => ({
            uuid: uuid(i),
            displayName: 'Example ' + i,
            assetPath: 'Skins/example/asset',
            themeUuid: uuid(90000),
            levels: [{ uuid: uuid(10000 + i), displayName: 'Example ' + i }],
            chromas: [{ uuid: uuid(20000 + i), displayName: 'Blue' }],
          })),
        },
      ],
    },
    bundles: {
      data: [
        {
          uuid: uuid(90002),
          displayName: 'Example',
          assetPath: 'StorefrontItem_example_ThemeBundle_DataAsset',
        },
      ],
    },
  };
}
test('cooperative catalogue builds preserve aliases and indexed bundle membership', async () => {
  const input = catalogFixture(),
    expected = buildCatalog(input, 1000);
  let handled = false;
  setTimeout(() => (handled = true), 0);
  const actual = await buildCatalogAsync(input, 1000);
  assert.equal(handled, true);
  assert.deepEqual(actual, expected);
  assert.equal(actual.bundles[uuid(90002)].itemIds.length, 1000);
  assert.equal(Object.keys(actual.items).length, 3000);
});
test('duplicate bundle names do not acquire guessed membership through the new index', async () => {
  const input = catalogFixture(3);
  input.bundles.data = [
    { uuid: uuid(91001), displayName: 'Example', assetPath: 'unrecognized' },
    { uuid: uuid(91002), displayName: 'Example', assetPath: 'unrecognized' },
  ];
  const result = await buildCatalogAsync(input);
  for (const b of Object.values(result.bundles)) assert.deepEqual(b.itemIds, []);
});
