import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  dist = path.join(root, 'dist-web'),
  out = path.join(root, 'docs/validation-0.9.4');
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
  await click('Open chats');
  await check(
    'Online and All friends keep their filter and search after returning from a conversation',
    async () => {
      for (const filter of ['Online', 'All friends']) {
        await tab(filter);
        await page.getByLabel('Search chats', { exact: true }).fill('Lumen');
        await click('Open conversation with Lumen');
        await click('Conversation settings');
        await click('Back from chat settings');
        await click('Back from conversation');
        assert.equal(
          await page.getByRole('tab', { name: filter, exact: true }).getAttribute('aria-selected'),
          'true',
        );
        assert.equal(await page.getByLabel('Search chats', { exact: true }).inputValue(), 'Lumen');
        await page.getByLabel('Search chats', { exact: true }).fill('');
      }
      await shot('chat-filter-retained');
    },
  );
  await check(
    'opening a participant profile does not reset the parent Online directory',
    async () => {
      await tab('Online');
      await click('Open conversation with Kestrel');
      await click('View chat participant profile');
      await click('Back from player profile');
      await click('Back from conversation');
      assert.equal(
        await page.getByRole('tab', { name: 'Online', exact: true }).getAttribute('aria-selected'),
        'true',
      );
    },
  );
  await check('returning to All friends restores the list position on a small screen', async () => {
    await page.setViewportSize({ width: 390, height: 480 });
    await tab('All friends');
    const list = page.getByTestId('chats-directory-list');
    await list.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.waitForTimeout(300);
    const offset = await list.evaluate((el) => el.scrollTop);
    assert.ok(offset > 0, 'Fixture must scroll');
    await page
      .getByRole('button', { name: /^Open conversation with / })
      .last()
      .click();
    await click('Back from conversation');
    await page.waitForTimeout(250);
    const after = await page.getByTestId('chats-directory-list').evaluate((el) => el.scrollTop);
    assert.ok(Math.abs(after - offset) < 4, `Offset changed from ${offset} to ${after}`);
    await shot('chat-scroll-retained');
    await page.setViewportSize({ width: 390, height: 844 });
    await click('Back from friends');
  });
  await check(
    'manual all-friend sync shows progress, stays interactive, and can be stopped',
    async () => {
      await tab('Settings');
      assert.equal(
        await page.getByText('Checks up to 10 recent conversations.', { exact: true }).count(),
        0,
      );
      await click('Sync all chat history');
      await button('Stop history sync').waitFor();
      await page.getByTestId('all-friends-sync-progress').waitFor();
      await shot('all-friend-sync-running');
      await click('Stop history sync');
      await page.getByText('Sync stopped', { exact: true }).waitFor();
      await button('Resume history sync').waitFor();
      await shot('all-friend-sync-stopped');
    },
  );
  await check(
    'scan progress survives navigation and resumes through every remaining friend',
    async () => {
      await tab('Collection');
      await page.getByText('Loadout', { exact: true }).first().waitFor();
      await tab('Settings');
      await button('Resume history sync').waitFor();
      await click('Resume history sync');
      await tab('Friends');
      await click('Open chats');
      await tab('Online');
      await click('Open conversation with Lumen');
      await click('Back from conversation');
      assert.equal(
        await page.getByRole('tab', { name: 'Online', exact: true }).getAttribute('aria-selected'),
        'true',
      );
      await click('Back from friends');
      await tab('Settings');
      await page.getByText('Sync finished', { exact: true }).waitFor({ timeout: 25000 });
      await page.getByText('5 / 5', { exact: true }).waitFor();
      await page.getByText('5 friends had no retained messages.', { exact: true }).waitFor();
      await shot('all-friend-sync-complete');
    },
  );
  assert.deepEqual(errors, []);
  assert.equal(requests.length, 0);
  passed = true;
} catch (error) {
  await shot('chat-sync-ui-failure').catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  const result = { checks, errors, privateRiotRequests: requests.length, passed };
  await fs.writeFile(path.join(out, 'chat-sync-browser.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
  await new Promise((r) => server.close(r));
}
