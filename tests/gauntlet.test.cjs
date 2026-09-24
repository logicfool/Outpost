const test = require('node:test'),
  assert = require('node:assert/strict');
const { gauntletFixture } = require('./gauntlet-fixture.cjs');
const { ID, OTHER, MATCH } = require('./helpers.cjs');
const {
  readGauntlet,
  duoStatus,
  gauntletCounts,
  mergeGauntletLive,
  gauntletForReport,
  gauntletOwnResult,
  gauntletGroups,
} = require('../.test-build/gauntlet.js');
const {
  liveTeams,
  retainedLiveScore,
  LiveMatchMemory,
} = require('../.test-build/livePresentation.js');
const { ownLiveProgress } = require('../.test-build/liveProgress.js');
const { normalizeMatchDetail } = require('../.test-build/normalize.js');
const { mergeSnapshot } = require('../.test-build/snapshot.js');
const { makeDemo } = require('../.test-build/demo.js');
const {
  validateReportShape,
  validatePreviewShape,
} = require('../.test-build/archiveValidation.js');
const { matchPreview } = require('../.test-build/matchArchive.js');

test('Gauntlet groups eight separate duos instead of two opponents or one FFA roster', () => {
  const { game } = gauntletFixture({ health: false });
  const groups = liveTeams(game, ID);
  assert.equal(groups.length, 8);
  assert.ok(groups.every((g) => g.players.length === 2));
  assert.equal(groups[0].friendly, true);
  assert.ok(game.gauntlet.teams.every((t) => duoStatus(t, game.gauntlet) === 'unknown'));
  assert.equal(gauntletCounts(game.gauntlet).remaining, undefined);
});
test('reported team health reaches zero before a duo is marked eliminated', () => {
  const { game } = gauntletFixture();
  assert.equal(gauntletCounts(game.gauntlet).remaining, 6);
  assert.equal(gauntletCounts(game.gauntlet).eliminated, 2);
  assert.equal(duoStatus(game.gauntlet.teams[0], game.gauntlet), 'active');
});
test('generic scores, player health, missing values and round losses cannot imply elimination', () => {
  const roster = [{ subject: ID, teamId: 'Duo1' }];
  for (const TeamHealth of [undefined, null, '0', -1, Infinity, NaN]) {
    const state = readGauntlet(
      MATCH,
      [
        {
          TeamID: 'Duo1',
          TeamHealth,
          health: 0,
          RoundsWon: 0,
          numPoints: 0,
          won: false,
          roundResult: 'Eliminated',
        },
      ],
      roster,
    );
    assert.equal(duoStatus(state.teams[0], state), 'unknown');
  }
  const state = readGauntlet(MATCH, [{ TeamID: 'Duo1', TeamHealth: 20, RoundsWon: 0 }], roster);
  assert.equal(duoStatus(state.teams[0], state), 'active');
});
test('conflicting or incomplete elimination evidence does not create a remaining-team count', () => {
  const { game } = gauntletFixture();
  game.gauntlet.teams[0].health = 0;
  game.gauntlet.teams[0].eliminated = false;
  assert.equal(duoStatus(game.gauntlet.teams[0], game.gauntlet), 'unknown');
  assert.equal(gauntletCounts(game.gauntlet).remaining, undefined);
});
test('missing eliminated teams stay visible with old timestamps, not a fabricated fresh sample', () => {
  const before = gauntletFixture({ now: 1000 }).game;
  const next = gauntletFixture({ health: false, now: 6000 }).game;
  next.players = next.players.filter((p) => !['Duo7', 'Duo8'].includes(p.teamId));
  next.gauntlet.teams = next.gauntlet.teams.slice(0, 6);
  const merged = mergeGauntletLive(before, next);
  assert.equal(merged.gauntlet.teams.length, 8);
  assert.equal(merged.gauntlet.teams[7].evidenceAt, 1000);
  assert.equal(duoStatus(merged.gauntlet.teams[7], merged.gauntlet), 'eliminated');
  assert.equal(gauntletCounts(merged.gauntlet, 6000).remaining, undefined);
  assert.equal(merged.players.length, 12, 'retention must not extend current roster authorization');
});
test('missing live rows do not newly eliminate a team and an old response cannot undo a newer one', () => {
  const before = gauntletFixture({ health: false, now: 1000 }).game;
  const next = gauntletFixture({ health: false, now: 6000 }).game;
  next.gauntlet.teams = next.gauntlet.teams.slice(0, 2);
  const merged = mergeGauntletLive(before, next);
  assert.equal(merged.gauntlet.teams.length, 8);
  assert.equal(gauntletCounts(merged.gauntlet, 6000).eliminated, 0);
  assert.equal(mergeGauntletLive(merged, before), merged);
});
test('team retention cannot cross accounts, match changes or returning to lobby', () => {
  const before = gauntletFixture().game,
    other = gauntletFixture({ health: false }).game;
  other.players[0].subject = OTHER;
  assert.equal(mergeGauntletLive(before, other), other);
  const changed = { ...before, matchId: OTHER, gauntlet: { ...before.gauntlet, matchId: OTHER } };
  assert.equal(mergeGauntletLive(before, changed), changed);
  const idle = { state: 'idle' };
  assert.equal(mergeGauntletLive(before, idle), idle);
  const previous = makeDemo().snapshot,
    next = { ...previous, accountId: OTHER };
  previous.liveGame = { status: 'ready', data: before, fetchedAt: 1 };
  next.liveGame = { status: 'ready', data: other, fetchedAt: 2 };
  assert.equal(mergeSnapshot(previous, next), next);
});
test('leaving after elimination records your result but does not finalize the remaining tournament', () => {
  const f = gauntletFixture();
  f.reportRaw.teams[0].isEliminated = true;
  f.reportRaw.teams[0].teamHealth = 0;
  const report = normalizeMatchDetail(f.reportRaw, ID, f.catalog);
  assert.equal(report.result, 'LOSS');
  assert.equal(report.completed, false);
  assert.equal(gauntletOwnResult(report), 'Duo eliminated');
  assert.equal(report.placement, undefined);
});
test('final standings preserve explicit placements through history and backup without sorting by kills', () => {
  const { report } = gauntletFixture({ complete: true });
  assert.equal(report.placement, 3);
  assert.equal(gauntletOwnResult(report), 'Placed #3');
  assert.equal(report.score, '-');
  assert.equal(
    report.gauntlet.teams.filter((t) => duoStatus(t, report.gauntlet) === 'winner').length,
    1,
  );
  const preview = matchPreview(report);
  assert.equal(preview.placement, 3);
  validatePreviewShape(preview);
  validateReportShape(report);
  const old = { ...report, gauntlet: undefined, placement: undefined };
  assert.equal(gauntletForReport(old).teams.length, 8);
  assert.equal(gauntletOwnResult(old), 'Duo eliminated');
});
test('backup validation rejects invalid placement, health, duplicate teams and cross-match evidence', () => {
  const { report } = gauntletFixture({ complete: true });
  for (const mutate of [
    (d) => {
      d.placement = 9;
    },
    (d) => {
      d.gauntlet.teams[0].health = -1;
    },
    (d) => {
      d.gauntlet.matchId = OTHER;
    },
    (d) => {
      d.gauntlet.teams[1].id = d.gauntlet.teams[0].id;
    },
    (d) => {
      d.gauntlet.teams[0].placement = 1.5;
    },
  ]) {
    const bad = structuredClone(report);
    mutate(bad);
    assert.throws(() => validateReportShape(bad));
  }
});
test('a final-two Gauntlet roster stays survival mode and clears previously retained two-team scores', () => {
  const { game } = gauntletFixture();
  game.players = game.players.slice(0, 4);
  game.gauntlet.teams = game.gauntlet.teams.slice(0, 2);
  const progress = { allyScore: 3, enemyScore: 2, observedAt: Date.now(), source: 'match' };
  game.progress = progress;
  assert.equal(ownLiveProgress(game, undefined, true), undefined);
  const view = new LiveMatchMemory().forMatch(ID, game.matchId);
  view.score = progress;
  assert.equal(retainedLiveScore(view, game, progress), undefined);
  assert.equal(view.score, undefined);
});
test('unassigned players stay reachable without being arbitrarily paired or counted as a duo', () => {
  const { game } = gauntletFixture();
  game.players[0].teamId = '';
  const groups = gauntletGroups(game, ID);
  const unknown = groups.find((g) => g.id === '@unassigned');
  assert.equal(unknown.players[0].subject, ID);
  assert.equal(game.gauntlet.teams.length, 8);
});
test('one remaining live duo is not announced winner before the tournament result', () => {
  const { game } = gauntletFixture();
  game.gauntlet.teams.slice(1).forEach((t) => {
    t.health = 0;
    t.eliminated = true;
  });
  assert.equal(gauntletCounts(game.gauntlet).remaining, 1);
  assert.equal(duoStatus(game.gauntlet.teams[0], game.gauntlet), 'active');
});
test('cached team data is ignored if its match identity does not match the enclosing response', () => {
  const { gauntletForGame } = require('../.test-build/gauntlet.js');
  const { game, report } = gauntletFixture({ complete: true });
  game.gauntlet.matchId = OTHER;
  const live = gauntletForGame(game);
  assert.equal(live.matchId, MATCH);
  assert.equal(
    live.teams.every((t) => duoStatus(t, live) === 'unknown'),
    true,
  );
  report.gauntlet.matchId = OTHER;
  assert.equal(gauntletForReport(report).matchId, MATCH);
  assert.equal(
    gauntletForReport(report).teams.every((t) => t.placement === undefined),
    true,
  );
});
test('observer entries cannot become a ninth competing duo', () => {
  const { normalizeLive } = require('../.test-build/live.js');
  const f = gauntletFixture();
  f.raw.Players.push({ Subject: OTHER, TeamID: 'Observer', IsObserver: true });
  const game = normalizeLive(f.raw, 'in_game', MATCH, ID, f.catalog);
  assert.equal(game.players.length, 16);
  assert.equal(game.gauntlet.teams.length, 8);
  f.reportRaw.players.push({ subject: OTHER, teamId: 'Observer', isObserver: true });
  const detail = normalizeMatchDetail(f.reportRaw, ID, f.catalog);
  assert.equal(detail.players.length, 16);
  assert.equal(detail.gauntlet.teams.length, 8);
});
test('equal round totals in a final-two response cannot invent a tournament draw', () => {
  const f = gauntletFixture({ health: false });
  f.reportRaw.matchInfo.isCompleted = true;
  f.reportRaw.teams = f.reportRaw.teams
    .slice(0, 2)
    .map((t) => ({ ...t, roundsWon: 2, won: false }));
  f.reportRaw.players = f.reportRaw.players.slice(0, 4);
  const result = normalizeMatchDetail(f.reportRaw, ID, f.catalog);
  assert.equal(result.result, 'UNKNOWN');
  assert.equal(result.score, '-');
});

