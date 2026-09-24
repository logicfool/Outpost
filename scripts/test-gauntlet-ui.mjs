import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { gauntletFixture } = require('../tests/gauntlet-fixture.cjs');
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'outpost-gauntlet-ui-'));
const out = path.join(
  root,
  'docs',
  process.env.OUTPOST_VALIDATION_DIR ?? 'validation-gauntlet/browser',
);
await fs.mkdir(out, { recursive: true });
await fs.cp(path.join(root, 'src'), path.join(temp, 'src'), { recursive: true });
await fs.cp(path.join(root, 'assets'), path.join(temp, 'assets'), { recursive: true });
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
await fs.writeFile(path.join(temp, 'package.json'), JSON.stringify({ ...pkg, scripts: {} }));
await fs.symlink(path.join(root, 'node_modules'), path.join(temp, 'node_modules'), 'dir');
await fs.copyFile(path.join(root, 'scripts/gauntlet-preview.jsx'), path.join(temp, 'App.jsx'));
await fs.writeFile(
  path.join(temp, 'index.js'),
  "import { registerRootComponent } from 'expo'; import App from './App'; registerRootComponent(App);",
);
await fs.writeFile(
  path.join(temp, 'app.json'),
  JSON.stringify({
    expo: {
      name: 'Gauntlet fixture',
      slug: 'gauntlet-fixture',
      web: { bundler: 'metro' },
    },
  }),
);
await fs.writeFile(
  path.join(temp, 'metro.config.js'),
  `const { getDefaultConfig } = require('expo/metro-config');
const config=getDefaultConfig(__dirname); config.watchFolders=[${JSON.stringify(path.join(root, 'node_modules'))}];
config.resolver.nodeModulesPaths=[${JSON.stringify(path.join(root, 'node_modules'))}]; module.exports=config;`,
);
const live = gauntletFixture(),
  final = gauntletFixture({ complete: true });
await fs.writeFile(
  path.join(temp, 'fixture.json'),
  JSON.stringify({
    ...live,
    unknown: gauntletFixture({ health: false }).game,
    report: final.report,
  }),
);
const build = spawnSync(
  process.execPath,
  [
    path.join(root, 'node_modules/expo/bin/cli'),
    'export',
    '--platform',
    'web',
    '--max-workers',
    '1',
    '--output-dir',
    'dist-web',
  ],
  { cwd: temp, env: { ...process.env, CI: '1' }, encoding: 'utf8', timeout: 180000 },
);
await fs.writeFile(path.join(out, 'fixture-build.log'), `${build.stdout}\n${build.stderr}`);
assert.equal(build.status, 0, 'Fixture production export failed; see fixture-build.log');
const dist = path.join(temp, 'dist-web');
const mime = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ttf': 'font/ttf',
};
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const target = path.resolve(
      dist,
      '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)),
    );
    if (!target.startsWith(dist + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': mime[path.extname(target)] ?? 'application/octet-stream',
    });
    res.end(await fs.readFile(target));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  reducedMotion: 'reduce',
});
const checks = [],
  errors = [],
  requests = [];
let passed = false;
page.on('pageerror', (e) => errors.push(e.message));
page.on('request', (r) => {
  if (/auth\.riotgames|\.pvp\.net/.test(r.url())) requests.push(r.url());
});
const button = (name) => page.getByRole('button', { name, exact: true });
const check = async (name, work) => {
  await work();
  checks.push(name);
  console.log('PASS', name);
};
const shot = (name) => page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true });
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'domcontentloaded' });
  await check('Gauntlet shows eight separate duos and a survival summary', async () => {
    await page.getByText('6 of 8 duos remaining', { exact: true }).waitFor();
    assert.equal(await page.getByRole('tab').count(), 8);
    assert.equal(await page.getByTestId('live-score-enemy').count(), 0);
    await shot('eight-duos');
  });
  await check(
    'elimination updates preserve selected team and keep player details reachable',
    async () => {
      await page.getByTestId('gauntlet-duo-Duo2').click();
      await button('Eliminate duo 2').click();
      await page.getByText('5 of 8 duos remaining', { exact: true }).waitFor();
      assert.equal(
        await page.getByTestId('gauntlet-duo-Duo2').getAttribute('aria-selected'),
        'true',
      );
      await page
        .getByTestId('gauntlet-duo-Duo2')
        .getByText('Eliminated', { exact: true })
        .waitFor();
      const id = live.game.players[2].subject;
      await page.getByTestId(`live-player-${id}`).click();
      assert.equal(
        await page.getByTestId('opened-player').textContent(),
        live.game.players[2].name,
      );
      await shot('selected-eliminated-duo');
    },
  );
  await check(
    'partial responses retain eliminated duos as last reported rather than live certainty',
    async () => {
      await button('Partial update').click();
      assert.equal(await page.getByRole('tab').count(), 8);
      await page
        .getByTestId('gauntlet-duo-Duo7')
        .getByText('Eliminated', { exact: true })
        .waitFor();
      await page
        .getByTestId('gauntlet-duo-Duo7')
        .getByText('Last reported', { exact: true })
        .waitFor();
      assert.equal(await page.getByText(/of 8 duos remaining/).count(), 0);
    },
  );
  await check(
    'missing team health remains unknown and does not fabricate eliminations',
    async () => {
      await button('Unknown health').click();
      await page.getByText('Duo survival', { exact: true }).waitFor();
      assert.equal(await page.getByText('Status not reported', { exact: true }).count(), 8);
      assert.equal(await page.getByText('Team HP not reported', { exact: true }).count(), 8);
    },
  );
  await check(
    'full match report shows placement and eight duo sections instead of an arbitrary head-to-head score',
    async () => {
      await button('Report').click();
      await page.getByTestId('gauntlet-report-teams').waitFor();
      assert.equal(await page.locator('[data-testid^="gauntlet-report-duo-"]').count(), 8);
      await page.getByText('Placed #3', { exact: true }).first().waitFor();
      assert.equal(await page.getByRole('tab', { name: 'Rounds', exact: true }).count(), 0);
      await shot('final-duos-report');
    },
  );
  await check('Gauntlet layouts stay inside narrow phones in dark and light themes', async () => {
    for (const width of [320, 430])
      for (const theme of ['Dark', 'Light'])
        for (const mode of ['Live', 'Report']) {
          await page.setViewportSize({ width, height: 844 });
          await button(theme).click();
          await button(mode).click();
          await page.waitForTimeout(100);
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
          await shot(`${mode}-${theme}-${width}`);
        }
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
  passed = true;
} catch (error) {
  await shot('failure').catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  await fs.writeFile(
    path.join(out, 'gauntlet-browser.json'),
    JSON.stringify(
      {
        checks,
        errors,
        privateRiotRequests: requests.length,
        passed,
        fixture:
          'Synthetic team health, elimination and placement; production rendering components',
      },
      null,
      2,
    ),
  );
  await browser.close();
  await new Promise((r) => server.close(r));
  // Only this runner's temporary copy is removed; the working repository is untouched.
  await fs.rm(temp, { recursive: true, force: true });
}
