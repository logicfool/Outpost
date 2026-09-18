import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'docs/validation-0.8.1'),
  staticRoot = path.join(root, 'dist-web');
const mime = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.png': 'image/png',
  '.ttf': 'font/ttf',
  '.json': 'application/json',
};
const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = path.resolve(staticRoot, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(staticRoot + path.sep)) {
      response.writeHead(403);
      response.end();
      return;
    }
    response.writeHead(200, {
      'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream',
    });
    response.end(await fs.readFile(file));
  } catch {
    response.writeHead(404);
    response.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/`;
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const checks = [],
  errors = [];
let passed = false;
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  let release,
    held = true,
    mediaRequests = 0;
  const gate = new Promise((resolve) => (release = resolve));
  await page.route('https://media.valorant-api.com/**', async (route) => {
    mediaRequests++;
    if (held) await gate;
    await route.continue().catch(() => {});
  });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Try the demo', exact: true }).click();
  await page
    .getByRole('progressbar', { name: /Loading .* artwork/ })
    .first()
    .waitFor();
  await page.screenshot({ path: `${out}/slow-store-artwork.png`, fullPage: true });
  await page.getByRole('tab', { name: 'Collection', exact: true }).click();
  const began = performance.now();
  await page.getByRole('button', { name: 'Change banner', exact: true }).click();
  await page.getByRole('button', { name: 'Back from identity editor', exact: true }).waitFor();
  const navigationMs = Math.round(performance.now() - began);
  assert.ok(navigationMs < 2000, `Demo cached navigation took ${navigationMs}ms`);
  await page.getByRole('dialog').screenshot({ path: `${out}/slow-identity-cached.png` });
  await page.getByRole('button', { name: 'Back from identity editor', exact: true }).click();
  await page.getByRole('tab', { name: 'Profile', exact: true }).click();
  const first = page.locator('[data-testid^="match-skeleton-"]').first();
  await first.scrollIntoViewIfNeeded();
  const waiting = page.locator('[data-testid^="match-artwork-skeleton-"]').first();
  await waiting.waitFor();
  const waitingId = await waiting.getAttribute('data-testid'),
    id = waitingId.replace('match-artwork-skeleton-', '');
  const boundary = page.getByTestId(`artwork-boundary-match-${id}`);
  assert.equal(
    await boundary.getByRole('button').count(),
    0,
    'Incomplete rows cannot expose partial map buttons',
  );
  const before = await boundary.boundingBox();
  await page.screenshot({ path: `${out}/slow-match-skeletons.png`, fullPage: true });
  checks.push('delayed public artwork shows structured loading without blocking navigation');
  held = false;
  release();
  await waiting.waitFor({ state: 'detached', timeout: 15000 });
  await boundary.getByRole('button', { name: /^Open .+ match$/ }).waitFor();
  const after = await boundary.boundingBox();
  assert.ok(
    Math.abs(before.height - after.height) <= 1,
    'Revealing artwork must not change row height',
  );
  assert.ok(
    (await boundary.locator('img').count()) >= 2,
    'Complete row renders map and agent together',
  );
  await page.screenshot({ path: `${out}/slow-match-revealed.png`, fullPage: true });
  checks.push('match row reveals data and settled artwork as one layout');
  await context.close();
  const failing = await browser.newContext({
    viewport: { width: 320, height: 800 },
    reducedMotion: 'reduce',
  });
  const errorPage = await failing.newPage();
  errorPage.on('pageerror', (error) => errors.push(error.message));
  await errorPage.route('https://media.valorant-api.com/**', (route) => route.abort());
  await errorPage.goto(base);
  await errorPage.getByRole('button', { name: 'Try the demo', exact: true }).click();
  await errorPage.getByRole('tab', { name: 'Profile', exact: true }).click();
  await errorPage.locator('[data-testid^="match-skeleton-"]').first().scrollIntoViewIfNeeded();
  const finished = errorPage.locator('[data-testid^="artwork-boundary-match-"]').first();
  await finished.getByRole('button', { name: /^Open .+ match$/ }).waitFor();
  assert.equal(await finished.getByRole('progressbar').count(), 0);
  await errorPage.screenshot({ path: `${out}/failed-artwork-row.png`, fullPage: true });
  checks.push('failed media settles to a stable usable card rather than an infinite skeleton');
  await failing.close();
  assert.deepEqual(errors, []);
  passed = true;
  console.log(
    JSON.stringify(
      { checks, errors, navigationMs, mediaRequests, simulatedSlowMedia: true },
      null,
      2,
    ),
  );
} finally {
  await fs.writeFile(
    `${out}/loading-browser.json`,
    JSON.stringify(
      { checks, errors, passed, realAccountTests: false, checkedAt: new Date().toISOString() },
      null,
      2,
    ),
  );
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
