import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'docs', 'validation-0.5.0');
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
const browser = await chromium.launch({
  headless: true,
  args:
    process.env.OUTPOST_LOW_MEMORY === '1'
      ? ['--single-process', '--no-zygote', '--disable-gpu', '--js-flags=--max-old-space-size=192']
      : [],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();
const errors = [],
  failures = [],
  checks = [];
let crashed = false;
page.on('crash', () => {
  crashed = true;
});
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
    await page.getByRole('button', { name: 'View You profile', exact: true }).waitFor();
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
    assert.equal(
      await page.getByRole('button', { name: 'View You profile', exact: true }).count(),
      1,
    );
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
    await click('Open chats');
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
    await click('View chat participant profile');
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
  await check('Battle Pass has pass progress rather than an unrelated rank panel', async () => {
    await tab('Battle Pass');
    await page.getByText('CURRENT BATTLE PASS', { exact: true }).waitFor();
    await page.getByText('Radianite Points', { exact: true }).first().waitFor();
    assert.equal(await page.getByText('Unresolved item', { exact: false }).count(), 0);
    assert.equal(await page.getByText('CURRENT RANK', { exact: true }).count(), 0);
    assert.equal(await page.getByText('Rank unavailable', { exact: true }).count(), 0);
    await shot('battle-pass');
  });
  await check('accessory tiles load images with measurable width', async () => {
    await tab('Store');
    await tab('Accessories');
    await page.waitForFunction(
      () => {
        const offers = [...document.querySelectorAll('button[aria-label^="View "]')];
        return (
          offers.length === 4 &&
          offers.every((offer) =>
            [...offer.querySelectorAll('img')].some(
              (img) =>
                img.complete && img.naturalWidth > 0 && img.getBoundingClientRect().width > 60,
            ),
          )
        );
      },
      null,
      { timeout: 25000 },
    );
    await shot('accessories');
  });
  await check('connection diagnostics are accessible from settings', async () => {
    await tab('Settings');
    await click('Connection diagnostics');
    await page
      .getByText('Local request metadata only. No tokens, IDs, names or message contents.', {
        exact: true,
      })
      .waitFor();
    await click('Hide connection diagnostics');
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
  await check('all themes apply immediately and light theme persists across restart', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const mode of ['Dark', 'Light', 'Navy']) {
      await tab('Settings');
      await tab(mode);
      await page.waitForTimeout(100);
      const expected = {
        Dark: 'rgb(7, 7, 7)',
        Light: 'rgb(245, 246, 248)',
        Navy: 'rgb(11, 16, 24)',
      }[mode];
      assert.ok(
        await page
          .locator('div')
          .evaluateAll(
            (nodes, color) =>
              nodes.some(
                (n) =>
                  getComputedStyle(n).backgroundColor === color &&
                  n.getBoundingClientRect().height > 500,
              ),
            expected,
          ),
      );
      await tab('Profile');
      await shot(`profile-theme-${mode.toLowerCase()}`);
      if (mode === 'Light') {
        await click('View live game details');
        await shot('live-light');
        await click('Back from live match');
        await click('Change player card and title');
        await shot('identity-light');
        await click('Back from identity editor');
      }
    }
    await tab('Settings');
    await tab('Light');
    await page.getByRole('switch', { name: 'Automatic chat history', exact: true }).uncheck();
    await page.reload({ waitUntil: 'networkidle' });
    await click('Try the demo');
    await tab('Settings');
    assert.equal(
      await page.getByRole('tab', { name: 'Light', exact: true }).getAttribute('aria-selected'),
      'true',
    );
    await page.emulateMedia({ colorScheme: 'dark' });
    await tab('System');
    await page.waitForTimeout(150);
    await shot('settings-system-dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForTimeout(150);
    await shot('settings-system-light');
    await tab('Light');
  });
  await check('saved messages survive app restart without connecting to Riot', async () => {
    await click('Open chats');
    await tab('Saved · 1');
    await page
      .getByRole('button', { name: /^Message/ })
      .first()
      .click();
    await page.getByText('Hello from the Outpost demo 🦊', { exact: true }).waitFor();
    await shot('saved-chat-offline-light');
    assert.equal(await page.getByRole('button', { name: 'Send', exact: true }).isDisabled(), true);
    await click('Reconnect chat');
    await page
      .getByRole('button', { name: 'View chat participant profile', exact: true })
      .waitFor();
    await click('Conversation settings');
    await click('Sync this conversation now');
    await page.getByText('History sync completed.', { exact: false }).waitFor();
    await click('Back from chat settings');
    await click('Delete saved conversation');
    await click('Keep messages');
    await page.getByText('Hello from the Outpost demo 🦊', { exact: true }).waitFor();
    await click('Delete saved conversation');
    await click('Delete local messages');
    await page.getByText('No messages saved yet', { exact: true }).waitFor();
    await click('Back from conversation');
    await click('Back from friends');
  });
  await check(
    'dedicated Friends tab uses compact square portraits and separates chat navigation',
    async () => {
      await tab('Friends');
      await page.getByText('VALORANT - 2', { exact: true }).waitFor();
      const row = page.getByRole('button', { name: 'View Lumen profile', exact: true });
      await row.waitFor();
      const portrait = row.getByRole('img', { name: 'Player card portrait' });
      await portrait.waitFor();
      const bounds = await portrait.boundingBox();
      assert.ok(bounds && Math.abs(bounds.width - bounds.height) < 1 && bounds.width <= 56);
      await page.getByText('In game · Lotus', { exact: true }).waitFor();
      await shot('friends-tab');
      await page
        .getByRole('textbox', { name: 'Search friends directory', exact: true })
        .fill('Lumen');
      assert.equal(await page.getByRole('button', { name: /^Chat with / }).count(), 1);
      await click('Chat with Lumen');
      assert.equal(
        await page.getByRole('button', { name: 'Sync Riot history', exact: true }).count(),
        0,
      );
      assert.equal(
        await page.getByRole('button', { name: 'View player profile', exact: true }).count(),
        0,
      );
      await click('View chat participant profile');
      await click('Back from player profile');
      await click('Conversation settings');
      await page.getByRole('switch', { name: 'Automatic chat history', exact: true }).check();
      await click('Back from chat settings');
      await shot('chat-clean-header');
      await click('Back from conversation');
    },
  );
  assert.equal(errors.length, 0, JSON.stringify(errors));
} catch (e) {
  process.exitCode = 1;
  if (!crashed) await shot('failure').catch(() => {});
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
        passed: !process.exitCode && !crashed && errors.length === 0,
        crashed,
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