test('documented live IsCoach entries do not become competing players or a ninth duo', () => {
  const { normalizeLive } = require('../.test-build/live.js');
  const f = gauntletFixture();
  f.raw.Players.push({ Subject: OTHER, TeamID: 'CoachOnly', IsCoach: true });
  const game = normalizeLive(f.raw, 'in_game', MATCH, ID, f.catalog);
  assert.equal(game.players.length, 16);
  assert.equal(game.gauntlet.teams.length, 8);
});
test('team identity casing changes retain selection keys and earlier terminal evidence', () => {
  const before = gauntletFixture({ now: 1000 }).game;
  const next = gauntletFixture({ health: false, now: 6000 }).game;
  next.players.forEach((p) => {
    p.teamId = p.teamId.toLowerCase();
  });
  next.gauntlet.teams.forEach((t) => {
    t.id = t.id.toLowerCase();
  });
  const merged = mergeGauntletLive(before, next);
  assert.deepEqual(
    merged.gauntlet.teams.map((t) => t.id),
    before.gauntlet.teams.map((t) => t.id),
  );
  assert.equal(duoStatus(merged.gauntlet.teams[7], merged.gauntlet), 'eliminated');
});
test('an explicit final placement resolves a departed duo without requiring its team health', () => {
  const f = gauntletFixture({ health: false });
  f.reportRaw.teams[0].finalPlacement = 5;
  const detail = normalizeMatchDetail(f.reportRaw, ID, f.catalog);
  assert.equal(detail.completed, false);
  assert.equal(detail.placement, 5);
  assert.equal(detail.result, 'LOSS');
  assert.equal(gauntletOwnResult(detail), 'Placed #5');
});

