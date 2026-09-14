const test = require('node:test');
const assert = require('node:assert/strict');
const v = require('../.test-build/validation.js');
const c = require('../.test-build/catalog.js');
const SKIN = '11111111-1111-4111-8111-111111111111',
  LEVEL = '22222222-2222-4222-8222-222222222222',
  CHROMA = '33333333-3333-4333-8333-333333333333';
const VIDEO =
  'https://valorant.dyn.riotcdn.net/x/videos/release-13.05/fixture_default_universal.mp4';
test('skin videos from the Riot CDN are accepted as media but never as images', () => {
  assert.equal(v.safeMedia(VIDEO), VIDEO);
  assert.equal(v.safeImage(VIDEO), undefined);
  assert.equal(v.safeMedia('http://valorant.dyn.riotcdn.net/x.mp4'), undefined);
  assert.equal(v.safeMedia('https://valorant.dyn.riotcdn.net.evil.invalid/x.mp4'), undefined);
});
test('skin video falls back to a chroma video and Ultra rarity resolves', () => {
  const cat = c.buildCatalog({
    weapons: {
      data: [
        {
          displayName: 'Vandal',
          skins: [
            {
              uuid: SKIN,
              displayName: 'Fixture',
              contentTierUuid: '411e4a55-4e59-7757-41f0-86a53f101bb5',
              levels: [{ uuid: LEVEL, streamedVideo: null }],
              chromas: [{ uuid: CHROMA, streamedVideo: VIDEO }],
            },
          ],
        },
      ],
    },
  });
  assert.equal(cat.items[SKIN].video, VIDEO);
  assert.equal(cat.items[LEVEL].video, VIDEO);
  assert.equal(cat.items[SKIN].rarity, 'Ultra');
});
