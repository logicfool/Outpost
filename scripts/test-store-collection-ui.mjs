import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import crosshair from '../.test-build/crosshair.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  out = path.join(root, 'docs/validation-0.9.5'),
  dist = path.join(root, 'dist-web');
const mime = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
  '.json': 'application/json',
};
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost'),
      file = path.resolve(
        dist,
        '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)),
      );
    if (!file.startsWith(dist + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream' });
    res.end(await fs.readFile(file));
  } catch {
    res.writeHead(404).end();
  }
});
await fs.mkdir(out, { recursive: true });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/`,
  browser = await chromium.launch({ headless: true }),
  context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
  }),
  page = await context.newPage();
const errors = [],
  requests = [],
  checks = [];
let passed = false;
page.on('pageerror', (e) => errors.push(e.message));
page.on('request', (r) => {
  if (/player-preferences-|auth\.riotgames|pd\..*pvp\.net|glz-/.test(r.url()))
    requests.push(r.url());
});
const button = (name) => page.getByRole('button', { name, exact: true });
const click = async (name) => {
  await button(name).click();
};
const tab = async (name) => {
  await page.getByRole('tab', { name, exact: true }).click();
};
const shot = async (name) => {
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
};
const check = async (name, work) => {
  await work();
  checks.push(name);
  console.log('PASS', name);
};
const CODE =
  '0;s;1;P;h;0;f;0;0t;1;0l;20;0v;0;0g;1;0o;2;0a;1;0m;1;0s;0;0e;0;1t;4;1l;1;1v;1;1g;1;1o;0;1a;1;1m;0;1e;0.722;S;s;1.01;o;1';
const selected = async (name) =>
  assert.equal(
    await page.getByRole('tab', { name, exact: true }).getAttribute('aria-selected'),
    'true',
  );
const firstItem = () =>
  page
    .getByTestId('collection-browser-list')
    .getByRole('button', { name: /^View / })
    .first();
try {
  await page.goto(base, { waitUntil: 'networkidle' });
  await click('Try the demo');
  await tab('Collection');
  await check(
    'the supplied fractional-sniper crosshair imports, previews and exports exactly',
    async () => {
      await click('Crosshairs');
      await click('Import code');
      await page.getByLabel('Imported crosshair name', { exact: true }).fill('Fractional sniper');
      await page.getByLabel('Import crosshair code', { exact: true }).fill(CODE);
      await click('Preview imported crosshair');
      await tab('Sniper');
      await page.getByText('1.01', { exact: true }).waitFor();
      await shot('fractional-sniper-preview');
      await click('Export crosshair code');
      const code = await page.getByTestId('crosshair-export-code').innerText();
      assert.deepEqual(
        crosshair.importCrosshairCode(code, 'Fractional sniper'),
        crosshair.importCrosshairCode(CODE, 'Fractional sniper'),
      );
    },
  );
  await check(
    'fractional sniper adjustments preserve hundredths in the editor and saved profile',
    async () => {
      await click('Increase Sniper dot size');
      await page.getByText('1.02', { exact: true }).waitFor();
      await click('Decrease Sniper dot size');
      await page.getByText('1.01', { exact: true }).waitFor();
      await click('Use this crosshair');
      await click('Confirm apply demo aim');
      await button('Edit crosshair Fractional sniper').waitFor();
      await click('Edit crosshair Fractional sniper');
      await tab('Sniper');
      await page.getByText('1.01', { exact: true }).waitFor();
      await click('Back from aim editor');
      await click('Back from aim settings');
    },
  );
  for (const category of [
    'Skins',
    'Buddies',
    'Sprays',
    'Player cards',
    'Titles',
    'Colours',
    'Agents',
  ]) {
    await check(category + ' keeps All items and search after opening details', async () => {
      await click(category);
      await tab('All items');
      await firstItem().waitFor();
      const label = await firstItem().getAttribute('aria-label'),
        name = label.slice(5);
      await page.getByLabel('Search collection', { exact: true }).fill(name);
      await button(label).first().click();
      await click('Close item details');
      await selected('All items');
      assert.equal(await page.getByLabel('Search collection', { exact: true }).inputValue(), name);
    });
    await check(category + ' keeps Wishlist after opening details', async () => {
      const list = page.getByTestId('collection-browser-list'),
        add = list.getByRole('button', { name: /^Add .* to wishlist$/ }).first();
      if (await add.count()) await add.click();
      await tab('Wishlist');
      await firstItem().waitFor();
      await firstItem().click();
      await click('Close item details');
      await selected('Wishlist');
      await firstItem().waitFor();
      await click('Back from collection browser');
    });
  }
  await check('weapon filter and search survive a skin details roundtrip', async () => {
    await click('Skins');
    await tab('All items');
    await tab('Vandal');
    await page.getByLabel('Search collection', { exact: true }).fill('Prime');
    await firstItem().click();
    await click('Close item details');
    await selected('Vandal');
    await selected('All items');
    assert.equal(await page.getByLabel('Search collection', { exact: true }).inputValue(), 'Prime');
    await click('Back from collection browser');
  });
  await check(
    'Collection restores a real scroll offset instead of jumping to the first row',
    async () => {
      await page.setViewportSize({ width: 390, height: 480 });
      await click('All items');
      await firstItem().waitFor();
      const list = page.getByTestId('collection-browser-list');
      await list.evaluate((el) => {
        el.scrollTop = 750;
      });
      await page.waitForTimeout(350);
      const label = await list.evaluate((el) => {
        const box = el.getBoundingClientRect();
        return [...el.querySelectorAll('[role="button"][aria-label^="View "]')]
          .find((n) => {
            const b = n.getBoundingClientRect();
            return b.top > box.top + 5 && b.bottom < box.bottom - 5;
          })
          ?.getAttribute('aria-label');
      });
      assert.ok(label);
      const before = await list.evaluate((el) => el.scrollTop);
      assert.ok(before > 400);
      await button(label).click();
      await click('Close item details');
      await page.waitForTimeout(350);
      const after = await page
        .getByTestId('collection-browser-list')
        .evaluate((el) => el.scrollTop);
      assert.ok(Math.abs(before - after) < 5, `Collection offset changed ${before} -> ${after}`);
      await shot('collection-scroll-retained');
      await click('Back from collection browser');
      await page.setViewportSize({ width: 390, height: 844 });
    },
  );
  await check(
    'only active bundle details offer a preview of the exact per-item and total VP',
    async () => {
      await tab('Store');
      await tab('Bundles');
      await button('Open After-hours collection bundle').first().click();
      await click('Review bundle purchase');
      await page.getByText('2,800 VP', { exact: true }).waitFor();
      assert.equal(await page.getByTestId('bundle-quote-items').getByText(/VP$/).count(), 4);
      assert.equal(await button('Demo preview - no VP is spent').isDisabled(), true);
      await page.getByRole('switch', { name: 'I confirm this VP purchase', exact: true }).click();
      assert.equal(await button('Demo preview - no VP is spent').isDisabled(), true);
      await shot('bundle-purchase-review');
      await click('Cancel purchase');
      await button('Review bundle purchase').waitFor();
      await click('Back from bundle');
      assert.equal(requests.length, 0);
    },
  );
  for (const theme of ['Dark', 'Light'])
    await check('Saved Stores prices and thumbnails fit 320px in ' + theme, async () => {
      await tab('Settings');
      await tab(theme);
      await tab('Store');
      await tab('History');
      await click('Saved Night Markets & bundles');
      await page.getByTestId('saved-store-offer').first().waitFor();
      await page.setViewportSize({ width: 320, height: 740 });
      await page.waitForTimeout(250);
      const boxes = await page.getByTestId('saved-store-offer').evaluateAll((rows) =>
        rows.map((row) => {
          const r = row.getBoundingClientRect(),
            price = row
              .querySelector('[data-testid="saved-store-offer-price"]')
              .getBoundingClientRect();
          return {
            left: r.left,
            right: r.right,
            priceLeft: price.left,
            priceRight: price.right,
            height: r.height,
          };
        }),
      );
      assert.ok(boxes.length);
      for (const b of boxes) {
        assert.ok(b.priceLeft >= b.left - 1 && b.priceRight <= b.right + 1, JSON.stringify(b));
        assert.ok(b.height < 180, JSON.stringify(b));
        assert.ok(b.right <= 320);
      }
      await shot('saved-stores-' + theme.toLowerCase());
      await page.setViewportSize({ width: 390, height: 844 });
      await click('Back from saved stores');
    });
  await check(
    'Saved Stores keeps its category and scroll after viewing an archived item',
    async () => {
      await tab('Store');
      await tab('History');
      await click('Saved Night Markets & bundles');
      await tab('Daily');
      await page.getByTestId('saved-store-offer').first().waitFor();
      await page.setViewportSize({ width: 390, height: 370 });
      await page.waitForTimeout(250);
      const list = page.getByTestId('saved-stores-list');
      await list.evaluate((el) => {
        el.scrollTop = 150;
      });
      await page.waitForTimeout(250);
      const label = await list.evaluate((el) => {
        const b = el.getBoundingClientRect();
        return [...el.querySelectorAll('[role="button"][aria-label^="View archived "]')]
          .find((n) => {
            const x = n.getBoundingClientRect();
            return x.top >= b.top && x.bottom <= b.bottom;
          })
          ?.getAttribute('aria-label');
      });
      assert.ok(label);
      const before = await list.evaluate((el) => el.scrollTop);
      assert.ok(before > 0);
      await button(label).click();
      await click('Close item details');
      await selected('Daily');
      await page.waitForTimeout(350);
      const after = await page.getByTestId('saved-stores-list').evaluate((el) => el.scrollTop);
      assert.ok(Math.abs(before - after) < 5, `Archive offset changed ${before} -> ${after}`);
      await shot('saved-store-scroll-retained');
      await page.setViewportSize({ width: 390, height: 844 });
      await click('Back from saved stores');
    },
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
  passed = true;
} catch (error) {
  await shot('store-collection-ui-failure').catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  const result = { checks, errors, privateRiotRequests: requests.length, passed };
  await fs.writeFile(
    path.join(out, 'store-collection-browser.json'),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
  await new Promise((r) => server.close(r));
}
