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
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(out, name + '.png'), fullPage: true });
};
const check = async (name, work) => {
  await work();
  checks.push(name);
  console.log('PASS', name);
};
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'networkidle' });
  await click('Try the demo');
  await tab('Friends');
  await button('Friend requests (2)').waitFor();
  await check('Friends exposes separate incoming and sent requests', async () => {
    await click('Friend requests (2)');
    await page.getByRole('tab', { name: 'Incoming (2)', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: /^Accept request from / }).count(), 2);
    await shot('friend-requests-incoming');
    await tab('Sent (1)');
    await page.getByText('Waiting for acceptance', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: /^Accept request from / }).count(), 0);
    await tab('Incoming (2)');
  });
  await check(
    'accepting an incoming request requires confirmation and adds the friend',
    async () => {
      await click('Accept request from Orbit');
      await button('Confirm accept request').waitFor();
      await click('Confirm accept request');
      await page.getByRole('tab', { name: 'Incoming (1)', exact: true }).waitFor();
      await shot('friend-request-accepted');
    },
  );
  await check(
    'decline can be cancelled and only removes the selected pending request',
    async () => {
      await click('Decline request from Mako');
      await click('Cancel friend action');
      await button('Accept request from Mako').waitFor();
      await click('Decline request from Mako');
      await click('Confirm decline request');
      await page.getByText('No incoming requests', { exact: true }).waitFor();
      await click('Back from friend requests');
      await button('View Orbit profile').waitFor();
      await button('Friend requests (0)').waitFor();
    },
  );
  await check(
    'a match participant profile can send a friend request without leaving the app',
    async () => {
      await tab('Profile');
      await click('View live game details');
      await click('View Ferro profile');
      await button('Add friend').waitFor();
      await click('Add friend');
      await button('Confirm send request').waitFor();
      await shot('add-friend-confirmation');
      await click('Confirm send request');
      await page.getByText('Request sent', { exact: true }).waitFor();
      await click('Back from player profile');
      await click('Back from live match');
    },
  );
  await check(
    'Recent chats show the newest conversation first with its message preview',
    async () => {
      await tab('Friends');
      await click('Open chats');
      await tab('All friends');
      await click('Open conversation with Lumen');
      await page.getByLabel('Message text', { exact: true }).fill('First conversation fixture');
      await click('Send');
      await page.getByText('First conversation fixture', { exact: true }).waitFor();
      await click('Back from conversation');
      await tab('All friends');
      await click('Open conversation with Kestrel');
      await page.getByLabel('Message text', { exact: true }).fill('Newest conversation fixture');
      await click('Send');
      await page.getByText('Newest conversation fixture', { exact: true }).waitFor();
      await click('Back from conversation');
      await tab('Recent');
      await page.getByText('You: Newest conversation fixture', { exact: true }).waitFor();
      const labels = await page
        .locator('[data-testid^="conversation-row-"]')
        .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('aria-label')));
      assert.deepEqual(labels.slice(0, 2), [
        'Open conversation with Kestrel',
        'Open conversation with Lumen',
      ]);
      await shot('recent-conversations');
    },
  );
  await check(
    'conversation header opens the player profile and deletion lives in settings',
    async () => {
      await click('Open conversation with Kestrel');
      assert.equal(await button('Delete saved conversation').count(), 0);
      await click('View chat participant profile');
      await page.getByText('FRIENDS', { exact: true }).waitFor();
      await click('Back from player profile');
      await click('Conversation settings');
      await button('Delete saved conversation').waitFor();
      await click('Back from chat settings');
      await shot('compact-conversation');
      await click('Back from conversation');
    },
  );
  await check(
    'recent chats stay newest-first after automatic connection and app restart',
    async () => {
      assert.equal(await button('Disconnect chat').count(), 0);
      await page.getByText('You: Newest conversation fixture', { exact: true }).waitFor();
      await click('Open conversation with Kestrel');
      assert.equal(await button('Reconnect chat').count(), 0);
      await click('Back from conversation');
      await click('Back from friends');
      await page.reload();
      await click('Try the demo');
      await tab('Friends');
      await click('Open chats');
      await page.getByText('You: Newest conversation fixture', { exact: true }).waitFor();
      const rows = page.locator('[data-testid^="conversation-row-"]');
      assert.equal(await rows.first().getAttribute('aria-label'), 'Open conversation with Kestrel');
    },
  );
  await check('recent chat rows fit narrow phones without clipping', async () => {
    for (const width of [320, 430]) {
      await page.setViewportSize({ width, height: 844 });
      await page.waitForTimeout(200);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await shot('recent-chats-' + width);
    }
  });
  assert.deepEqual(errors, []);
  assert.equal(requests.length, 0);
  passed = true;
} catch (error) {
  await shot('social-ui-failure').catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  const result = { checks, errors, privateRiotRequests: requests.length, passed };
  await fs.writeFile(path.join(out, 'social-browser.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
  await new Promise((r) => server.close(r));
}
