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
try {
  await page.goto(base, { waitUntil: 'networkidle' });
  await click('Try the demo');
  await tab('Collection');
  await check(
    'Collection has separate Crosshairs, Sensitivity and Aim preset entries',
    async () => {
      for (const name of ['Crosshairs', 'Sensitivity', 'Aim presets']) await button(name).waitFor();
      await click('Crosshairs');
      await button('Edit crosshair Precision').waitFor();
      await shot('aim-library');
    },
  );
  await check('crosshair import previews and exports the complete portable code', async () => {
    await click('Import code');
    await page.getByLabel('Imported crosshair name', { exact: true }).fill('Cyan focus');
    await page
      .getByLabel('Import crosshair code', { exact: true })
      .fill('0;s;1;P;c;5;h;0;f;0;0l;4;0o;2;0a;1;0f;0;1b;0');
    await click('Preview imported crosshair');
    assert.equal(await page.getByTestId('crosshair-segment').count(), 4);
    await shot('aim-editor');
    await click('Export crosshair code');
    const code = await page.getByTestId('crosshair-export-code').innerText();
    const p = crosshair.importCrosshairCode(code, 'Cyan focus');
    assert.equal(p.primary.color, '00FFFFFF');
    assert.equal(p.primary.innerLines.lineLength, 4);
    assert.equal(p.primary.bFadeCrosshairWithFiringError, false);
  });
  await check(
    'crosshair apply selects a new slot only after an explicit confirmation',
    async () => {
      await click('Use this crosshair');
      await button('Confirm apply demo aim').waitFor();
      await shot('aim-apply-confirmation');
      await click('Confirm apply demo aim');
      await button('Edit crosshair Cyan focus').waitFor();
    },
  );
  await check('a named aim preset saves crosshair and all three sensitivities', async () => {
    await click('Edit crosshair Cyan focus');
    await click('Save with sensitivity as preset');
    await page.getByLabel('Aim preset name', { exact: true }).fill('Focus 0.31');
    await page.getByLabel('Mouse sensitivity', { exact: true }).fill('0.31');
    await page.getByLabel('ADS multiplier', { exact: true }).fill('1.05');
    await page.getByLabel('Scoped multiplier', { exact: true }).fill('0.95');
    await click('Save aim preset');
    await button('Apply aim preset Focus 0.31').waitFor();
    await shot('aim-presets');
  });
  await check(
    'applying an aim preset updates the crosshair and sensitivity as one reviewed operation',
    async () => {
      await click('Apply aim preset Focus 0.31');
      await click('Confirm apply demo aim');
      await page.getByText('Demo aim settings applied.', { exact: true }).waitFor();
      await tab('Sensitivity');
      assert.equal(
        await page.getByLabel('Mouse sensitivity', { exact: true }).inputValue(),
        '0.31',
      );
      assert.equal(await page.getByLabel('ADS multiplier', { exact: true }).inputValue(), '1.05');
      assert.equal(
        await page.getByLabel('Scoped multiplier', { exact: true }).inputValue(),
        '0.95',
      );
      await shot('aim-sensitivity');
    },
  );
  await check(
    'sensitivity-only apply preserves crosshair profiles and their selection',
    async () => {
      const before = await page.evaluate(
        () => JSON.parse(localStorage.getItem('outpost.demo.aim.v1')).state.snapshot,
      );
      await page.getByLabel('Mouse sensitivity', { exact: true }).fill('0.4');
      await click('Apply sensitivity');
      await click('Confirm apply demo aim');
      await page.getByText('Demo aim settings applied.', { exact: true }).waitFor();
      const after = await page.evaluate(
        () => JSON.parse(localStorage.getItem('outpost.demo.aim.v1')).state.snapshot,
      );
      assert.equal(after.sensitivity.hipfire, 0.4);
      assert.deepEqual(after.crosshairs, before.crosshairs);
      assert.equal(after.current, before.current);
    },
  );
  await check(
    'aim presets survive restart and remain editable without creating duplicates',
    async () => {
      await page.reload({ waitUntil: 'networkidle' });
      await click('Try the demo');
      await tab('Collection');
      await click('Aim presets');
      await click('Edit aim preset Focus 0.31');
      await page.getByLabel('Mouse sensitivity', { exact: true }).fill('0.33');
      await click('Save aim preset');
      assert.equal(await button('Edit aim preset Focus 0.31').count(), 1);
    },
  );
  await check('invalid code shows an inline error and never initiates a Riot request', async () => {
    await tab('Crosshairs');
    await click('Import code');
    await page.getByLabel('Import crosshair code', { exact: true }).fill('0;P;unknown;1');
    await click('Preview imported crosshair');
    await page.getByText('Unsupported crosshair code field.', { exact: true }).waitFor();
    assert.equal(requests.length, 0);
    await click('Back from aim settings');
  });
  await check('primary ADS and sniper previews fit narrow and wide phones', async () => {
    await click('New crosshair');
    for (const width of [320, 430]) {
      await page.setViewportSize({ width, height: 860 });
      for (const mode of ['Primary', 'ADS', 'Sniper']) {
        await tab(mode);
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
          true,
        );
        await page.getByTestId('crosshair-preview').scrollIntoViewIfNeeded();
      }
      await shot(`aim-preview-${width}`);
    }
    await click('Back from aim editor');
    await page.setViewportSize({ width: 390, height: 844 });
  });
  await check(
    'deleting a local preset requires confirmation and does not alter Riot profile settings',
    async () => {
      await tab('Aim presets');
      await click('Delete aim preset Focus 0.31');
      await click('Keep aim preset');
      await button('Apply aim preset Focus 0.31').waitFor();
      await click('Delete aim preset Focus 0.31');
      await click('Delete aim preset');
      await page.getByText('Keep your aim setups together', { exact: true }).waitFor();
    },
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
  passed = true;
  console.log(
    JSON.stringify({ checks, errors, privateRiotRequests: requests.length, passed }, null, 2),
  );
} catch (error) {
  await page.screenshot({ path: `${out}/aim-ui-failure.png`, fullPage: true }).catch(() => {});
  console.error('AIM_UI_FAILURE', error);
  throw error;
} finally {
  await fs.writeFile(
    `${out}/aim-browser.json`,
    JSON.stringify(
      {
        checks,
        errors,
        privateRiotRequests: requests.length,
        passed,
        realAccountTests: false,
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
