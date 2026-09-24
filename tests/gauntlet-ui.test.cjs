const test = require('node:test'),
  assert = require('node:assert/strict');
const { harness, React, Renderer, act } = require('./loading-harness.cjs');
const { gauntletFixture } = require('./gauntlet-fixture.cjs');
for (const os of ['ios', 'android']) {
  test(`${os}: Gauntlet has eight selectable duos and no misleading two-team score header`, async (t) => {
    const h = harness({ os }),
      { LiveMatchHero, LiveRoster } = h.load('src/ui/LiveMatchView.tsx');
    const f = gauntletFixture();
    let tree, selected, opened;
    await act(() => {
      tree = Renderer.create(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(LiveMatchHero, { game: f.game }),
          React.createElement(LiveRoster, {
            game: f.game,
            ownId: f.ownId,
            onTeamChange: (id) => {
              selected = id;
            },
            onPlayer: (p) => {
              opened = p.subject;
            },
          }),
        ),
      );
    });
    t.after(() => act(() => tree.unmount()));
    assert.equal(tree.root.findAllByProps({ testID: 'live-score-enemy' }).length, 0);
    assert.match(JSON.stringify(tree.toJSON()), /6 of 8 duos remaining/);
    const tabs = tree.root
      .findAllByType('Pressable')
      .filter((n) => n.props.accessibilityRole === 'tab');
    assert.equal(tabs.length, 8);
    await act(() => tabs[6].props.onPress());
    assert.equal(selected, 'Duo7');
    assert.equal(
      tree.root.findByProps({ testID: 'gauntlet-duo-Duo7' }).props.accessibilityState.selected,
      true,
    );
    const player = f.game.players.find((p) => p.teamId === 'Duo7');
    await act(() =>
      tree.root.findByProps({ testID: `live-player-${player.subject}` }).props.onPress(),
    );
    assert.equal(opened, player.subject);
  });
}
for (const os of ['ios', 'android']) {
  test(`${os}: a health update changes the duo badge without losing selection or hiding eliminated teams`, async (t) => {
    const h = harness({ os }),
      { LiveRoster } = h.load('src/ui/LiveMatchView.tsx');
    const f = gauntletFixture();
    let tree;
    const render = (game) =>
      React.createElement(LiveRoster, { game, ownId: f.ownId, onPlayer() {} });
    await act(() => {
      tree = Renderer.create(render(f.game));
    });
    t.after(() => act(() => tree.unmount()));
    await act(() => tree.root.findByProps({ testID: 'gauntlet-duo-Duo2' }).props.onPress());
    const updated = structuredClone(f.game);
    updated.gauntlet.teams[1].health = 0;
    updated.gauntlet.teams[1].eliminated = true;
    await act(() => tree.update(render(updated)));
    const selected = tree.root.findByProps({ testID: 'gauntlet-duo-Duo2' });
    assert.equal(selected.props.accessibilityState.selected, true);
    assert.match(JSON.stringify(tree.toJSON()), /Eliminated/);
    assert.equal(
      tree.root.findAllByType('Pressable').filter((n) => n.props.accessibilityRole === 'tab')
        .length,
      8,
    );
  });
  test(`${os}: unknown status is not labelled alive, dead or zero health`, async (t) => {
    const h = harness({ os }),
      { LiveMatchHero, LiveRoster } = h.load('src/ui/LiveMatchView.tsx');
    const f = gauntletFixture({ health: false });
    let tree;
    await act(() => {
      tree = Renderer.create(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(LiveMatchHero, { game: f.game }),
          React.createElement(LiveRoster, { game: f.game, onPlayer() {} }),
        ),
      );
    });
    t.after(() => act(() => tree.unmount()));
    const text = JSON.stringify(tree.toJSON());
    assert.match(text, /Status not reported/);
    assert.match(text, /Team HP not reported/);
    assert.doesNotMatch(text, /8 of 8 duos remaining|0 team HP|Still in/);
  });
}
for (const os of ['ios', 'android']) {
  test(`${os}: completed scoreboard keeps the 16 players in eight duos with explicit placement`, async (t) => {
    const h = harness({ os }),
      { GauntletReportTeams } = h.load('src/ui/GauntletView.tsx');
    const f = gauntletFixture({ complete: true });
    let tree;
    await act(() => {
      tree = Renderer.create(
        React.createElement(GauntletReportTeams, {
          detail: f.report,
          ownId: f.ownId,
          renderPlayer: (p, friendly) =>
            React.createElement('ReportPlayer', { subject: p.subject, friendly }),
        }),
      );
    });
    t.after(() => act(() => tree.unmount()));
    assert.equal(tree.root.findAllByType('ReportPlayer').length, 16);
    assert.equal(
      tree.root
        .findAllByType('View')
        .filter((v) => v.props.testID?.startsWith('gauntlet-report-duo-')).length,
      8,
    );
    assert.ok(
      tree.root.findAllByType('Text').some((node) => node.children.join('') === 'Placed #3'),
    );
    assert.match(JSON.stringify(tree.toJSON()), /Winner/);
  });
  test(`${os}: hidden player names are not exposed in the duo selector`, async (t) => {
    const h = harness({ os }),
      { LiveRoster } = h.load('src/ui/LiveMatchView.tsx');
    const f = gauntletFixture();
    f.game.players[3].hidden = true;
    f.game.players[3].name = 'DoNotExposeThisName';
    let tree;
    await act(() => {
      tree = Renderer.create(
        React.createElement(LiveRoster, {
          game: f.game,
          ownId: f.ownId,
          onPlayer() {},
        }),
      );
    });
    t.after(() => act(() => tree.unmount()));
    assert.doesNotMatch(JSON.stringify(tree.toJSON()), /DoNotExposeThisName/);
  });
}
