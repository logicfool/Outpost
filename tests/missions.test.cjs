const test = require('node:test'),
  assert = require('node:assert/strict');
const {
  missionBoard,
  buildMission,
  missionDefinitions,
  objectiveDirectives,
  missionSchedule,
  missionKind,
  renderDirective,
} = require('../.test-build/missions.js');
const { normalizeProgression } = require('../.test-build/normalize.js');
const { buildCatalog } = require('../.test-build/catalog.js');

const NOW = Date.parse('2026-09-21T12:00:00Z'),
  DAY = 86400000;
const M = (n) => `00000000-0000-4000-8008-${String(n).padStart(12, '0')}`;
const O = (n) => `00000000-0000-4000-8009-${String(n).padStart(12, '0')}`;
const mission = (n, type, extra = {}) => ({
  uuid: M(n),
  title: `Mission ${n}`,
  displayName: null,
  type: `EAresMissionType::${type}`,
  xpGrant: 34000,
  progressToComplete: 50,
  objectives: [{ objectiveUuid: O(n), value: 50 }],
  activationDate: '0001-01-01T00:00:00Z',
  expirationDate: '0001-01-01T00:00:00Z',
  assetPath: `ShooterGame/Content/Missions/Contracts/Dailies/Mission${n}_PrimaryAsset`,
  ...extra,
});
const weekly = (n, week, activationDays) =>
  mission(n, 'Weekly', {
    activationDate: new Date(NOW + activationDays * DAY).toISOString(),
    expirationDate: new Date(NOW + (activationDays + 7) * DAY).toISOString(),
    assetPath: `ShooterGame/Content/Missions/Contracts/Season26-5_Weeklies/Week${week}/Season26-5_Week${week}_Mission${n}_PrimaryAsset`,
  });
const catalog = () =>
  buildCatalog(
    {
      missions: {
        data: [
          mission(1, 'Daily'),
          mission(2, 'Daily'),
          weekly(3, 8, -2),
          weekly(4, 8, -2),
          weekly(5, 8, -2),
          weekly(6, 9, 5),
          weekly(7, 9, 5),
          weekly(8, 10, 12),
        ],
      },
      objectives: {
        data: [
          { uuid: O(1), directive: 'Deal {Num} Damage' },
          { uuid: O(3), directive: 'Get {Num} {Num}|plural(one=Headshot,other=Headshots)' },
        ],
      },
    },
    NOW,
  );

test('mission definitions carry title, kind, xp, targets and schedule', () => {
  const defs = missionDefinitions({ data: [weekly(3, 8, -2)] });
  const def = defs[M(3)];
  assert.equal(def.title, 'Mission 3');
  assert.equal(def.kind, 'weekly');
  assert.equal(def.xpGrant, 34000);
  assert.equal(def.target, 50);
  assert.deepEqual(def.objectives, [{ id: O(3), target: 50 }]);
  assert.equal(def.week, 8);
  assert.equal(def.season, 'Season26-5');
});
test('Riot mission types map to known kinds and unknown types stay other', () => {
  assert.equal(missionKind('EAresMissionType::Daily'), 'daily');
  assert.equal(missionKind('EAresMissionType::Weekly'), 'weekly');
  assert.equal(missionKind('EAresMissionType::NPE'), 'npe');
  assert.equal(missionKind('EAresMissionType::Something'), 'other');
  assert.equal(missionKind(null), 'other');
});
test('placeholder activation dates are not treated as a real schedule', () => {
  assert.equal(missionDefinitions({ data: [mission(1, 'Daily')] })[M(1)].activatesAt, undefined);
});
test('week grouping is only read from a weeklies asset path', () => {
  assert.deepEqual(
    missionSchedule('ShooterGame/Content/Missions/Contracts/Season26-5_Weeklies/Week8/x'),
    { season: 'Season26-5', week: 8, group: 'Season26-5:8' },
  );
  assert.deepEqual(missionSchedule('ShooterGame/Content/Missions/Contracts/Dailies/x'), {});
});
test('directive placeholders resolve the count and the matching plural form', () => {
  assert.equal(
    renderDirective('Get {Num} {Num}|plural(one=Headshot,other=Headshots)', 50),
    'Get 50 Headshots',
  );
  assert.equal(
    renderDirective('Get {Num} {Num}|plural(one=Headshot,other=Headshots)', 1),
    'Get 1 Headshot',
  );
  assert.equal(renderDirective('Deal {Num} Damage', 1000), 'Deal 1000 Damage');
  assert.equal(objectiveDirectives({ data: [{ uuid: O(1), directive: '' }] })[O(1)], undefined);
});

