import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  dist = path.join(root, 'dist-web'),
  out = path.join(root, 'docs', process.env.OUTPOST_VALIDATION_DIR ?? 'validation-1306');
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
const click = async (name) => page.getByRole('button', { name, exact: true }).click();
const tab = async (id) => page.getByTestId('tab-' + id).click();
const check = async (name, work) => {
  await work();
  checks.push(name);
  console.log('PASS', name);
};
const shot = async (name) =>
  page.screenshot({ path: path.join(out, name + '.png'), fullPage: true });
let delayed = 0,
  primaryFailures = 0,
  alternateLoads = 0;
const fixturePng = await fs.readFile(path.join(root, 'assets/icon.png'));
await page.route('**/playercards/**/wideart.png', async (route) => {
  delayed++;
  await new Promise((resolve) => setTimeout(resolve, 9000));
  await route.continue().catch(() => {});
});
await page.route('**/bundles/**/displayicon.png', async (route) => {
  primaryFailures++;
  await route.fulfill({ status: 404, body: 'fixture missing primary artwork' });
});
await page.route('**/bundles/**/displayicon2.png', async (route) => {
  alternateLoads++;
  await route.fulfill({ status: 200, contentType: 'image/png', body: fixturePng });
});
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'domcontentloaded' });
  await click('Try the demo');
  await check(
    'a profile card delayed beyond eight seconds eventually renders instead of being permanently hidden',
    async () => {
      await tab('matches');
      const scene = page.getByTestId('tab-scene-matches');
      await scene.locator('img[src*="/wideart.png"]').first().waitFor({ state: 'attached' });
      await page.waitForTimeout(8200);
      assert.ok((await scene.locator('img[src*="/wideart.png"]').count()) > 0);
      await page.waitForFunction(
        () =>
          [...document.querySelectorAll('[data-testid="tab-scene-matches"] img')].some(
            (img) => img.src.includes('/wideart.png') && img.complete && img.naturalWidth > 0,
          ),
        null,
        { timeout: 30000 },
      );
      assert.ok(delayed > 0);
      await shot('patch-profile-late-artwork');
    },
  );
  await check('Collection reuses the card and still opens the identity editor', async () => {
    await tab('collection');
    await page.getByTestId('collection-home').waitFor();
    await click('Change banner');
    await page.getByText('Player card & title', { exact: true }).waitFor();
    await click('Back from identity editor');
    await shot('patch-collection');
  });
  await check(
    'missing archive bundle art falls back without hiding its title or contents view',
    async () => {
      await tab('store');
      await page.getByRole('tab', { name: 'Bundles', exact: true }).click();
      await page
        .getByRole('button', { name: /^Open (?!After-hours).+ bundle$/ })
        .first()
        .click();
      await page.getByText('Collection items', { exact: true }).waitFor();
      await page.waitForFunction(
        () =>
          [...document.querySelectorAll('[role="dialog"] img')].some(
            (img) => img.src.includes('/displayicon2.png') && img.complete && img.naturalWidth > 0,
          ),
        null,
        { timeout: 20000 },
      );
      assert.ok(primaryFailures > 0);
      assert.ok(alternateLoads > 0);
      await shot('patch-bundle-fallback');
      await click('Back from bundle');
    },
  );
  await check('artwork updates keep narrow layouts within the viewport', async () => {
    for (const width of [320, 430]) {
      await page.setViewportSize({ width, height: 844 });
      await tab('collection');
      await page.waitForTimeout(200);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await shot('patch-collection-' + width);
    }
  });
  await check(
    'game-data controls are visible without exposing account refresh in demo mode',
    async () => {
      await tab('account');
      const action = page.getByRole('button', { name: 'Refresh game data', exact: true });
      await action.scrollIntoViewIfNeeded();
      assert.equal(await action.isDisabled(), true);
      await page.getByText('Game data · Demo', { exact: true }).waitFor();
      await shot('patch-game-data-settings');
    },
  );
  assert.deepEqual(errors, []);
  assert.equal(requests.length, 0);
  passed = true;
} catch (error) {
  await shot('patch-artwork-failure').catch(() => {});
  console.error(error);
  console.log(
    'IMAGE_LAYOUT',
    JSON.stringify(
      await page
        .locator('[role="dialog"]')
        .last()
        .evaluate((root) =>
          [...root.querySelectorAll('img,[role="img"]')].map((img) => ({
            src: img.getAttribute('src'),
            label: img.getAttribute('aria-label'),
            width: img.getBoundingClientRect().width,
            height: img.getBoundingClientRect().height,
            top: img.getBoundingClientRect().top,
            complete: img.complete,
            naturalWidth: img.naturalWidth,
          })),
        ),
    ),
  );
  process.exitCode = 1;
} finally {
  const result = {
    checks,
    errors,
    privateRiotRequests: requests.length,
    delayedCardRequests: delayed,
    simulatedPrimaryFailures: primaryFailures,
    alternateArtworkRequests: alternateLoads,
    passed,
  };
  await fs.writeFile(path.join(out, 'patch-artwork-browser.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
