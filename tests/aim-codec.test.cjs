const test = require('node:test'),
  assert = require('node:assert/strict'),
  zlib = require('node:zlib');
const {
  decodeAimDocument,
  encodeAimDocument,
  MAX_AIM_BYTES,
} = require('../.test-build/aimCodec.js');
const { document } = require('./aim-helpers.cjs');
const compressed = (v) => ({
  type: 'Ares.PlayerSettings',
  data: zlib
    .deflateRawSync(
      Buffer.isBuffer(v) ? v : Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)),
    )
    .toString('base64'),
  modified: 1200,
});
test('Riot raw-DEFLATE envelope decodes identically to native zlib and retains unknown settings', () => {
  const doc = document();
  assert.deepEqual(decodeAimDocument(compressed(doc.data)), doc);
  const encoded = encodeAimDocument(doc.data);
  assert.equal(encoded.type, 'Ares.PlayerSettings');
  assert.deepEqual(
    JSON.parse(zlib.inflateRawSync(Buffer.from(encoded.data, 'base64')).toString('utf8')),
    doc.data,
  );
});
test('Unicode settings survive the JavaScript compression round trip', () => {
  const d = document().data;
  d.futureSettings.label = '雪 - café - 🎯';
  assert.deepEqual(decodeAimDocument(encodeAimDocument(d)).data, d);
});
for (const [label, value] of [
  ['HTML', '<html>no</html>'],
  [
    'zlib wrapper',
    { type: 'Ares.PlayerSettings', data: zlib.deflateSync(Buffer.from('{}')).toString('base64') },
  ],
  ['wrong category', { ...compressed(document().data), type: 'Other.Settings' }],
  ['noncanonical base64', { type: 'Ares.PlayerSettings', data: 'ab==' }],
  ['missing data', {}],
])
  test('settings decoder rejects ' + label, () => assert.throws(() => decodeAimDocument(value)));
test('decoder rejects truncated and trailing compressed data', () => {
  const b = Buffer.from(compressed(document().data).data, 'base64');
  for (const bytes of [b.subarray(0, b.length - 2), Buffer.concat([b, Buffer.from([1, 2, 3])])])
    assert.throws(() => decodeAimDocument({ data: bytes.toString('base64') }));
});
test('decompression bomb stops at the 512 KiB output ceiling', () => {
  assert.throws(
    () =>
      decodeAimDocument(
        compressed({
          floatSettings: [],
          stringSettings: [],
          padding: 'x'.repeat(MAX_AIM_BYTES + 20),
        }),
      ),
    (e) => e.code === 'AIM_SIZE',
  );
});
test('decoder rejects invalid UTF-8, malformed JSON and non-object settings', () => {
  for (const payload of [
    Buffer.from([0xc0, 0x80]),
    '{invalid',
    '[]',
    'null',
    '{"floatSettings":{}}',
  ])
    assert.throws(() => decodeAimDocument(compressed(payload)));
});
test('deep, huge, and prototype-bearing settings fail before merge or re-encode', () => {
  let nested = { keep: true };
  for (let n = 0; n < 26; n++) nested = { nested };
  for (const extra of [
    nested,
    { entries: Array(12001).fill(0) },
    JSON.parse('{"__proto__":{"polluted":true}}'),
  ])
    assert.throws(() => decodeAimDocument(compressed({ ...document().data, extra })));
  assert.equal({}.polluted, undefined);
  assert.throws(() => encodeAimDocument({ ...document().data, huge: 'x'.repeat(MAX_AIM_BYTES) }));
});
