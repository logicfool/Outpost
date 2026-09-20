import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  out = path.join(root, 'docs/validation-0.9.4.1'),
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
  if (r.method() !== 'GET' && !r.url().startsWith('data:'))
    requests.push({ url: r.url(), method: r.method() });
});
const button = (name) => page.getByRole('button', { name, exact: true });
const click = async (name) => {
  await button(name).click();
};
const tab = async (name) => {
  await page.getByRole('tab', { name, exact: true }).click();
};
const shot = async (name) => {
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
};
const check = async (name, work) => {
  await work();
  checks.push(name);
  console.log('PASS', name);
};
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'networkidle' });
  await click('Try the demo');
  await tab('Settings');
  await click('Connection diagnostics');
  await check(
    'detailed capture is opt-in and explains personal-data content before starting',
    async () => {
      await page.getByText(/Detailed capture is off/).waitFor();
      await click('Start detailed capture');
      await page.getByText(/Tokens, cookies and passwords are redacted/).waitFor();
      await click('Cancel detailed capture');
      await page.getByText(/Detailed capture is off/).waitFor();
    },
  );
  await check(
    'capture survives navigating away to reproduce a failure and returning to settings',
    async () => {
      await click('Start detailed capture');
      await click('Start capture for 20 minutes');
      await page.getByText(/Detailed capture is on/).waitFor();
      await tab('Collection');
      await tab('Settings');
      await click('Connection diagnostics');
      await page.getByText(/Detailed capture is on/).waitFor();
      await shot('diagnostic-capture');
    },
  );
  await check(
    'JSON export is a real downloaded file with context and explicit coverage',
    async () => {
      const event = page.waitForEvent('download');
      await click('Export diagnostics (JSON)');
      const download = await event;
      const file = path.join(out, 'diagnostic-export-demo.json');
      await download.saveAs(file);
      assert.equal(await download.failure(), null);
      const report = JSON.parse(await fs.readFile(file, 'utf8'));
      assert.equal(report.schemaVersion, 1);
      assert.ok(report.coverage.headers.includes('not exposed'));
      assert.equal(report.capture.active, true);
      assert.equal(report.context.selectedAccount.gameName, 'Nightshift');
      assert.ok(report.context.cache.sections.store);
      assert.ok(report.context.application);
      assert.match(download.suggestedFilename(), /^Outpost-diagnostics-.*\.json$/);
      assert.equal(requests.length, 0);
    },
  );
  await check(
    'stopping and clearing diagnostic capture work without reconnecting the account',
    async () => {
      await click('Stop detailed capture');
      await page.getByText(/Detailed capture is off/).waitFor();
      await click('Clear diagnostics');
      await page.getByText(/Local diagnostic records cleared/).waitFor();
      await page.getByText(/0 records/).waitFor();
      await shot('diagnostic-controls');
      await tab('Store');
      await page.getByText('VP', { exact: true }).waitFor();
    },
  );
  assert.deepEqual(errors, []);
  passed = true;
} catch (error) {
  await shot('diagnostic-failure').catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  const result = { checks, errors, nonGetRequests: requests, passed };
  await fs.writeFile(path.join(out, 'diagnostic-browser.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
