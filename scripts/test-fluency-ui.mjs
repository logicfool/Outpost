import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  dist = path.join(root, 'dist-web'),
  out = path.join(root, 'docs', process.env.OUTPOST_VALIDATION_DIR ?? 'validation-fluency');
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
  click = async (name) => button(name).click();
const tab = async (name) => page.getByRole('tab', { name, exact: true }).click();
const mainTab = async (id) => page.getByTestId('tab-' + id).click();
const shot = async (name) => {
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(out, name + '.png'), fullPage: true });
};
const check = async (name, work) => {
  await work();
  checks.push(name);
  console.log('PASS', name);
};
const scrollElement = (scene) =>
  scene.evaluateHandle((root) =>
    [...root.querySelectorAll('*')].find(
      (node) =>
        node.scrollHeight > node.clientHeight + 100 &&
        ['auto', 'scroll'].includes(getComputedStyle(node).overflowY),
    ),
  );
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'networkidle' });
  await click('Try the demo');
  await check('unvisited tabs are not eagerly mounted or rendered', async () => {
    await page.getByTestId('compact-wallet').waitFor();
    assert.equal(await page.locator('[data-testid^="tab-scene-"]').count(), 1);
    assert.equal(await page.getByTestId('tab-scene-store').isVisible(), true);
  });
  await check(
    'the compact balance strip keeps all three currencies and readable values',
    async () => {
      const wallet = page.getByTestId('compact-wallet');
      for (const label of ['VP', 'RP', 'KC'])
        await wallet.getByText(label, { exact: true }).waitFor();
      const bounds = await wallet.boundingBox();
      assert.ok(bounds.height >= 44 && bounds.height <= 72);
      await shot('fluency-store');
    },
  );
  await check('Store category and local bundle search survive switching tabs', async () => {
    await tab('Bundles');
    await click('Search bundles');
    await page.getByRole('textbox', { name: 'Bundle search', exact: true }).fill('After-hours');
    await mainTab('collection');
    await page.getByTestId('collection-home').waitFor();
    await mainTab('store');
    assert.equal(
      await page.getByRole('tab', { name: 'Bundles', exact: true }).getAttribute('aria-selected'),
      'true',
    );
    assert.equal(
      await page.getByRole('textbox', { name: 'Bundle search', exact: true }).inputValue(),
      'After-hours',
    );
    await button('Open After-hours collection bundle').first().waitFor();
    await click('Close bundle search');
    await tab('Today');
  });
  await check('Friends keeps its search and does not expose hidden tab controls', async () => {
    await mainTab('friends');
    await page
      .getByRole('textbox', { name: 'Search friends directory', exact: true })
      .fill('Lumen');
    await button('View Lumen profile').waitFor();
    await mainTab('collection');
    assert.equal(
      await page.getByRole('textbox', { name: 'Search friends directory', exact: true }).count(),
      0,
    );
    await mainTab('friends');
    assert.equal(
      await page
        .getByRole('textbox', { name: 'Search friends directory', exact: true })
        .inputValue(),
      'Lumen',
    );
    await page.getByRole('textbox', { name: 'Search friends directory', exact: true }).fill('');
  });
  await check(
    'Profile keeps its scroll position instead of reconstructing the top on tab return',
    async () => {
      await mainTab('matches');
      await page.getByTestId('tab-scene-matches').waitFor();
      await page.waitForTimeout(400);
      const scene = page.getByTestId('tab-scene-matches'),
        scroller = await scrollElement(scene);
      assert.ok(await scroller.evaluate((node) => !!node));
      await scroller.evaluate((node) => {
        node.scrollTop = 460;
      });
      await page.waitForTimeout(150);
      const before = await scroller.evaluate((node) => node.scrollTop);
      assert.ok(before > 200);
      await mainTab('store');
      await mainTab('matches');
      await page.waitForTimeout(200);
      assert.ok(Math.abs((await scroller.evaluate((node) => node.scrollTop)) - before) <= 2);
      await scroller.evaluate((node) => {
        node.scrollTop = 0;
      });
    },
  );
  await check(
    'banner editing remains available and repeat visits do not hide already loaded artwork',
    async () => {
      await mainTab('collection');
      await click('Change banner');
      await page
        .getByRole('dialog')
        .last()
        .getByText('Player card & title', { exact: true })
        .waitFor();
      await button('Back from identity editor').waitFor();
      await click('Back from identity editor');
      const banner = page
        .getByTestId('collection-home')
        .locator('[data-testid^="artwork-boundary-"]')
        .first();
      await page.waitForTimeout(500);
      await mainTab('store');
      await mainTab('collection');
      assert.equal(await banner.getByRole('progressbar').count(), 0);
      await shot('fluency-collection');
    },
  );
  await check('all features stay reachable after repeated retained-tab switches', async () => {
    for (const id of [
      'progress',
      'account',
      'store',
      'matches',
      'friends',
      'collection',
      'store',
      'collection',
    ]) {
      await mainTab(id);
      assert.equal(await page.getByTestId('tab-' + id).getAttribute('aria-selected'), 'true');
    }
    assert.equal(await page.locator('[data-testid^="tab-scene-"]').count(), 6);
    await button('Change banner').waitFor();
    await button('Weapon loadout').waitFor();
    await button('Saved loadouts').waitFor();
    await button('Aim presets').waitFor();
  });
  await check('compact layout stays within 320px and 430px in dark and light themes', async () => {
    for (const theme of ['Dark', 'Light']) {
      await mainTab('account');
      await tab(theme);
      for (const width of [320, 430]) {
        await page.setViewportSize({ width, height: 844 });
        await mainTab('store');
        await page.waitForTimeout(220);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        const wallet = await page.getByTestId('compact-wallet').boundingBox();
        assert.ok(wallet.x >= 0 && wallet.x + wallet.width <= width);
        await shot('fluency-store-' + theme + '-' + width);
        await mainTab('matches');
        const scroller = await scrollElement(page.getByTestId('tab-scene-matches'));
        await scroller.evaluate((node) => {
          if (node) node.scrollTop = 0;
        });
        await shot('fluency-profile-' + theme + '-' + width);
      }
    }
  });
  assert.deepEqual(errors, []);
  assert.equal(requests.length, 0);
  passed = true;
} catch (error) {
  await shot('fluency-failure').catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  const result = { checks, errors, privateRiotRequests: requests.length, passed };
  await fs.writeFile(path.join(out, 'fluency-browser.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
