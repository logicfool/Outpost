import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  dist = path.join(root, 'dist-web'),
  out = path.join(root, 'docs/validation-0.9.4.1');
const mime = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ttf': 'font/ttf',
};
const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://localhost'),
      f = path.resolve(
        dist,
        '.' + (u.pathname === '/' ? '/index.html' : decodeURIComponent(u.pathname)),
      );
    if (!f.startsWith(dist + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': mime[path.extname(f)] ?? 'application/octet-stream' });
    res.end(await fs.readFile(f));
  } catch {
    res.writeHead(404).end();
  }
});
await fs.mkdir(out, { recursive: true });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ headless: true }),
  context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    acceptDownloads: true,
    reducedMotion: 'reduce',
  }),
  page = await context.newPage();
const errors = [],
  requests = [],
  checks = [];
let passed = false;
page.on('pageerror', (e) => errors.push(e.message));
page.on('request', (r) => {
  if (/auth\.riotgames|pd\..*pvp\.net|glz-/.test(r.url())) requests.push(r.url());
});
const button = (name) => page.getByRole('button', { name, exact: true }),
  click = async (name) => button(name).click(),
  tab = async (name) => page.getByRole('tab', { name, exact: true }).click();
const shot = async (name) => {
  await page.waitForTimeout(450);
  await page.screenshot({ path: path.join(out, name + '.png'), fullPage: true });
};
const check = async (name, work) => {
  await work();
  checks.push(name);
  console.log('PASS', name);
};
const noConnectionControls = async () => {
  for (const name of ['Connect friends', 'Connect Riot chat', 'Disconnect chat', 'Reconnect chat'])
    assert.equal(await button(name).count(), 0, name);
};
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'networkidle' });
  await click('Try the demo');
  await check(
    'Friends and pending requests connect automatically without connection buttons',
    async () => {
      await tab('Friends');
      await button('View Lumen profile').waitFor();
      await noConnectionControls();
      await click('Friend requests (2)');
      await page.getByRole('tab', { name: 'Incoming (2)', exact: true }).waitFor();
      await noConnectionControls();
      await click('Back from friend requests');
    },
  );
  await check(
    'live match combines map, score and team labels without repeated empty KDA',
    async () => {
      await tab('Profile');
      await click('View live game details');
      await page.getByTestId('live-match-hero').waitFor();
      await page.getByTestId('live-roster').waitFor();
      assert.equal(await page.locator('[data-testid^="live-player-"]').count(), 10);
      assert.equal(await page.getByTestId('live-kda-value').count(), 0);
      assert.equal(await page.getByTestId('live-stats-unavailable').count(), 1);
      assert.ok(!/K\/D\/A\s*-\s*\//.test(await page.locator('body').innerText()));
      await page.getByText('Your team', { exact: false }).first().waitFor();
      await shot('live-redesign-navy');
    },
  );
  await check(
    'live roster clearly marks You and remains compact with usable profile targets',
    async () => {
      const rows = page.locator('[data-testid^="live-player-"]');
      const heights = await rows.evaluateAll((elements) =>
        elements.map((e) => e.getBoundingClientRect().height),
      );
      assert.ok(
        heights.every((h) => h >= 60 && h <= 95),
        heights.join(','),
      );
      await button('View You profile').waitFor();
      await click('View Ferro profile');
      await button('Add friend').waitFor();
      await noConnectionControls();
      await click('Back from player profile');
    },
  );
  await check(
    'live data disclosure explains missing counters once without inventing statistics',
    async () => {
      assert.equal(await page.getByTestId('live-progress-source').count(), 0);
      await click('Live data details');
      await page.getByTestId('live-progress-source').waitFor();
      await page
        .getByText(
          'Only counters returned for this match are shown. Missing stats are not treated as zero.',
          { exact: true },
        )
        .waitFor();
      await click('Live data details');
    },
  );
  await check(
    'live scoreboard fits 320px and 430px screens without horizontal overflow',
    async () => {
      for (const width of [320, 430]) {
        await page.setViewportSize({ width, height: 844 });
        await page.waitForTimeout(200);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        const rows = await page
          .locator('[data-testid^="live-player-"]')
          .evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().right));
        assert.ok(rows.every((x) => x <= width));
        await shot('live-redesign-' + width);
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await click('Back from live match');
    },
  );
  await check('live match typography and team panels adapt to dark and light themes', async () => {
    for (const theme of ['Dark', 'Light']) {
      await tab('Settings');
      await tab(theme);
      await tab('Profile');
      await click('View live game details');
      await page.getByTestId('live-roster').waitFor();
      await shot('live-redesign-' + theme.toLowerCase());
      await click('Back from live match');
    }
  });
  await check(
    'chat, conversation and participant settings have no manual connection workflow',
    async () => {
      await tab('Friends');
      await click('Open chats');
      await noConnectionControls();
      await tab('Online');
      await click('Open conversation with Lumen');
      await noConnectionControls();
      await click('Conversation settings');
      await noConnectionControls();
      await click('Back from chat settings');
      await click('View chat participant profile');
      await noConnectionControls();
      await click('Back from player profile');
      await click('Back from conversation');
      assert.equal(
        await page.getByRole('tab', { name: 'Online', exact: true }).getAttribute('aria-selected'),
        'true',
      );
      await click('Back from friends');
    },
  );
  await check(
    'restarting the app restores Friends without prompting for chat connection',
    async () => {
      await page.reload();
      await click('Try the demo');
      await tab('Friends');
      await button('View Lumen profile').waitFor();
      await noConnectionControls();
      await click('Open chats');
      await tab('All friends');
      await button('Open conversation with Kestrel').waitFor();
      await noConnectionControls();
    },
  );
  assert.deepEqual(errors, []);
  assert.equal(requests.length, 0);
  passed = true;
} catch (error) {
  await shot('live-auto-failure').catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  const result = { checks, errors, privateRiotRequests: requests.length, passed };
  await fs.writeFile(path.join(out, 'live-auto-browser.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
  await new Promise((r) => server.close(r));
}
