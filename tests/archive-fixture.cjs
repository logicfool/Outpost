const { ID, OTHER, SKIN, LEVEL, MATCH, session } = require('./helpers.cjs');
const { makeDemo, demoMatch, DEMO_ACCOUNT } = require('../.test-build/demo.js');
const { observedMarkets, matchPreview } = require('../.test-build/matchArchive.js');
const { defaultCrosshair } = require('../.test-build/crosshair.js');
const { createHash } = require('node:crypto');
const clone = (value) => JSON.parse(JSON.stringify(value));
function snapshot() {
  const s = clone(makeDemo().snapshot);
  s.accountId = ID;
  s.demo = false;
  return s;
}
function report(matchId = MATCH) {
  const d = JSON.parse(JSON.stringify(demoMatch(matchId)).replaceAll(DEMO_ACCOUNT.puuid, ID));
  d.id = matchId;
  d.completed = true;
  return { subject: ID, savedAt: Date.now(), completed: true, detail: d };
}
function summary(matchId = MATCH, startedAt = Date.now()) {
  return { id: matchId, startedAt, queue: 'competitive', map: 'Ascent' };
}
function backup() {
  const s = snapshot(),
    r = report();
  return clone({
    account: { puuid: ID, gameName: 'Fixture', tagLine: 'TEST', region: 'ap', shard: 'ap' },
    presets: [
      {
        id: OTHER,
        accountId: ID,
        name: 'Cosmetic set',
        updatedAt: Date.now(),
        weapons: [{ weaponId: MATCH, skinId: SKIN, levelId: LEVEL, chromaId: OTHER }],
      },
    ],
    aimPresets: [
      {
        id: SKIN,
        accountId: ID,
        name: 'Aim set',
        profile: defaultCrosshair('Fixture crosshair'),
        sensitivity: { hipfire: 0.25, ads: 1, scoped: 1 },
        updatedAt: Date.now(),
      },
    ],
    wishlist: [SKIN],
    matches: [{ subject: ID, summary: { ...summary(), preview: matchPreview(r.detail) } }],
    reports: [r],
    markets: observedMarkets(ID, s.store.data),
    storeHistory: [],
    profile: { rank: s.rank, xp: s.xp, loadout: s.loadout, progression: s.progression },
    settings: { theme: 'dark', defaultsVersion: 2, allowPurchases: true, videoSound: false },
  });
}
const hash = async (text) => createHash('sha256').update(text).digest('hex');
module.exports = {
  ID,
  OTHER,
  SKIN,
  LEVEL,
  MATCH,
  session,
  clone,
  snapshot,
  summary,
  report,
  backup,
  hash,
};
