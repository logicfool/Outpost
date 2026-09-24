import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'docs', process.env.OUTPOST_VALIDATION_DIR ?? 'validation-0.9.5');
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
const revealHistory = async () => {
  await page.waitForTimeout(350);
  const dialog = page.getByRole('dialog');
  const area = (await dialog.count()) ? dialog.last() : page;
  const settledScroll = async (locator) => {
    try {
      await locator.scrollIntoViewIfNeeded();
    } catch (error) {
      if (!String(error).includes('not attached to the DOM')) throw error;
    }
  };
  const skeleton = area.locator('[data-testid^="match-skeleton-"]').first();
  if (await skeleton.count()) await settledScroll(skeleton);
  else {
    const artwork = area.locator('[data-testid^="match-artwork-skeleton-"]').first();
    if (await artwork.count()) await settledScroll(artwork);
  }
};
const click = async (name) => {
  if (/^Open .+ match$/.test(name)) await revealHistory();
  await page.getByRole('button', { name, exact: true }).click();
};
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
    await page.getByRole('button', { name: 'Open rank history', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Open ranked rewind', exact: true }).waitFor();
    await shot('profile');
  });
  await check('rank history and ranked rewind open as detailed profile sheets', async () => {
    await click('Open rank history');
    const rankHistory = page.getByRole('dialog');
    await rankHistory.getByText('V26 // ACT V', { exact: true }).waitFor();
    await rankHistory.getByText('END OF ACT', { exact: true }).first().waitFor();
    await shot('rank-history');
    await click('Back from rank history');
    await click('Open ranked rewind');
    const rewind = page.getByRole('dialog');
    await rewind.getByText('Ranked Rewind', { exact: true }).waitFor();
    await rewind
      .getByText(/\+6 RR/)
      .first()
      .waitFor();
    await shot('ranked-rewind');
    await click('Back from ranked rewind');
  });
  await check('live game opens a team-switching roster and contextual player details', async () => {
    await click('View live game details');
    await page.getByTestId('live-roster').waitFor();
    assert.equal(await page.locator('[data-testid^="live-player-"]').count(), 5);
    await page.getByRole('button', { name: 'View You profile', exact: true }).waitFor();
    await tab('Opponents');
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
    await revealHistory();
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
  await check('round timeline opens an event minimap without another match request', async () => {
    await click('Open Ascent match');
    await tab('Rounds');
    await page.getByTestId('round-kill-chart').waitFor();
    await shot('round-visual-overview');
    await click('Details by round');
    await page.getByText('Round 1 / 21', { exact: true }).waitFor();
    await page.getByTestId('round-minimap').waitFor();
    await page.waitForFunction(() =>
      [...document.querySelectorAll('[data-testid="round-minimap"] img')].some(
        (i) => i.complete && i.naturalWidth > 0,
      ),
    );
    assert.ok((await page.locator('[data-testid^="map-player-"]').count()) > 0);
    await shot('round-detail-first');
    await click('Next event');
    await shot('round-detail-next-event');
    await click('Next round');
    await page.getByText('Round 2 / 21', { exact: true }).waitFor();
    await shot('round-detail-second');
    await click('Toggle round economy');
    await page.getByText('Round economy', { exact: true }).waitFor();
    await shot('round-economy');
    await click('Previous round');
    await page.getByText('Round 1 / 21', { exact: true }).waitFor();
    await click('Back from round details');
    await click('Close match report');
  });
  await check('duel matrix cells show paired events and link back to a round', async () => {
    await click('Open Ascent match');
    await tab('Duels');
    await page.getByTestId('duel-matrix').waitFor();
    assert.equal(await page.getByRole('button', { name: /^Duels / }).count(), 25);
    await shot('duel-matrix');
    const cells = page.getByRole('button', { name: /^Duels / });
    let picked = false;
    for (let i = 0; i < (await cells.count()); i++) {
      const label = await cells.nth(i).getAttribute('aria-label');
      if (label && !label.includes(': 0 kills 0 deaths')) {
        await cells.nth(i).click();
        picked = true;
        break;
      }
    }
    assert.equal(picked, true);
    await shot('duel-pair-events');
    await page
      .getByRole('button', { name: /^Round \d+ event / })
      .first()
      .click();
    await page.getByTestId('round-minimap').waitFor();
    await click('Back from round details');
    await click('Close match report');
  });
  await check(
    'live round score and match skins are available from the current roster',
    async () => {
      await click('View live game details');
      await page.getByTestId('live-match-hero').getByText('Round 13', { exact: true }).waitFor();
      await page.getByTestId('live-match-hero').getByText('7', { exact: true }).waitFor();
      await page.getByTestId('live-match-hero').getByText('5', { exact: true }).waitFor();
      await click('Match skins');
      await page.getByText('Equipped skins and buddies for this match.', { exact: true }).waitFor();
      await page.getByRole('tab', { name: 'Lumen', exact: true }).click();
      await shot('live-match-skins');
      await page.getByRole('textbox', { name: 'Search match loadout', exact: true }).fill('Vandal');
      await page.getByText('Prime Vandal', { exact: true }).waitFor();
      assert.equal(
        await page.getByRole('button', { name: 'View equipped Vandal', exact: true }).count(),
        1,
      );
      await click('Back from match skins');
      await click('Back from live match');
    },
  );
  await check(
    'round map and duel matrix fit a narrow phone without document overflow',
    async () => {
      await page.setViewportSize({ width: 320, height: 740 });
      await click('Open Ascent match');
      await tab('Rounds');
      await click('Details by round');
      await page.getByTestId('round-minimap').waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await shot('round-map-320');
      await click('Back from round details');
      await tab('Duels');
      await page.getByTestId('duel-matrix').waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await shot('duel-matrix-320');
      await click('Close match report');
      await page.setViewportSize({ width: 390, height: 844 });
    },
  );
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
    await tab('Friends');
    await click('Open chats');
    assert.equal(
      await page.getByRole('button', { name: 'Connect Riot chat', exact: true }).count(),
      0,
    );
    await tab('Online');
    await page
      .getByRole('button', { name: /^Open conversation with / })
      .first()
      .waitFor();
    await shot('friends-online');
    await tab('All friends');
    await shot('friends-all');
    await page
      .getByRole('button', { name: /^Open conversation with / })
      .first()
      .click();
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
    await click('All items');
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
    await click('Back from collection browser');
  });
  await check(
    'Collection home groups loadout actions and categories instead of a giant grid',
    async () => {
      await tab('Collection');
      const collectionHome = page.getByTestId('collection-home');
      await collectionHome.waitFor();
      await collectionHome.getByText(/VP$/, { exact: false }).waitFor();
      const compactHeader = page.getByTestId('compact-scroll-header-collection');
      await collectionHome.evaluate((node) => {
        node.scrollTop = 0;
        node.dispatchEvent(new Event('scroll', { bubbles: true }));
      });
      await page.waitForFunction(
        () =>
          Number(
            getComputedStyle(
              document.querySelector('[data-testid="compact-scroll-header-collection"]'),
            ).opacity,
          ) < 0.1,
      );
      assert.equal(
        Number(await compactHeader.evaluate((node) => getComputedStyle(node).opacity)),
        0,
      );
      await collectionHome.evaluate((node) => {
        node.scrollTop = 80;
        node.dispatchEvent(new Event('scroll', { bubbles: true }));
      });
      await page.waitForFunction(
        () =>
          Number(
            getComputedStyle(
              document.querySelector('[data-testid="compact-scroll-header-collection"]'),
            ).opacity,
          ) > 0.9,
      );
      for (const label of [
        'Change banner',
        'Change title',
        'Weapon loadout',
        'Saved loadouts',
        'Skins',
        'Buddies',
        'Sprays',
        'Player cards',
        'Titles',
      ])
        await page.getByRole('button', { name: label, exact: true }).waitFor();
      await page.evaluate(() => {
        for (const node of document.querySelectorAll('*'))
          if (node.scrollHeight > node.clientHeight) node.scrollTop = 0;
      });
      await shot('collection-home');
      await click('Weapon loadout');
      await page.getByRole('button', { name: 'View equipped Phantom', exact: true }).waitFor();
      await shot('collection-equipped');
      await click('Back from weapon loadout');
      await click('Change title');
      await page.getByRole('tab', { name: 'Owned titles', exact: true }).waitFor();
      await click('Back from identity editor');
      await click('Skins');
      await page.getByRole('textbox', { name: 'Search collection', exact: true }).fill('Prime');
      await page.getByRole('button', { name: 'View Prime Vandal', exact: true }).waitFor();
      await shot('collection-search-owned');
      await click('Back from collection browser');
    },
  );
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
        const offers = [
          ...document.querySelectorAll(
            '[data-testid="tab-scene-store"] button[aria-label^="View "]',
          ),
        ];
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
    await page.getByText(/Detailed capture is off/).waitFor();
    await page.getByRole('button', { name: 'Export diagnostics (JSON)', exact: true }).waitFor();
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
  await check(
    'saved messages survive restart with automatic chat and no connection controls',
    async () => {
      await tab('Friends');
      await click('Open chats');
      assert.equal(
        await page.getByRole('button', { name: 'Disconnect chat', exact: true }).count(),
        0,
      );
      await tab('Recent');
      await page
        .getByRole('button', { name: /^Open conversation with / })
        .first()
        .click();
      await page.getByText('Hello from the Outpost demo 🦊', { exact: true }).waitFor();
      await shot('saved-chat-auto-light');
      await page
        .getByRole('button', { name: 'View chat participant profile', exact: true })
        .waitFor();
      assert.equal(
        await page.getByRole('button', { name: 'Reconnect chat', exact: true }).count(),
        0,
      );
      await click('Conversation settings');
      await click('Sync this conversation now');
      await page.getByText('History synced.', { exact: true }).waitFor();
      await click('Back from chat settings');
      await click('Conversation settings');
      await click('Delete saved conversation');
      await click('Keep messages');
      await click('Back from chat settings');
      await page.getByText('Hello from the Outpost demo 🦊', { exact: true }).waitFor();
      await click('Conversation settings');
      await click('Delete saved conversation');
      await click('Delete local messages');
      await page.getByText('Local messages deleted.', { exact: true }).waitFor();
      await click('Back from chat settings');
      await page.getByText('No messages saved yet', { exact: true }).waitFor();
      await click('Back from conversation');
      await click('Back from friends');
    },
  );
  await check(
    'dedicated Friends tab uses compact square portraits and separates chat navigation',
    async () => {
      await tab('Friends');
      assert.equal(
        await page.getByRole('button', { name: 'Connect friends', exact: true }).count(),
        0,
      );
      await page.getByText('Online 2', { exact: true }).waitFor();
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
      // Friends deliberately defers filtering so typing remains responsive. Wait for that render.
      await page.waitForFunction(
        () =>
          document.querySelectorAll(
            '[data-testid="tab-scene-friends"] button[aria-label^="Chat with "]',
          ).length === 1,
      );
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
  await check(
    'refresh policy is explicit in Settings and store expiry is a local countdown',
    async () => {
      await tab('Settings');
      await page.getByText('Every 5 seconds in game', { exact: true }).waitFor();
      await page.getByText('When the daily timer resets', { exact: true }).waitFor();
      await page.getByText('Patch-aware cache', { exact: true }).waitFor();
      await shot('refresh-policy');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await tab('Store');
      await page.getByText('Pull down to refresh', { exact: true }).waitFor();
      await shot('store-light');
    },
  );
  await check(
    'account picker is local, scrollable and shows the selected square portrait',
    async () => {
      await tab('Store');
      assert.equal(await page.getByRole('button', { name: 'Open chats', exact: true }).count(), 0);
      await click('Switch account');
      await page.getByText('1 saved', { exact: true }).waitFor();
      const choice = page.getByRole('button', { name: 'Switch to Nightshift #DEMO', exact: true });
      await choice.waitFor();
      await choice.getByRole('img', { name: 'Player card portrait' }).waitFor();
      await shot('account-switcher');
      await choice.click();
      await page.getByRole('tab', { name: 'Store', exact: true }).waitFor();
    },
  );
  await check('named loadout presets can be saved edited applied and deleted in demo', async () => {
    await tab('Collection');
    await click('Saved loadouts');
    await click('Create loadout');
    await page.getByRole('textbox', { name: 'Loadout name', exact: true }).fill('Night set');
    await click('Save loadout');
    await click('Edit Night set');
    await page.getByRole('textbox', { name: 'Loadout name', exact: true }).fill('Day set');
    await click('Save loadout');
    await click('Apply Day set');
    await click('Apply demo preset');
    await page.getByText('Demo loadout applied.', { exact: true }).waitFor();
    await shot('loadout-presets');
    await click('Delete Day set');
    await click('Confirm delete preset');
    await page.getByText('Create your first loadout', { exact: true }).waitFor();
    await click('Back from loadouts');
  });
  await check('owned buddy can be equipped and removed without changing a skin', async () => {
    await tab('Collection');
    await click('Weapon buddies');
    await click('Manage Vandal buddy');
    const choice = page.getByRole('button', { name: /^Use .* copy \d+/ }).first();
    await choice.waitFor();
    await choice.click();
    await click('Done with buddy');
    await click('Confirm buddy change');
    const slot = page.getByRole('button', { name: 'Manage Vandal buddy', exact: true });
    await slot.waitFor();
    assert.equal(await slot.getByText('No buddy', { exact: true }).count(), 0);
    await shot('buddy-equipped');
    await slot.click();
    await click('No buddy');
    await click('Done with buddy');
    await click('Confirm buddy change');
    await page
      .getByRole('button', { name: 'Manage Vandal buddy', exact: true })
      .getByText('No buddy', { exact: true })
      .waitFor();
    await shot('buddy-removed');
    await click('Back from buddy manager');
  });
  await check('buddy choice survives saving and reopening a named preset', async () => {
    await tab('Collection');
    await click('Saved loadouts');
    await click('Create loadout');
    await page.getByRole('textbox', { name: 'Loadout name', exact: true }).fill('Buddy preset');
    await click('Edit Vandal skin');
    await click('Manage buddy');
    const choice = page.getByRole('button', { name: /^Use .* copy \d+/ }).first();
    await choice.click();
    await shot('buddy-picker');
    await click('Done with buddy');
    await click('Done with weapon');
    await click('Save loadout');
    await click('Edit Buddy preset');
    await click('Edit Vandal skin');
    await click('Manage buddy');
    assert.equal(
      await page
        .getByRole('button', { name: /^Use .* copy \d+/ })
        .filter({ has: page.getByText('Selected', { exact: true }) })
        .count(),
      1,
    );
    await click('No buddy');
    await click('Done with buddy');
    await click('Done with weapon');
    await click('Save loadout');
    await click('Edit Buddy preset');
    await click('Edit Vandal skin');
    await page.getByText('Buddy will be removed', { exact: true }).waitFor();
    await click('Back to preset');
    await click('Cancel preset editing');
    await click('Delete Buddy preset');
    await click('Confirm delete preset');
    await click('Back from loadouts');
  });
  await check('notification defaults are enabled and VP purchase stays off', async () => {
    await tab('Settings');
    for (const name of [
      'Wishlist alerts',
      'Chat alerts',
      'Notification previews',
      'Allow VP purchases',
    ]) {
      const toggle = page.getByRole('switch', { name, exact: true });
      await toggle.scrollIntoViewIfNeeded();
      assert.equal(await toggle.isChecked(), name !== 'Allow VP purchases');
      assert.equal(await toggle.isDisabled(), true);
    }
    await shot('notification-purchase-settings');
  });
  await check(
    'floating navigation overlays scrolling content without a rectangular host',
    async () => {
      await tab('Store');
      const nav = page.getByTestId('floating-bottom-nav');
      const box = await nav.boundingBox();
      assert.ok(box && box.y + box.height >= 839 && box.y + box.height <= 844);
      assert.equal(await nav.evaluate((n) => getComputedStyle(n).position), 'absolute');
      assert.equal(await nav.evaluate((n) => getComputedStyle(n).borderTopWidth), '0px');
      await shot('floating-store');
    },
  );
  await check(
    'account sheet survives repeated native-style open and close transitions',
    async () => {
      for (let i = 0; i < 6; i++) {
        await click('Switch account');
        await page.getByText('Switch account', { exact: true }).waitFor();
        await click('Close account switcher');
        await page.getByRole('button', { name: 'Switch account', exact: true }).waitFor();
      }
      await shot('account-sheet-return');
    },
  );
  await check('bundle search is local and cards open their items and media', async () => {
    await tab('Store');
    await tab('Bundles');
    await page
      .getByRole('button', { name: 'Open After-hours collection bundle', exact: true })
      .first()
      .click();
    await page.getByText('Included items', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'View Reaver Vandal', exact: true }).click();
    await page.getByRole('button', { name: 'Close item details', exact: true }).waitFor();
    await click('Close item details');
    await shot('bundle-contents');
    await click('Back from bundle');
    await click('Search bundles');
    const query = page.getByRole('textbox', { name: 'Bundle search', exact: true });
    await query.fill('After-hours');
    await page
      .getByRole('button', { name: 'Open After-hours collection bundle', exact: true })
      .first()
      .waitFor();
    await shot('bundle-search');
    await query.fill('nothing-matches-064');
    assert.equal(await page.getByRole('button', { name: /^Open .* bundle$/ }).count(), 0);
    await click('Close bundle search');
    assert.equal(
      await page.getByRole('textbox', { name: 'Bundle search', exact: true }).count(),
      0,
    );
    await tab('Today');
  });
  await check(
    'a preset chooses an alternate owned skin in the app and keeps it on reopening',
    async () => {
      await tab('Collection');
      await click('Saved loadouts');
      await click('Create loadout');
      await page.getByRole('textbox', { name: 'Loadout name', exact: true }).fill('Selected here');
      await click('Edit Vandal skin');
      await page.getByRole('textbox', { name: 'Search owned skins', exact: true }).fill('Prime');
      await click('Use Prime Vandal');
      await shot('loadout-owned-skins');
      await click('Done with weapon');
      await click('Save loadout');
      await click('Edit Selected here');
      await click('Edit Vandal skin');
      await page
        .getByRole('button', { name: 'Use Prime Vandal', exact: true })
        .getByText('Selected', { exact: true })
        .waitFor();
      await click('Back to preset');
      await click('Cancel preset editing');
      await click('Delete Selected here');
      await click('Confirm delete preset');
      await click('Back from loadouts');
    },
  );
  await check('video autoplay progresses and pause/play controls work', async () => {
    await tab('Store');
    await click('View Reaver Vandal');
    const video = page.locator('video').first();
    await video.scrollIntoViewIfNeeded();
    await page.waitForFunction(
      () => {
        const v = document.querySelector('video');
        return v && v.currentTime > 0.25 && !v.paused && !v.muted;
      },
      null,
      { timeout: 45000 },
    );
    await click('Pause video');
    await page.waitForFunction(() => document.querySelector('video')?.paused);
    const at = await video.evaluate((v) => v.currentTime);
    await page.waitForTimeout(500);
    assert.ok(Math.abs((await video.evaluate((v) => v.currentTime)) - at) < 0.25);
    await click('Play video');
    await page.waitForFunction(
      (t) => {
        const v = document.querySelector('video');
        return v && !v.paused && v.currentTime > t + 0.15;
      },
      at,
      { timeout: 15000 },
    );
    await shot('video-playing');
    await click('Close item details');
    assert.equal(await page.locator('video').count(), 0);
  });
  await check('autoplay opt-out survives restart and manual play remains available', async () => {
    await tab('Settings');
    await page.getByRole('switch', { name: 'Autoplay previews', exact: true }).uncheck();
    await page.waitForFunction(() => localStorage.getItem('outpost.autoplayVideos') === 'false');
    await page.reload();
    await click('Try the demo');
    await click('View Reaver Vandal');
    await page.getByRole('button', { name: 'Play video', exact: true }).waitFor();
    await page.waitForFunction(
      () => {
        const v = document.querySelector('video');
        return v && v.readyState >= 1;
      },
      null,
      { timeout: 45000 },
    );
    assert.equal(
      await page
        .locator('video')
        .first()
        .evaluate((v) => v.paused),
      true,
    );
    await click('Play video');
    await page.waitForFunction(
      () => {
        const v = document.querySelector('video');
        return v && v.currentTime > 0.25;
      },
      null,
      { timeout: 15000 },
    );
    await click('Close item details');
    await tab('Settings');
    await page.getByRole('switch', { name: 'Autoplay previews', exact: true }).check();
  });
  await check('settings hide duplicate accounts and keep concise appearance controls', async () => {
    await tab('Settings');
    assert.equal(await page.getByText('Accounts', { exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Add account', exact: true }).count(), 0);
    assert.equal(
      await page
        .getByText(
          'Theme applies to all screens, dialogs and chat. System follows your device appearance.',
          { exact: true },
        )
        .count(),
      0,
    );
    for (const name of ['System', 'Navy', 'Dark', 'Light'])
      await page.getByRole('tab', { name, exact: true }).waitFor();
    assert.equal(
      await page.getByRole('switch', { name: 'Allow VP purchases', exact: true }).isChecked(),
      false,
    );
    assert.equal(await page.getByText(/Assets:|valorant-api\.com/).count(), 0);
    await page.getByText('Outpost 0.9.2', { exact: true }).scrollIntoViewIfNeeded();
    await shot('about-clean');
    await tab('Profile');
    assert.equal(await page.getByText('Saved locally', { exact: true }).count(), 0);
    await tab('Settings');
    await shot('settings-clean');
  });
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
