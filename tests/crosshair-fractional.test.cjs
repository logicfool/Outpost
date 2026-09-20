const test = require('node:test'),
  assert = require('node:assert/strict');
const { ID, OTHER } = require('./helpers.cjs');
const {
  importCrosshairCode,
  exportCrosshairCode,
  crosshairRects,
  validateCrosshair,
} = require('../.test-build/crosshair.js');
const {
  crosshairFromRiot,
  crosshairToRiot,
  aimSnapshot,
  prepareAimDocument,
  aimEditMatches,
  validateAimPreset,
} = require('../.test-build/aimSettings.js');
const { encodeAimDocument, decodeAimDocument } = require('../.test-build/aimCodec.js');
const CODE =
  '0;s;1;P;h;0;f;0;0t;1;0l;20;0v;0;0g;1;0o;2;0a;1;0m;1;0s;0;0e;0;1t;4;1l;1;1v;1;1g;1;1o;0;1a;1;1m;0;1e;0.722;S;s;1.01;o;1';
test('the exact reported crosshair imports without rejecting fractional sniper size', () => {
  const p = importCrosshairCode(CODE, 'Reported profile');
  assert.equal(p.sniper.centerDotSize, 1.01);
  assert.equal(p.sniper.centerDotOpacity, 1);
  assert.equal(p.primary.innerLines.lineLength, 20);
  assert.equal(p.primary.innerLines.lineLengthVertical, 0);
  assert.equal(p.primary.outerLines.firingErrorScale, 0.722);
  assert.equal(p.primary.bFadeCrosshairWithFiringError, false);
});
test('crosshair import/export preserves every supported value rather than rounding', () => {
  const p = importCrosshairCode(CODE, 'Reported profile'),
    text = exportCrosshairCode(p);
  assert.match(text, /;S;.*;s;1\.01;/);
  assert.deepEqual(importCrosshairCode(text, p.profileName), p);
});
test('sniper preview uses its actual fractional geometry', () => {
  const p = importCrosshairCode(CODE),
    rect = crosshairRects(p, 'sniper')[0];
  assert.equal(rect.width, 1.01);
  assert.equal(rect.height, 1.01);
  assert.equal(rect.x, -0.505);
  assert.equal(rect.opacity, 1);
});
test('Riot profile read/write and compressed preference encoding retain the supplied code', () => {
  const p = importCrosshairCode(CODE),
    raw = crosshairToRiot(p),
    doc = {
      modified: 1,
      data: {
        floatSettings: [],
        stringSettings: [
          {
            settingEnum: 'EAresStringSettingName::SavedCrosshairProfileData',
            value: JSON.stringify({ currentProfile: 0, profiles: [raw] }),
          },
        ],
      },
    };
  assert.deepEqual(crosshairFromRiot(raw), p);
  const snapshot = aimSnapshot(decodeAimDocument(encodeAimDocument(doc.data)), ID);
  assert.equal(snapshot.crosshairs[0].issue, undefined);
  assert.equal(snapshot.crosshairs[0].profile.sniper.centerDotSize, 1.01);
  const edit = {
      expectedRevision: aimSnapshot(doc, ID).revision,
      crosshair: { index: 0, select: true, profile: p },
    },
    next = prepareAimDocument(doc, ID, edit);
  assert.equal(
    next.data.floatSettings.find(
      (v) => v.settingEnum === 'EAresFloatSettingName::CrosshairSniperCenterDotSize',
    ).value,
    1.01,
  );
  assert.equal(aimEditMatches(aimSnapshot(next, ID), edit), true);
});
test('a locally saved aim preset retains fractional sniper dimensions', () => {
  const p = importCrosshairCode(CODE),
    preset = {
      id: OTHER,
      accountId: ID,
      name: 'Imported',
      profile: p,
      sensitivity: { hipfire: 0.25, ads: 1, scoped: 1 },
      updatedAt: 1000,
    };
  const saved = validateAimPreset(JSON.parse(JSON.stringify(preset)), ID);
  assert.deepEqual(saved.profile, p);
});
test('fractional support does not relax integer-only primary line or dot validation', () => {
  for (const field of ['lineLength', 'lineLengthVertical', 'lineThickness']) {
    const p = importCrosshairCode(CODE);
    p.primary.innerLines[field] = 1.01;
    assert.throws(
      () => validateCrosshair(p),
      (e) => e.code === 'CROSSHAIR_RANGE',
    );
  }
  const p = importCrosshairCode(CODE);
  p.primary.centerDotSize = 1.01;
  assert.throws(
    () => validateCrosshair(p),
    (e) => e.code === 'CROSSHAIR_RANGE',
  );
});
test('invalid sniper sizes remain rejected and float32 server values are accepted', () => {
  for (const v of [NaN, Infinity, -1, 6.01]) {
    const p = importCrosshairCode(CODE);
    p.sniper.centerDotSize = v;
    assert.throws(
      () => validateCrosshair(p),
      (e) => e.code === 'CROSSHAIR_RANGE',
    );
  }
  const p = importCrosshairCode(CODE);
  p.sniper.centerDotSize = Math.fround(1.01);
  assert.equal(validateCrosshair(p).sniper.centerDotSize, Math.fround(1.01));
});