test('an active mission resolves its title, directive, progress and target', () => {
  const m = buildMission(
    { id: M(3), complete: false, expiresAt: NOW + DAY, objectives: { [O(3)]: 31 } },
    catalog(),
    NOW,
  );
  assert.equal(m.title, 'Mission 3');
  assert.equal(m.kind, 'weekly');
  assert.equal(m.progress, 31);
  assert.equal(m.target, 50);
  assert.equal(m.xpGrant, 34000);
  assert.deepEqual(m.objectives, [
    { id: O(3), directive: 'Get 50 Headshots', progress: 31, target: 50 },
  ]);
  assert.equal(m.unresolved, false);
});
test('progress beyond the target is clamped and a complete mission reads as full', () => {
  const over = buildMission(
    { id: M(3), complete: false, objectives: { [O(3)]: 900 } },
    catalog(),
    NOW,
  );
  assert.equal(over.progress, 50);
  assert.equal(
    buildMission({ id: M(3), complete: true, objectives: {} }, catalog(), NOW).progress,
    50,
  );
});
test('a mission with no catalog definition stays visible and is marked unresolved', () => {
  const m = buildMission(
    { id: M(99), complete: false, objectives: { [O(99)]: 3 } },
    catalog(),
    NOW,
  );
  assert.equal(m.unresolved, true);
  assert.ok(m.title.startsWith('Mission · '));
  assert.equal(m.objectives[0].directive, 'Objective');
});
test('an objective without a published directive falls back to the mission title', () => {
  assert.equal(
    buildMission({ id: M(4), complete: false, objectives: { [O(4)]: 1 } }, catalog(), NOW)
      .objectives[0].directive,
    'Mission 4',
  );
});

test('active missions list weeklies first and count what is left to do', () => {
  const board = missionBoard(
    [
      { id: M(1), complete: false, objectives: { [O(1)]: 640 } },
      { id: M(3), complete: false, expiresAt: NOW + 3 * DAY, objectives: { [O(3)]: 31 } },
      { id: M(4), complete: true, expiresAt: NOW + 3 * DAY, objectives: { [O(4)]: 50 } },
    ],
    { weeklyRefillAt: NOW + 3 * DAY, npeCompleted: true },
    catalog(),
    NOW,
  );
  assert.deepEqual(
    board.active.map((m) => m.id),
    [M(3), M(4), M(1)],
  );
  assert.equal(board.todo, 2);
  assert.deepEqual(
    board.done.map((m) => m.id),
    [M(5)],
  );
  assert.deepEqual(
    board.upcoming.map((w) => w.label),
    ['Week 9', 'Week 10'],
  );
  assert.deepEqual(
    board.upcoming[0].missions.map((m) => m.id),
    [M(6), M(7)],
  );
  assert.equal(board.npeCompleted, true);
  assert.equal(board.weeklyRefillAt, NOW + 3 * DAY);
});
test('an empty active list mid-act means every released weekly is done', () => {
  const board = missionBoard([], { weeklyRefillAt: NOW + DAY }, catalog(), NOW);
  assert.deepEqual(board.active, []);
  assert.equal(board.todo, 0);
  assert.deepEqual(
    board.done.map((m) => m.id),
    [M(3), M(4), M(5)],
  );
  assert.equal(board.upcoming[0].missions.length, 2);
});
test('only weeklies whose window is open count as done', () => {
  const data = [weekly(3, 8, -2), weekly(20, 7, -10), weekly(21, 9, 1), mission(22, 'Daily')];
  const board = missionBoard([], {}, buildCatalog({ missions: { data } }, NOW), NOW);
  assert.deepEqual(
    board.done.map((m) => m.id),
    [M(3)],
  );
});
test('future weeks are ordered by activation date and never include open ones', () => {
  const board = missionBoard([], {}, catalog(), NOW);
  assert.ok(board.upcoming[0].activatesAt < board.upcoming[1].activatesAt);
  assert.equal(
    board.upcoming.some((w) => w.activatesAt <= NOW),
    false,
  );
});

test('progression keeps objective identifiers so progress maps to the right directive', () => {
  const progression = normalizeProgression(
    {
      Contracts: [],
      Missions: [
        {
          ID: M(3).toUpperCase(),
          Complete: false,
          ExpirationTime: '2026-09-24T12:00:00Z',
          Objectives: { [O(3).toUpperCase()]: 31, bad: 'x' },
        },
      ],
      MissionMetadata: {
        NPECompleted: true,
        WeeklyCheckpoint: '2026-09-19T12:00:00Z',
        WeeklyRefillTime: '2026-09-24T12:00:00Z',
      },
    },
    catalog(),
  );
  assert.deepEqual(progression.missions[0].objectives, { [O(3)]: 31 });
  assert.equal(progression.missions[0].id, M(3));
  assert.equal(progression.npeCompleted, true);
  assert.ok(progression.weeklyCheckpointAt > 0);
  assert.equal(buildMission(progression.missions[0], catalog(), NOW).progress, 31);
});
test('mission metadata that Riot omits stays absent instead of becoming zero', () => {
  const progression = normalizeProgression(
    { Contracts: [], Missions: [], MissionMetadata: {} },
    catalog(),
  );
  assert.equal(progression.weeklyRefillAt, undefined);
  assert.equal(progression.weeklyCheckpointAt, undefined);
  assert.equal(progression.npeCompleted, undefined);
});