test('conflicting tournament data keeps unconfirmed duos unknown', () => {
  for (const fields of [
    { won: true, finalPlacement: 5 },
    { won: true, teamHealth: 0 },
    { finalPlacement: 1, won: false },
  ]) {
    const state = readGauntlet(
      MATCH,
      [{ teamId: 'First', ...fields }, { teamId: 'Second' }],
      [],
      true,
      1000,
    );
    assert.equal(duoStatus(state.teams[0], state), 'unknown');
    assert.equal(duoStatus(state.teams[1], state), 'unknown');
    assert.equal(gauntletCounts(state, 1000).remaining, undefined);
  }
});
test('completed placement-only standings resolve the winning duo but interim positions do not', () => {
  const raw = [
    { teamId: 'First', finalPlacement: 2 },
    { teamId: 'Second', finalPlacement: 1 },
  ];
  const done = readGauntlet(MATCH, raw, [], true, 1000);
  assert.equal(duoStatus(done.teams[0], done), 'eliminated');
  assert.equal(duoStatus(done.teams[1], done), 'winner');
  const running = readGauntlet(MATCH, [{ teamId: 'First', placement: 2 }], [], false, 1000);
  assert.equal(running.teams[0].placement, undefined);
  assert.equal(duoStatus(running.teams[0], running), 'unknown');
});
