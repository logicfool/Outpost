const test = require('node:test'),
  assert = require('node:assert/strict');
const { ID, OTHER, SKIN, LEVEL, MATCH, catalog } = require('./helpers.cjs');
const {
  normalizeAnalysis,
  mapPoint,
  worldPoint,
  eventPositions,
  duelGrid,
  eventClock,
} = require('../.test-build/matchAnalysis.js');
const { normalizeMatchDetail } = require('../.test-build/normalize.js');
const { buildCatalog } = require('../.test-build/catalog.js');
const THIRD = '66666666-6666-4666-8666-666666666666',
  GUN = '77777777-7777-4777-8777-777777777777';
const roster = () => [
  { subject: ID, name: 'Self', tag: 'TEST', teamId: 'Blue', agent: 'Sage', self: true },
  { subject: OTHER, name: 'Opponent', tag: 'TEST', teamId: 'Red', agent: 'Jett', self: false },
  { subject: THIRD, name: 'Ally', tag: 'TEST', teamId: 'Blue', agent: 'Sova', self: false },
];
const kill = (overrides = {}) => ({
  killer: ID,
  victim: OTHER,
  gameTime: 20000,
  roundTime: 12000,
  assistants: [THIRD],
  victimLocation: { x: 11473, y: -2897 },
  playerLocations: [{ subject: ID, location: { x: 10000, y: -2000 } }],
  finishingDamage: { damageType: 'Weapon', damageItem: GUN },
  ...overrides,
});
const cat = () => ({
  ...catalog(),
  maps: {
    fracture: {
      name: 'Fracture',
      minimap: 'https://media.valorant-api.com/maps/f.png',
      xMultiplier: 0.000078,
      yMultiplier: -0.000078,
      xScalarToAdd: 0.556952,
      yScalarToAdd: 1.155886,
    },
  },
  weapons: {
    [GUN]: { id: GUN, name: 'Vandal', killIcon: 'https://media.valorant-api.com/weapons/v.png' },
  },
});
const raw = () => ({
  matchInfo: { matchId: MATCH, mapId: 'fracture' },
  roundResults: [
    {
      roundNum: 0,
      roundResult: 'Eliminated',
      winningTeam: 'Blue',
      playerStats: [
        {
          subject: ID,
          kills: [kill()],
          economy: { weapon: GUN, remaining: 0, loadoutValue: 3900 },
        },
      ],
    },
  ],
  kills: [kill({ round: 0 })],
});
test('root and per-round kill mirrors count once', () => {
  const a = normalizeAnalysis(raw(), cat(), roster());
  assert.equal(a.events.length, 1);
  assert.equal(a.rounds[0].events.length, 1);
  assert.equal(a.events[0].round, 1);
});
test('root mirror missing a round still joins its known game-time event', () => {
  const r = raw();
  delete r.kills[0].round;
  assert.equal(normalizeAnalysis(r, cat(), roster()).events.length, 1);
});
test('distinct repeated eliminations after respawns are not collapsed', () => {
  const r = raw();
  r.roundResults[0].playerStats[0].kills.push(kill({ gameTime: 30000, roundTime: 22000 }));
  assert.equal(normalizeAnalysis(r, cat(), roster()).events.length, 2);
});
test('root-only kills attach to their zero-based round number', () => {
  const a = normalizeAnalysis({ kills: [kill({ round: 4 })] }, cat(), roster());
  assert.equal(a.rounds[0].number, 5);
  assert.equal(a.rounds[0].events.length, 1);
});
test('unknown timestamps stay unknown rather than becoming a zero-second event', () => {
  const a = normalizeAnalysis(
    { kills: [kill({ round: 0, gameTime: undefined, roundTime: undefined })] },
    cat(),
    roster(),
  );
  assert.equal(a.events[0].atMs, undefined);
  assert.equal(eventClock(a.events[0].atMs), '-');
});
test('zero and negative spike-time sentinels do not become fake events', () => {
  const r = raw();
  Object.assign(r.roundResults[0], { plantRoundTime: 0, defuseRoundTime: -1, bombPlanter: ID });
  assert.equal(normalizeAnalysis(r, cat(), roster()).events.length, 1);
});
test('plant and defuse preserve time, site and sampled player locations', () => {
  const r = raw();
  Object.assign(r.roundResults[0], {
    plantRoundTime: 10000,
    plantSite: 'A',
    bombPlanter: ID,
    plantLocation: { x: 4, y: 5 },
    plantPlayerLocations: [{ subject: ID, location: { x: 3, y: 4 } }],
    defuseRoundTime: 40000,
    bombDefuser: OTHER,
  });
  const a = normalizeAnalysis(r, cat(), roster());
  assert.deepEqual(
    a.events.map((e) => e.kind),
    ['plant', 'kill', 'defuse'],
  );
  assert.equal(a.events[0].site, 'A');
  assert.equal(a.events[0].positions[0].subject, ID);
});
test('weapon kill icons and round economy use public weapon metadata', () => {
  const a = normalizeAnalysis(raw(), cat(), roster());
  assert.equal(a.events[0].weaponName, 'Vandal');
  assert.match(a.events[0].weaponImage, /v.png/);
  assert.equal(a.rounds[0].economy[0].remaining, 0);
});
test('world-to-minimap conversion uses game Y for image X', () => {
  const p = mapPoint({ x: 11473, y: -2897 }, cat().maps.fracture);
  assert.ok(Math.abs(p.x - 0.330986) < 0.00001);
  assert.ok(Math.abs(p.y - 0.260992) < 0.00001);
});
test('missing calibration and malformed coordinates are not placed at map origin', () => {
  assert.equal(mapPoint({ x: 1, y: 2 }, { name: 'Unknown' }), undefined);
  assert.equal(worldPoint({ x: 1 }), undefined);
  assert.equal(worldPoint({ x: Infinity, y: 0 }), undefined);
});
test('out-of-bounds map samples are omitted, not clamped onto an edge', () => {
  assert.equal(mapPoint({ x: 1e6, y: 1e6 }, cat().maps.fracture), undefined);
});
test('map events do not include future deaths or future positions', () => {
  const r = raw();
  r.roundResults[0].playerStats[0].kills.push(
    kill({ gameTime: 50000, roundTime: 42000, victim: THIRD }),
  );
  const a = normalizeAnalysis(r, cat(), roster()),
    pins = eventPositions(a.rounds[0], a.events[0]);
  assert.equal(
    pins.some((p) => p.subject === THIRD),
    false,
  );
  assert.equal(pins.find((p) => p.subject === OTHER).lastDeath, true);
});
test('a later event sample supersedes an earlier death pin for a revived player', () => {
  const r = raw();
  r.roundResults[0].playerStats[0].kills.push(
    kill({
      gameTime: 50000,
      roundTime: 42000,
      victim: THIRD,
      playerLocations: [{ subject: OTHER, location: { x: 1, y: 2 } }],
    }),
  );
  const a = normalizeAnalysis(r, cat(), roster());
  assert.equal(
    eventPositions(a.rounds[0], a.events[1]).find((p) => p.subject === OTHER).lastDeath,
    false,
  );
});
test('unknown participants cannot be injected into event maps', () => {
  const r = raw();
  r.kills.push(kill({ round: 0, victim: SKIN }));
  r.roundResults[0].playerStats[0].kills[0].playerLocations.push({
    subject: SKIN,
    location: { x: 1, y: 2 },
  });
  const a = normalizeAnalysis(r, cat(), roster());
  assert.equal(a.events.length, 1);
  assert.equal(
    a.events[0].positions.some((p) => p.subject === SKIN),
    false,
  );
});
test('duel grid counts unique opponent eliminations and real assists', () => {
  const players = roster(),
    a = normalizeAnalysis(raw(), cat(), players),
    d = { teamId: 'Blue', players, analysis: a };
  const grid = duelGrid(d);
  assert.equal(grid.cells.find((c) => c.ally.subject === ID).kills, 1);
  assert.equal(grid.assists.player.subject, THIRD);
  assert.equal(grid.assists.count, 1);
});
test('environment deaths and team kills are excluded from opponent duel ratios', () => {
  const r = raw();
  r.kills.push(
    kill({ round: 0, killer: '', gameTime: 90000 }),
    kill({ round: 0, victim: THIRD, gameTime: 80000 }),
  );
  const players = roster(),
    a = normalizeAnalysis(r, cat(), players),
    g = duelGrid({ teamId: 'Blue', players, analysis: a });
  assert.equal(g.events.length, 1);
  assert.equal(a.events.length, 3);
});
test('empty event list and missing telemetry are distinct', () => {
  assert.equal(normalizeAnalysis({}, cat(), roster()).available, false);
  assert.equal(normalizeAnalysis({ kills: [] }, cat(), roster()).available, true);
});
test('pathological round arrays are bounded with an explicit truncation flag', () => {
  const a = normalizeAnalysis(
    { roundResults: Array.from({ length: 201 }, (_, roundNum) => ({ roundNum })) },
    cat(),
    roster(),
  );
  assert.equal(a.rounds.length, 200);
  assert.equal(a.truncated, true);
});
test('catalog retains minimap coefficients and weapon icons', () => {
  const c = buildCatalog({
    maps: {
      data: [
        {
          uuid: SKIN,
          mapUrl: 'map-path',
          displayName: 'Fixture map',
          displayIcon: 'https://media.valorant-api.com/m.png',
          xMultiplier: 0.01,
          yMultiplier: -0.02,
          xScalarToAdd: 0,
          yScalarToAdd: 1,
        },
      ],
    },
    weapons: {
      data: [
        {
          uuid: GUN,
          displayName: 'Vandal',
          displayIcon: 'https://media.valorant-api.com/v.png',
          killStreamIcon: 'https://media.valorant-api.com/k.png',
          skins: [],
        },
      ],
    },
  });
  assert.equal(c.maps['map-path'].xScalarToAdd, 0);
  assert.match(c.weapons[GUN].killIcon, /k.png/);
  assert.equal(c.schemaVersion, require('../.test-build/catalog.js').CATALOG_SCHEMA_VERSION);
});
test('an empty round summary cannot fabricate a playable location', () => {
  const a = normalizeAnalysis(
    { roundResults: [{ roundNum: 0, plantRoundTime: 8000 }] },
    cat(),
    roster(),
  );
  assert.equal(a.events[0].location, undefined);
  assert.deepEqual(eventPositions(a.rounds[0], a.events[0]), []);
});
