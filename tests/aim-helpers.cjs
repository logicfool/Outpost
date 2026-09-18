const { ID, OTHER } = require('./helpers.cjs');
const { defaultCrosshair } = require('../.test-build/crosshair.js');
const { crosshairToRiot, aimSnapshot } = require('../.test-build/aimSettings.js');
const clone = (v) => JSON.parse(JSON.stringify(v));
function document() {
  return {
    modified: 1200,
    data: {
      floatSettings: [
        {
          settingEnum: 'EAresFloatSettingName::MouseSensitivity',
          value: 0.25,
          keep: 'float-metadata',
        },
        { settingEnum: 'EAresFloatSettingName::MouseSensitivityADS', value: 1 },
        { settingEnum: 'EAresFloatSettingName::MouseSensitivityZoomed', value: 1 },
        { settingEnum: 'EAresFloatSettingName::MasterVolume', value: 0.8 },
      ],
      boolSettings: [
        { settingEnum: 'EAresBoolSettingName::CrosshairHasOutline', value: true },
        { settingEnum: 'EAresBoolSettingName::CrosshairInnerLinesShowShootingError', value: true },
        { settingEnum: 'EAresBoolSettingName::AudioEnabled', value: true },
      ],
      stringSettings: [
        {
          settingEnum: 'EAresStringSettingName::SavedCrosshairProfileData',
          value: JSON.stringify({
            currentProfile: 0,
            profiles: [
              { ...crosshairToRiot(defaultCrosshair('First')), unknownProfileFlag: 'keep' },
            ],
            unknownLibraryFlag: 7,
          }),
        },
        { settingEnum: 'EAresStringSettingName::OtherSetting', value: 'untouched' },
      ],
      actionMappings: [{ name: 'Jump', key: 'Space' }],
      axisMappings: [],
      intSettings: [{ settingEnum: 'EAresIntSettingName::Resolution', value: 1920 }],
      roamingSetttingsVersion: 5,
      futureSettings: { keep: true },
    },
  };
}
function change(doc = document()) {
  const p = defaultCrosshair('Selected');
  p.primary.innerLines.lineLength = 4;
  p.primary.innerLines.lineLengthVertical = 4;
  return {
    expectedRevision: aimSnapshot(doc, ID).revision,
    sensitivity: { hipfire: 0.3, ads: 1.2, scoped: 0.9 },
    crosshair: { profile: p, index: 0, select: true },
  };
}
function store() {
  const states = new Map(),
    presets = new Map();
  return {
    states,
    presets,
    aimState: async (id) => (states.has(id) ? clone(states.get(id)) : null),
    saveAimState: async (id, state) => {
      states.set(id, clone(state));
    },
    aimPresets: async (id) => presets.get(id) ?? [],
    saveAimPreset: async (p) => {
      presets.set(p.accountId, [p]);
    },
    deleteAimPreset: async () => {},
  };
}
module.exports = { ID, OTHER, clone, document, change, store };
