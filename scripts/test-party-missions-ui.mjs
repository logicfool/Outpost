import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'docs', process.env.OUTPOST_VALIDATION_DIR ?? 'validation-0.10.0'),
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
  const button = (name) => page.getByRole('button', { name, exact: true });
  const tab = (name) => page.getByRole('tab', { name, exact: true });
  const shot = async (name) => {
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
  };
  const check = async (name, work) => {
    await work();
    checks.push(name);
    console.log('PASS', name);
  };

  await page.goto(base, { waitUntil: 'networkidle' });
  await button('Try the demo').click();

  await tab('Battle Pass').click();
  await check('missions sit above other contracts on the battle pass screen', async () => {
    const summary = page.getByTestId('missions-summary');
    const other = page.getByText('Other contracts', { exact: true });
    await summary.waitFor();
    await other.waitFor();
    assert.ok((await summary.boundingBox()).y < (await other.boundingBox()).y);
  });
  await check(
    'the weekly summary counts what is left, what is done and the next unlock',
    async () => {
      await page.getByText('WEEKLY MISSIONS', { exact: true }).waitFor();
      await page.getByText('2 to do', { exact: true }).waitFor();
      await page.getByText(/4 done this act · 2 more unlock/).waitFor();
      await page.getByText(/Daily checkpoints are not shared by Riot's API/).waitFor();
      assert.equal(await page.getByText('DAILY CHECKPOINTS', { exact: true }).count(), 0);
      assert.equal(await page.getByText(/Mission \d$/).count(), 0);
      await shot('missions-summary');
    },
  );
  await check('active weeklies show their objective directive and real progress', async () => {
    await page.getByText('Pick Up Ultimate Orbs', { exact: true }).waitFor();
    await page.getByText('Pick Up 20 Ultimate Orbs', { exact: true }).waitFor();
    await page.getByText('12 / 20', { exact: true }).waitFor();
    await page.getByText('60%', { exact: true }).waitFor();
    await shot('missions-active');
  });
  await check('finished weeklies are listed as done, not as queued', async () => {
    await tab('Done 4').click();
    for (const title of ['Get Headshots', 'Play Matches', 'Use Abilities', 'Purchase Shields'])
      await page.getByText(title, { exact: true }).waitFor();
    assert.equal(await page.getByText('DONE', { exact: true }).count(), 4);
    await page.getByText(/no longer in\s+your active list are the ones you finished/).waitFor();
    assert.equal(await page.getByText(/queued/i).count(), 0);
    await shot('missions-done');
  });
  await check('future weeklies are previewed per scheduled unlock date', async () => {
    await tab('Upcoming 2').click();
    await page.getByTestId('mission-week-Demo:3').waitFor();
    await page.getByText('Kill Players', { exact: true }).waitFor();
    assert.equal(
      await page.getByText('Plant or Defuse Spikes', { exact: true }).count(),
      0,
      'A later week is not shown until selected',
    );
    await page.getByTestId('mission-week-Demo:4').click();
    await page.getByText('Plant or Defuse Spikes', { exact: true }).waitFor();
    await page.getByText(/not a guarantee that these missions will be/).waitFor();
    await shot('missions-upcoming');
  });

  await tab('Profile').click();
  await check('profile exposes a party entry point', async () => {
    await page.getByTestId('open-party').waitFor();
    await page.getByTestId('open-party').click();
    await page.getByText('PARTY LOBBY', { exact: true }).waitFor();
  });
  await check('party shows queue, members, ready state and leader controls', async () => {
    await page.getByText('Competitive', { exact: true }).first().waitFor();
    await page.getByText('3 / 5 players', { exact: true }).waitFor();
    await page.getByText('Halfstep', { exact: true }).waitFor();
    assert.equal(
      await page.getByText('WAITING', { exact: true }).count(),
      1,
      'One member is not ready',
    );
    assert.equal(await page.getByText('READY', { exact: true }).count(), 2);
    await shot('party-lobby');
  });
  await check('the queue cannot start while a member is not ready', async () => {
    assert.equal(await button('Start queue').isDisabled(), true);
    await page.getByText(/Halfstep\s+is\s+not ready/).waitFor();
  });
  await check('queue options are selectable and the current queue is marked', async () => {
    await page.getByTestId('party-queue-unrated').waitFor();
    assert.equal(await page.getByTestId('party-queue-deathmatch').count(), 1);
    await shot('party-queues');
  });
  await check('party actions in demo never contact Riot and report that clearly', async () => {
    await button('Ready up')
      .click()
      .catch(() => {});
    await button('Not ready')
      .click()
      .catch(() => {});
    await page.getByTestId('party-error').waitFor();
    assert.match(await page.getByTestId('party-error').innerText(), /Demo/i);
    await shot('party-demo-blocked');
  });
  await check('party access, code and invite controls are present', async () => {
    await page.getByTestId('party-access-closed').waitFor();
    await page.getByTestId('party-access-open').waitFor();
    await button('Create party code').waitFor();
    await page.getByTestId('party-invite-input').waitFor();
    await page.getByTestId('party-code-input').waitFor();
    await page.getByText(/Outpost never readies up, queues or invites on its own/).waitFor();
  });
  await button('Back from party').click();

  await check('profile filters compose queue, map, agent and result', async () => {
    await page.getByTestId('match-filter-toggle').waitFor();
    const before = await page.locator('[data-testid^="artwork-boundary-match-"]').count();
    await page.getByTestId('match-filter-toggle').click();
    await page.getByTestId('match-filter-queue-competitive').click();
    await page.getByTestId('match-filter-toggle').waitFor();
    assert.match(await page.getByTestId('match-filter-toggle').innerText(), /Filters · 1/);
    const after = await page.locator('[data-testid^="artwork-boundary-match-"]').count();
    assert.ok(after <= before, 'Filtering never adds matches');
    await shot('profile-filters');
  });
  await check('a single clear action resets every filter', async () => {
    await page.getByTestId('match-filter-clear').click();
    const label = await page.getByTestId('match-filter-toggle').innerText();
    assert.ok(
      !label.includes('·'),
      `Filter count remained after clearing: ${JSON.stringify(label)}`,
    );
    assert.equal(await page.getByTestId('match-filter-clear').count(), 0);
  });

  await tab('Collection').click();
  await check('collection offers spray editing beside the other loadout actions', async () => {
    await button('Change sprays').waitFor();
    await button('Change sprays').click();
    await page.getByText('PRE-ROUND', { exact: true }).waitFor();
    await page.getByText('MID-ROUND', { exact: true }).waitFor();
    await page.getByText('POST-ROUND', { exact: true }).waitFor();
    await shot('sprays-wheel');
  });
  await check('a spray already in another slot cannot be picked twice', async () => {
    const options = page.locator('[data-testid^="spray-option-"]');
    await options.first().waitFor();
    assert.ok(
      (await page.getByText('IN USE', { exact: true }).count()) >= 1,
      'Equipped sprays are marked in use',
    );
  });
  await check('choosing a spray stages an unsaved change that can be discarded', async () => {
    const free = page
      .locator(
        '[data-testid^="spray-option-"]:not([aria-disabled="true"]):not([aria-selected="true"])',
      )
      .last();
    await free.click();
    await page.getByText('1 unsaved change', { exact: true }).waitFor();
    await button('Discard changes').click();
    assert.equal(await page.getByText('1 unsaved change', { exact: true }).count(), 0);
    await shot('sprays-staged');
  });
  await check('the spray slot can be cleared explicitly', async () => {
    await page.getByTestId('spray-clear').click();
    await page.getByText('1 unsaved change', { exact: true }).waitFor();
    await page.getByText(/confirmed by reading your loadout back/).waitFor();
    await button('Discard changes').click();
  });
  await button('Back from sprays').click();

  await check('party and missions fit a 320 pixel screen without overflow', async () => {
    await page.setViewportSize({ width: 320, height: 800 });
    await tab('Battle Pass').click();
    await page.getByText('WEEKLY MISSIONS', { exact: true }).waitFor();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    assert.ok(overflow <= 1, `Missions overflow by ${overflow}px`);
    await shot('missions-320');
    await tab('Profile').click();
    await page.getByTestId('open-party').click();
    await page.getByText('PARTY LOBBY', { exact: true }).waitFor();
    const partyOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    assert.ok(partyOverflow <= 1, `Party overflows by ${partyOverflow}px`);
    await shot('party-320');
    await button('Back from party').click();
  });
  await check('the new screens render in the light theme', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await tab('Settings').click();
    await tab('Light').click();
    await tab('Battle Pass').click();
    await page.getByText('WEEKLY MISSIONS', { exact: true }).waitFor();
    await shot('missions-light');
    await tab('Profile').click();
    await page.getByTestId('open-party').click();
    await page.getByText('PARTY LOBBY', { exact: true }).waitFor();
    await shot('party-light');
    await button('Back from party').click();
  });

  assert.deepEqual(errors, []);
  await context.close();
  passed = true;
} catch (error) {
  process.exitCode = 1;
  console.error('PARTY_MISSIONS_FAILURE', error.stack);
} finally {
  await fs.writeFile(
    `${out}/party-missions-browser.json`,
    JSON.stringify(
      {
        checks,
        errors,
        passed,
        realAccountTests: false,
        partyMutationsSent: false,
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log('PAGE_ERRORS', JSON.stringify(errors));
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
