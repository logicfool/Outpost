const test = require('node:test');
const assert = require('node:assert/strict');
const { groupRankedRewind, rewindEntryLabel } = require('../.test-build/rankedRewind.js');

const at = (day, hour) => new Date(2026, 8, day, hour).getTime();
const tiers = {
  18: { name: 'DIAMOND 1' },
  19: { name: 'DIAMOND 2' },
};

test('ranked rewind groups local days newest first with RR and rank transitions', () => {
  const days = groupRankedRewind(
    [
      {
        id: 'b',
        startedAt: at(21, 22),
        queue: 'competitive',
        map: 'Lotus',
        rrChange: -16,
        tierAfter: 19,
        rrAfter: 45,
      },
      {
        id: 'c',
        startedAt: at(20, 20),
        queue: 'competitive',
        map: 'Haven',
        rrChange: 25,
        tierAfter: 19,
        rrAfter: 61,
      },
      {
        id: 'a',
        startedAt: at(21, 20),
        queue: 'competitive',
        map: 'Ascent',
        rrChange: 22,
        tierAfter: 19,
        rrAfter: 61,
      },
      { id: 'u', startedAt: at(21, 19), queue: 'unrated', map: 'Bind' },
    ],
    tiers,
  );
  assert.equal(days.length, 2);
  assert.deepEqual(
    days[0].matches.map((match) => match.id),
    ['b', 'a'],
  );
  assert.equal(days[0].netRr, 6);
  assert.equal(days[0].wins, 1);
  assert.equal(days[0].losses, 1);
  assert.deepEqual(days[0].startRank, {
    tier: 19,
    rr: 39,
    name: 'DIAMOND 2',
    image: undefined,
  });
  assert.deepEqual(days[0].endRank, {
    tier: 19,
    rr: 45,
    name: 'DIAMOND 2',
    image: undefined,
  });
});

test('ranked rewind entry prefers today then yesterday and handles an empty history', () => {
  const now = at(22, 12);
  const yesterday = groupRankedRewind(
    [
      {
        id: 'a',
        startedAt: at(21, 20),
        queue: 'competitive',
        map: 'Ascent',
        rrChange: -18,
      },
    ],
    tiers,
  );
  assert.equal(rewindEntryLabel(yesterday, now), 'Yesterday -18 RR');
  assert.equal(rewindEntryLabel([], now), 'No ranked matches today');
});
