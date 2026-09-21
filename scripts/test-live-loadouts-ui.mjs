import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  dist = path.join(root, 'dist-web'),
  out = path.join(root, 'docs', process.env.OUTPOST_VALIDATION_DIR ?? 'validation-0.9.5');
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
  await tab('Profile');
  await click('View live game details');
  await check(
    'score sits in a dedicated strip and team selector displays only the selected side',
    async () => {
      await page.getByTestId('live-score-ally').getByText('7', { exact: true }).waitFor();
      await page.getByTestId('live-score-enemy').getByText('5', { exact: true }).waitFor();
      await tab('Your team');
      assert.equal(await page.locator('[data-testid^="live-player-"]').count(), 5);
      await button('View You profile').waitFor();
      assert.equal(await button('Refresh live game').count(), 0);
      await shot('live-match-your-team');
      await tab('Opponents');
      assert.equal(await page.locator('[data-testid^="live-player-"]').count(), 5);
      await button('View Lumen profile').waitFor();
      await shot('live-match-opponents');
    },
  );
  await check(
    'player tap opens cover agent rank and equipment without loading a history page first',
    async () => {
      await click('View Lumen profile');
      await page.getByTestId('live-player-cover').waitFor();
      await page.getByTestId('live-player-rank').waitFor();
      await page.locator('[data-testid^="live-weapon-"]').first().waitFor();
      const dialog = page.getByRole('dialog').last();
      assert.equal(await dialog.getByText('Match history', { exact: true }).count(), 0);
      await button('View full player profile').waitFor();
      await shot('live-player-loadout');
    },
  );
  await check(
    'weapon filters and search run locally and clear back to the full returned loadout',
    async () => {
      const input = page.getByRole('textbox', { name: 'Search match loadout', exact: true });
      await input.fill('vandal');
      const rows = page.locator('[data-testid^="live-weapon-"]');
      assert.ok((await rows.count()) > 0);
      assert.ok((await rows.allInnerTexts()).every((text) => /vandal/i.test(text)));
      await input.fill('zz-no-weapon-matches');
      await page.getByText('No matching equipment', { exact: true }).waitFor();
      assert.equal(await rows.count(), 0);
      await input.fill('');
      assert.ok((await rows.count()) > 0);
      await shot('live-player-loadout-search');
    },
  );
  await check(
    'opening an equipped cosmetic returns to the same participant, not a different player',
    async () => {
      const input = page.getByRole('textbox', { name: 'Search match loadout', exact: true });
      await input.fill('vandal');
      await button('View equipped Vandal').click();
      await button('Close item details').waitFor();
      await click('Close item details');
      await page.getByTestId('live-player-cover').waitFor();
      await page.getByRole('dialog').last().getByText(/Lumen/).first().waitFor();
      await click('Back from player profile');
      assert.equal(
        await page
          .getByRole('tab', { name: 'Opponents', exact: true })
          .getAttribute('aria-selected'),
        'true',
      );
      await button('View Lumen profile').waitFor();
    },
  );
  await check(
    'shared match loadout selector keeps participants scoped to the current roster',
    async () => {
      await click('Match skins');
      await page.getByRole('tab', { name: 'You', exact: true }).waitFor();
      await tab('Lumen');
      await page.getByTestId('live-player-cover').waitFor();
      await page.locator('[data-testid^="live-weapon-"]').first().waitFor();
      await shot('match-loadout-player-switcher');
      await click('Back from match skins');
      await click('Back from live match');
    },
  );
  await check(
    'live match and contextual equipment fit small and large phones in both themes',
    async () => {
      for (const theme of ['Dark', 'Light']) {
        await tab('Settings');
        await tab(theme);
        await tab('Profile');
        await click('View live game details');
        await tab('Your team');
        for (const width of [320, 430]) {
          await page.setViewportSize({ width, height: 844 });
          await page.waitForTimeout(220);
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
          await shot(`live-team-${theme}-${width}`);
        }
        await click('View You profile');
        await page.getByTestId('live-player-cover').waitFor();
        await page.locator('[data-testid^="live-weapon-"]').first().waitFor();
        await page.setViewportSize({ width: 320, height: 844 });
        await page.waitForTimeout(220);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await shot(`live-self-loadout-${theme}-320`);
        await click('Back from player profile');
        await click('Back from live match');
      }
    },
  );
  assert.deepEqual(errors, []);
  assert.equal(requests.length, 0);
  passed = true;
} catch (error) {
  await shot('live-loadout-failure').catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  const result = { checks, errors, privateRiotRequests: requests.length, passed };
  await fs.writeFile(path.join(out, 'live-loadout-browser.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
  await new Promise((r) => server.close(r));
}
