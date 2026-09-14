import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'docs', 'validation');
const staticRoot = path.join(root, 'dist-web');
const types = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.png': 'image/png',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};
const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const filename = path.resolve(staticRoot, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!filename.startsWith(staticRoot + path.sep)) {
      response.writeHead(403);
      response.end();
      return;
    }
    const contents = await fs.readFile(filename);
    response.writeHead(200, {
      'Content-Type': types[path.extname(filename)] ?? 'application/octet-stream',
    });
    response.end(contents);
  } catch {
    response.writeHead(404);
    response.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}/`;
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();
const errors = [],
  failures = [],
  checks = [];
page.on('pageerror', (e) => errors.push({ message: e.message, stack: e.stack }));
page.on('requestfailed', (r) => failures.push({ url: r.url(), reason: r.failure()?.errorText }));
const click = (name) => page.getByRole('button', { name, exact: true }).click();
const tab = (name) => page.getByRole('tab', { name, exact: true }).click();
const shot = async (name) => {
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
};
const check = async (name, work) => {
  await work();
  checks.push(name);
  console.log('PASS', name);
};
try {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await click('Try the demo');
  await check('store balances are VP/RP/KC without generic Currency', async () => {
    await page.getByText('VP', { exact: true }).waitFor();
    for (const label of ['RP', 'KC'])
      assert.equal(await page.getByText(label, { exact: true }).count(), 1);
    assert.equal(await page.getByText('Currency', { exact: true }).count(), 0);
    await shot('store');
  });
  await tab('Profile');
  await check('profile cover and current/peak ranks render', async () => {
    await page.getByText('Nightshift #DEMO', { exact: true }).waitFor();
    await page.getByText('DIAMOND 2', { exact: true }).waitFor();
    await shot('profile');
  });
  await check('live game opens ten-player roster and another player profile', async () => {
    await click('View live game details');
    await page.getByText('10 players returned.', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'View Lumen profile', exact: true }).waitFor();
    await shot('live-roster');
    await click('View Lumen profile');
    await page.getByRole('button', { name: 'View rank history', exact: true }).waitFor();
    await shot('other-player');
    await click('View rank history');
    await page.getByText('Career summary', { exact: true }).waitFor();
    await shot('career');
    await click('Close career summary');
    await click('Back from player profile');
    await click('Back from live match');
  });
  await check('match scoreboard links through to participant history and reports', async () => {
    await click('Open Ascent match');
    await page.getByRole('button', { name: 'View Lumen profile', exact: true }).waitFor();
    await shot('scoreboard');
    await click('View Lumen profile');
    await page.getByRole('button', { name: 'Open Ascent match', exact: true }).waitFor();
    await click('Open Ascent match');
    await page.getByText('Player’s team', { exact: true }).waitFor();
    await tab('Rounds');
    await shot('rounds');
    await tab('Duels');
    await shot('duels');
    await click('Close match report');
    await click('Back from player profile');
    await click('Close match report');
  });
  await check('owned player card can be selected, applied and reopened', async () => {
    await click('Change player card and title');
    const choices = page.getByRole('button', { name: /^Select / });
    await choices.nth(1).waitFor();
    await choices.nth(1).click();
    await click('Apply to demo');
    await page
      .getByText('Demo selection applied. No Riot account was changed.', { exact: true })
      .waitFor();
    await shot('identity');
    await click('Back from identity editor');
    await click('Change player card and title');
    assert.equal(
      await page.getByRole('button', { name: 'Apply to demo', exact: true }).isDisabled(),
      true,
    );
    await tab('Owned titles');
    const titles = page.getByRole('button', { name: /^Select / });
    await titles.nth(1).click();
    await click('Apply to demo');
    await click('Back from identity editor');
  });
  await check('friends support presence filters, conversations and profile links', async () => {
    await click('Open friends and chat');
    await click('Connect Riot chat');
    await page.getByRole('tab', { name: 'Online · 2', exact: true }).waitFor();
    await shot('friends-online');
    await tab('All friends · 5');
    await shot('friends-all');
    await page.getByRole('button', { name: 'Message', exact: true }).first().click();
    await page
      .getByRole('textbox', { name: 'Message text', exact: true })
      .fill('Hello from the Outpost demo 🦊');
    await click('Send');
    await page.getByText('Hello from the Outpost demo 🦊', { exact: true }).waitFor();
    await shot('chat');
    await click('View player profile');
    await click('Back from player profile');
    await click('Back from conversation');
    await click('Back from friends');
  });
  await check('collection exposes chromas, levels and media choices', async () => {
    await tab('Collection');
    await tab('All items');
    await tab('Chromas');
    assert.ok((await page.getByRole('button', { name: /^View / }).count()) > 0);
    await shot('chromas');
    await tab('Skins');
    await page.getByRole('button', { name: 'View Reaver Vandal', exact: true }).click();
    await page.getByText('Levels', { exact: true }).waitFor();
    await page.getByText('Variants', { exact: true }).waitFor();
    await page.waitForFunction(
      () => [...document.querySelectorAll('video')].some((video) => video.readyState >= 1),
      { timeout: 20000 },
    );
    await shot('skin-levels');
    await click('Close item details');
  });
  await check('mobile layout has no horizontal overflow at 320 and 430 pixels', async () => {
    for (const width of [320, 430]) {
      await page.setViewportSize({ width, height: 844 });
      await tab('Profile');
      const dimensions = await page.evaluate(() => ({
        document: document.documentElement.scrollWidth,
        viewport: innerWidth,
      }));
      assert.ok(dimensions.document <= dimensions.viewport, JSON.stringify(dimensions));
      await shot(`profile-${width}`);
    }
  });
} catch (e) {
  await shot('failure');
  console.error('SMOKE_FAILURE', e.stack);
  process.exitCode = 1;
} finally {
  await fs.writeFile(
    `${out}/web-smoke.json`,
    JSON.stringify(
      {
        checks,
        errors,
        failures,
        passed: !process.exitCode,
        validatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log('PAGE_ERRORS', JSON.stringify(errors));
  console.log('REQUEST_FAILURES', JSON.stringify(failures));
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
