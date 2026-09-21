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
let passed = false,
  backup;
page.on('pageerror', (e) => errors.push(e.message));
page.on('request', (r) => {
  if (/auth\.riotgames|pd\..*pvp\.net|glz-/.test(r.url())) requests.push(r.url());
});
const button = (name) => page.getByRole('button', { name, exact: true }),
  click = async (name) => button(name).click(),
  tab = async (name) => page.getByRole('tab', { name, exact: true }).click();
const shot = async (name) => {
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(out, name + '.png'), fullPage: true });
};
const check = async (name, work) => {
  await work();
  checks.push(name);
  console.log('PASS', name);
};
const upload = async (data) => {
  const event = page.waitForEvent('filechooser');
  await click('Choose backup file');
  const chooser = await event;
  await chooser.setFiles({
    name: 'fixture-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(typeof data === 'string' ? data : JSON.stringify(data)),
  });
};
const signed = (data) => ({
  ...backup,
  data,
  sha256: createHash('sha256').update(JSON.stringify(data)).digest('hex'),
});
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'networkidle' });
  await click('Try the demo');
  await tab('Collection');
  await click('Saved loadouts');
  await click('Create loadout');
  await page.getByLabel('Loadout name', { exact: true }).fill('Backup cosmetic set');
  await click('Save loadout');
  await button('Edit Backup cosmetic set').waitFor();
  await click('Back from loadouts');
  await click('Aim presets');
  await click('Create aim preset');
  await page.getByLabel('Aim preset name', { exact: true }).fill('Backup aim set');
  await click('Save aim preset');
  await button('Apply aim preset Backup aim set').waitFor();
  await click('Back from aim settings');
  await tab('Settings');
  await click('Backup & restore');
  await check(
    'backup export downloads an actual checksummed file containing presets and saved history',
    async () => {
      await page.getByText('Backups are not encrypted.', { exact: false }).waitFor();
      await shot('backup-home');
      const event = page.waitForEvent('download');
      await click('Export account backup');
      const download = await event;
      const file = path.join(out, 'backup-demo.json');
      await download.saveAs(file);
      assert.equal(await download.failure(), null);
      backup = JSON.parse(await fs.readFile(file, 'utf8'));
      assert.equal(backup.format, 'outpost-account-backup');
      assert.equal(
        backup.sha256,
        createHash('sha256').update(JSON.stringify(backup.data)).digest('hex'),
      );
      assert.equal(backup.data.presets[0].name, 'Backup cosmetic set');
      assert.equal(backup.data.aimPresets[0].name, 'Backup aim set');
      assert.ok(backup.data.reports.length);
      assert.ok(backup.data.markets.some((m) => m.kind === 'night-market'));
      assert.ok(!JSON.stringify(backup).includes('accessToken'));
    },
  );
  await check(
    'backup import previews data before confirmation and permits cancellation',
    async () => {
      await upload(backup);
      await button('Confirm restore backup').waitFor();
      await shot('backup-restore-preview');
      assert.equal(
        await page
          .getByRole('switch', { name: 'Restore app preferences', exact: true })
          .isChecked(),
        false,
      );
      await click('Cancel restore');
      await button('Choose backup file').waitFor();
    },
  );
  await check('another account backup cannot be restored to the selected account', async () => {
    const data = structuredClone(backup.data),
      old = data.account.puuid,
      id = '11111111-1111-4111-8111-111111111111';
    const different = JSON.parse(JSON.stringify(data).replaceAll(old, id));
    await upload(signed(different));
    await button('Confirm restore backup').waitFor();
    assert.equal(await button('Confirm restore backup').isDisabled(), true);
    await click('Cancel restore');
  });
  await check('corrupt checksum and unsafe backup media fail before any restore', async () => {
    const bad = structuredClone(backup);
    bad.data.presets[0].name = 'corrupt';
    await upload(bad);
    await page.getByText(/backup checksum did not match/i).waitFor();
    assert.equal(await button('Confirm restore backup').count(), 0);
    const unsafe = structuredClone(backup.data);
    unsafe.reports[0].detail.mapImage = 'file:///private/not-read';
    await upload(signed(unsafe));
    await page.getByText(/untrusted media address/i).waitFor();
    assert.equal(await button('Confirm restore backup').count(), 0);
  });
  await check(
    'confirmed backup restore merges local presets without applying to Riot',
    async () => {
      const data = structuredClone(backup.data);
      data.presets[0].id = '22222222-2222-4222-8222-222222222222';
      data.presets[0].name = 'Restored cosmetic set';
      data.aimPresets[0].id = '33333333-3333-4333-8333-333333333333';
      data.aimPresets[0].name = 'Restored aim set';
      await upload(signed(data));
      await click('Confirm restore backup');
      await page.getByText(/Backup restored/).waitFor();
      await click('Close backup and restore');
      await tab('Collection');
      await click('Saved loadouts');
      await button('Edit Restored cosmetic set').waitFor();
      await button('Edit Backup cosmetic set').waitFor();
      await click('Back from loadouts');
      await click('Aim presets');
      await button('Apply aim preset Restored aim set').waitFor();
      await click('Back from aim settings');
      assert.equal(requests.length, 0);
    },
  );
  await check(
    'saved Night Market and bundle history is visible without refreshing the store',
    async () => {
      await tab('Store');
      await tab('History');
      await click('Saved Night Markets & bundles');
      await page.getByRole('dialog').last().getByText('Night Market', { exact: true }).waitFor();
      await shot('saved-night-market');
      await tab('Bundles');
      await page
        .getByRole('button', { name: /View archived / })
        .first()
        .waitFor();
      await click('Back from saved stores');
    },
  );
  await check('Profile keeps history caching without extra local-storage wording', async () => {
    await tab('Profile');
    assert.equal(await button('Refresh live game').count(), 0);
    assert.equal(await page.getByText('Saved locally', { exact: true }).count(), 0);
    await page.getByText('Match history', { exact: true }).waitFor();
    await shot('profile-saved-history');
  });
  await check('new video previews start audible and mute preference survives restart', async () => {
    await tab('Store');
    await tab('Today');
    await click('View Reaver Vandal');
    await page.locator('video').scrollIntoViewIfNeeded();
    await page.waitForFunction(
      () => {
        const v = document.querySelector('video');
        return v && v.readyState >= 2;
      },
      null,
      { timeout: 45000 },
    );
    if (await button('Play with sound').count()) await click('Play with sound');
    await page.waitForFunction(
      () => {
        const v = document.querySelector('video');
        return v && !v.paused && !v.muted;
      },
      null,
      { timeout: 20000 },
    );
    await click('Mute');
    await page.waitForFunction(() => localStorage.getItem('outpost.videoSound') === 'false');
    await click('Close item details');
    await page.reload();
    await click('Try the demo');
    await click('View Reaver Vandal');
    await page.waitForFunction(
      () => {
        const v = document.querySelector('video');
        return v && v.readyState >= 2 && v.muted;
      },
      null,
      { timeout: 45000 },
    );
    await click('Unmute');
    await page.waitForFunction(() => localStorage.getItem('outpost.videoSound') === 'true');
    await click('Close item details');
  });
  assert.deepEqual(errors, []);
  assert.equal(requests.length, 0);
  passed = true;
} catch (error) {
  await shot('backup-ui-failure').catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  const result = { checks, errors, privateRiotRequests: requests.length, passed };
  await fs.writeFile(path.join(out, 'backup-browser.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
  await new Promise((r) => server.close(r));
}
