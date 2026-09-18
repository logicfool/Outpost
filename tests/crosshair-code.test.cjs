const test = require('node:test'),
  assert = require('node:assert/strict');
const {
  defaultCrosshair,
  validateCrosshair,
  importCrosshairCode,
  exportCrosshairCode,
  crosshairRects,
  colorHex,
} = require('../.test-build/crosshair.js');
const {
  crosshairFromRiot,
  crosshairToRiot,
  equivalentAimValue,
} = require('../.test-build/aimSettings.js');
const { clone } = require('./aim-helpers.cjs');
test('user supplied cyan code decodes without creating network or device dependencies', () => {
  const p = importCrosshairCode('0;s;1;P;c;5;h;0;0l;5;0v;5;0o;0;0a;1;0f;0;1b;0', 'My crosshair');
  assert.equal(p.primary.color, '00FFFFFF');
  assert.equal(p.primary.bHasOutline, false);
  assert.equal(p.primary.innerLines.lineLength, 5);
  assert.equal(p.primary.innerLines.lineOffset, 0);
  assert.equal(p.primary.outerLines.bShowLines, false);
  assert.equal(p.primary.innerLines.bShowShootingError, false);
});
test('primary ADS and sniper settings survive exported code and cloud profile round trips', () => {
  const p = defaultCrosshair('Precision');
  p.bUseAdvancedOptions = true;
  p.bUsePrimaryCrosshairForADS = false;
  p.bUseCustomCrosshairOnAllPrimary = true;
  p.primary.bFadeCrosshairWithFiringError = false;
  p.primary.color = 'A1B2C3FF';
  p.aDS.innerLines.lineLength = 3;
  p.aDS.innerLines.lineLengthVertical = 2;
  p.aDS.innerLines.bAllowVertScaling = true;
  p.sniper.color = '00FF0088';
  assert.deepEqual(importCrosshairCode(exportCrosshairCode(p), p.profileName), p);
  assert.deepEqual(crosshairFromRiot(crosshairToRiot(p)), p);
});
test('minimal code 0, outer-line suppression and trailing semicolon are supported', () => {
  assert.deepEqual(importCrosshairCode('0', 'Default'), defaultCrosshair('Default'));
  assert.equal(importCrosshairCode('0;P;1b;0;').primary.outerLines.bShowLines, false);
});
for (const code of [
  '',
  '1',
  '0;P',
  '0;P;h',
  '0;P;h;2',
  '0;P;0l;-1',
  '0;P;0l;21',
  '0;P;h;0;h;1',
  '0;P;h;0;P;c;1',
  '0;constructor;1',
  '0;P;constructor;1',
  '0;P;0__proto__;1',
  '0;P;u;FFFFFF',
  '0;P;c;8',
  '0;P;0a;NaN',
  '0;P;0a;Infinity',
  '0;P;0a;1.1',
  '0;P;0l;1e2',
  '0;P;;0l;1',
  '0;P;unknown;1',
])
  test('invalid code is rejected: ' + JSON.stringify(code), () =>
    assert.throws(() => importCrosshairCode(code)),
  );
test('oversized imports and invalid preset names fail with actionable errors', () => {
  assert.throws(
    () => importCrosshairCode('0;P;' + 'c;1;'.repeat(1500)),
    (e) => e.code === 'CROSSHAIR_CODE',
  );
  assert.throws(() => defaultCrosshair(''));
  assert.throws(() => defaultCrosshair('x'.repeat(49)));
  assert.throws(() => defaultCrosshair('a\nb'));
});
test('custom colours validate channel count and round trip alpha', () => {
  assert.equal(colorHex('#00ff80'), '00FF80FF');
  assert.equal(colorHex('00ff8080'), '00FF8080');
  for (const v of ['red', '#abc', '000000000', 'javascript:alert(1)'])
    assert.throws(() => colorHex(v));
});
test('crosshair preview is centred, symmetric and explicitly switches ADS/sniper layers', () => {
  const p = defaultCrosshair('Geometric');
  p.primary.bHasOutline = false;
  p.primary.outerLines.bShowLines = false;
  p.primary.innerLines = {
    ...p.primary.innerLines,
    lineLength: 4,
    lineLengthVertical: 2,
    bAllowVertScaling: true,
    lineThickness: 2,
    lineOffset: 3,
  };
  const r = crosshairRects(p);
  assert.equal(r.length, 4);
  assert.equal(r[0].x, -r[1].x - r[1].width);
  assert.equal(r[2].y, -r[3].y - r[3].height);
  assert.deepEqual(crosshairRects(p, 'ads'), r);
  p.bUseAdvancedOptions = true;
  p.bUsePrimaryCrosshairForADS = false;
  assert.notDeepEqual(crosshairRects(p, 'ads'), r);
  assert.equal(crosshairRects(p, 'sniper').length, 1);
});
