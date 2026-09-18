const test = require('node:test'),
  assert = require('node:assert/strict');
const {
  aimSnapshot,
  prepareAimDocument,
  aimEditMatches,
  validateAimPreset,
  validateAimEdit,
  validateSensitivity,
  crosshairFromRiot,
  crosshairToRiot,
} = require('../.test-build/aimSettings.js');
const { defaultCrosshair } = require('../.test-build/crosshair.js');
const { ID, OTHER, document, change, clone } = require('./aim-helpers.cjs');
const key = 'EAresStringSettingName::SavedCrosshairProfileData';
const library = (d) => JSON.parse(d.data.stringSettings.find((r) => r.settingEnum === key).value);
test('aim projection exposes only sensitivities and crosshairs, not unrelated preferences', () => {
  const state = aimSnapshot(document(), ID, 5000);
  assert.equal(state.accountId, ID);
  assert.equal(state.sensitivity.hipfire, 0.25);
  assert.equal(state.current, 0);
  assert.equal(state.crosshairs[0].profile.profileName, 'First');
  assert.doesNotMatch(JSON.stringify(state), /MasterVolume|Jump|Space|OtherSetting/);
});
test('combined aim apply preserves unrelated settings, entry metadata and unknown profile fields', () => {
  const before = document(),
    copy = clone(before),
    edit = change(before),
    after = prepareAimDocument(before, ID, edit);
  assert.deepEqual(before, copy);
  for (const k of [
    'actionMappings',
    'axisMappings',
    'intSettings',
    'roamingSetttingsVersion',
    'futureSettings',
  ])
    assert.deepEqual(after.data[k], before.data[k]);
  assert.equal(after.data.floatSettings[0].keep, 'float-metadata');
  assert.deepEqual(
    after.data.floatSettings.find((r) => r.settingEnum.endsWith('MasterVolume')),
    before.data.floatSettings.find((r) => r.settingEnum.endsWith('MasterVolume')),
  );
  assert.equal(library(after).profiles[0].unknownProfileFlag, 'keep');
  assert.equal(library(after).unknownLibraryFlag, 7);
  assert.ok(aimEditMatches(aimSnapshot(after, ID), edit));
  for (const name of [
    'CrosshairUseAdvancedOptions',
    'CrosshairUsePrimaryCrosshairForADS',
    'CrosshairUseCustomCrosshairOnAllPrimary',
  ])
    assert.equal(
      typeof after.data.boolSettings.find((r) => r.settingEnum.endsWith('::' + name)).value,
      'boolean',
    );
});
test('sensitivity-only change leaves every crosshair byte and all other floats unchanged', () => {
  const doc = document(),
    edit = { expectedRevision: aimSnapshot(doc, ID).revision, sensitivity: { hipfire: 0.5 } },
    after = prepareAimDocument(doc, ID, edit);
  assert.deepEqual(after.data.stringSettings, doc.data.stringSettings);
  assert.deepEqual(after.data.boolSettings, doc.data.boolSettings);
  assert.equal(after.data.floatSettings[0].value, 0.5);
  assert.deepEqual(after.data.floatSettings.slice(1), doc.data.floatSettings.slice(1));
});
test('profile add retains existing profiles and obeys the 15-slot cap', () => {
  const doc = document(),
    edit = change(doc);
  delete edit.crosshair.index;
  const after = prepareAimDocument(doc, ID, edit);
  assert.equal(library(after).profiles.length, 2);
  assert.deepEqual(library(after).profiles[0], library(doc).profiles[0]);
  assert.equal(library(after).currentProfile, 1);
  const full = clone(doc);
  full.data.stringSettings[0].value = JSON.stringify({
    currentProfile: 0,
    profiles: Array.from({ length: 15 }, (_, i) => crosshairToRiot(defaultCrosshair('Slot ' + i))),
  });
  edit.expectedRevision = aimSnapshot(full, ID).revision;
  assert.throws(
    () => prepareAimDocument(full, ID, edit),
    (e) => e.code === 'AIM_PROFILE_LIMIT',
  );
});
test('stale selected settings revision fails before modifying a new document', () => {
  const doc = document(),
    edit = change(doc);
  doc.data.floatSettings[0].value = 0.9;
  assert.throws(
    () => prepareAimDocument(doc, ID, edit),
    (e) => e.code === 'AIM_CONFLICT',
  );
});
test('verification accepts float32 rounding without accepting a meaningful difference', () => {
  const doc = document(),
    edit = change(doc);
  edit.crosshair.profile.primary.innerLines.opacity = 0.3;
  const after = prepareAimDocument(doc, ID, edit),
    snapshot = aimSnapshot(after, ID);
  snapshot.sensitivity.hipfire = Math.fround(0.3);
  snapshot.crosshairs[0].profile.primary.innerLines.opacity = Math.fround(0.3);
  assert.ok(aimEditMatches(snapshot, edit));
  snapshot.sensitivity.hipfire = 0.31;
  assert.equal(aimEditMatches(snapshot, edit), false);
});
test('verification finds the selected copy when identical crosshairs exist', () => {
  const doc = document(),
    edit = change(doc);
  delete edit.crosshair.index;
  const after = prepareAimDocument(doc, ID, edit),
    snapshot = aimSnapshot(after, ID);
  snapshot.crosshairs.unshift({ ...snapshot.crosshairs[1], index: 9 });
  assert.ok(aimEditMatches(snapshot, edit));
});
test('legacy PascalCase profiles retain their spelling and unknown fields', () => {
  const doc = document(),
    p = crosshairToRiot(defaultCrosshair('Legacy'));
  const legacy = {
    ProfileName: p.profileName,
    Primary: p.primary,
    ADS: p.aDS,
    Sniper: p.sniper,
    bUseAdvancedOptions: p.bUseAdvancedOptions,
    bUsePrimaryCrosshairForADS: p.bUsePrimaryCrosshairForADS,
    bUseCustomCrosshairOnAllPrimary: p.bUseCustomCrosshairOnAllPrimary,
    PrivateLegacyFlag: 42,
  };
  doc.data.stringSettings[0].value = JSON.stringify({
    CurrentProfile: 0,
    Profiles: [legacy],
    Keep: 1,
  });
  const edit = change(doc),
    after = prepareAimDocument(doc, ID, edit),
    raw = library(after);
  assert.ok(raw.Profiles);
  assert.equal(raw.profiles, undefined);
  assert.equal(raw.Profiles[0].Primary.innerLines.lineLength, 4);
  assert.equal(raw.Profiles[0].PrivateLegacyFlag, 42);
  assert.ok(aimEditMatches(aimSnapshot(after, ID), edit));
});
test('missing sensitivity stays unknown rather than defaulting to zero or copying a preset', () => {
  const d = document();
  d.data.floatSettings = d.data.floatSettings.slice(1);
  assert.equal(aimSnapshot(d, ID).sensitivity.hipfire, null);
});
test('duplicate fields, corrupt profile JSON and invalid selected slots block settings writes', () => {
  const d = document();
  d.data.floatSettings.push({ ...d.data.floatSettings[0] });
  assert.throws(() => aimSnapshot(d, ID));
  for (const payload of [
    '{bad',
    JSON.stringify({ currentProfile: 100, profiles: [] }),
    JSON.stringify({ currentProfile: 1, profiles: [{}] }),
    '{"currentProfile":0,"profiles":[{"__proto__":{"polluted":true}}]}',
  ]) {
    const doc = document();
    doc.data.stringSettings[0].value = payload;
    assert.throws(() => aimSnapshot(doc, ID));
  }
});
test('unsupported individual crosshair remains visible but is not fabricated as a default', () => {
  const d = document();
  d.data.stringSettings[0].value = JSON.stringify({
    currentProfile: 0,
    profiles: [{ profileName: 'Unsupported', primary: { innerLines: { lineLength: NaN } } }],
  });
  const p = aimSnapshot(d, ID).crosshairs[0];
  assert.equal(p.profile, undefined);
  assert.ok(p.issue);
});
for (const v of [-1, 0, Infinity, NaN, 10.1, '0.25', null])
  test('invalid sensitivity is rejected ' + String(v), () =>
    assert.throws(() => validateSensitivity({ hipfire: v })),
  );
test('preset is account scoped and stores only whitelisted aim fields', () => {
  const p = validateAimPreset(
    {
      id: OTHER,
      accountId: ID,
      name: 'Focus',
      profile: defaultCrosshair('Focus'),
      sensitivity: { hipfire: 0.25, ads: 1, scoped: 1 },
      updatedAt: 1,
      secret: 'discard',
    },
    ID,
  );
  assert.equal(p.secret, undefined);
  assert.throws(
    () => validateAimPreset(p, OTHER),
    (e) => e.code === 'ACCOUNT_MISMATCH',
  );
  assert.throws(() => validateSensitivity({ hipfire: 0.25 }, true));
});
test('an empty or out-of-range edit cannot initiate a settings write', () => {
  assert.throws(() => validateAimEdit({ expectedRevision: 'x' }));
  assert.throws(() =>
    validateAimEdit({
      expectedRevision: 'x',
      crosshair: { profile: defaultCrosshair(), index: 15, select: true },
    }),
  );
  assert.throws(() => validateAimEdit({ expectedRevision: 'x', sensitivity: { hipfire: null } }));
});
