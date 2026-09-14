const { test } = require('node:test');
const assert = require('node:assert/strict');
const { HttpClient, SingleFlightCache } = require('../.test-build/http.js');
const { CatalogClient } = require('../.test-build/catalog.js');
const { RiotClient, connectAccount } = require('../.test-build/riot.js');
const {
  ID,
  OTHER,
  MATCH,
  session,
  jwt,
  response,
  catalog,
  storefront,
  code,
} = require('./helpers.cjs');
test('request cookies are omitted and automatic redirects disabled', async () => {
  let init;
  await new HttpClient(async (_, options) => {
    init = options;
    return response({});
  }).json('https://auth.riotgames.com/userinfo');
  assert.equal(init.credentials, 'omit');
  assert.equal(init.redirect, 'error');
});
test('HTTP and credential-bearing URLs never reach transport', async () => {
  const client = new HttpClient(async () => {
    throw new Error('must not fetch');
  });
  await assert.rejects(client.json('http://auth.riotgames.com/x'), code('NETWORK_POLICY'));
  await assert.rejects(
    client.json('https://user:pass@auth.riotgames.com/x'),
    code('NETWORK_POLICY'),
  );
});
for (const [status, expected] of [
  [401, 'SESSION_EXPIRED'],
  [403, 'ACCESS_DENIED'],
  [500, 'SERVICE_UNAVAILABLE'],
])
  test(`${status} response returns sanitized ${expected}`, async () => {
    const client = new HttpClient(async () => response({ sensitive: 'secret' }, status));
    await assert.rejects(
      client.json('https://pd.ap.a.pvp.net/x'),
      (e) => e.code === expected && !e.message.includes('secret'),
    );
  });
test('rate limit respects retry-after and suppresses further origin requests', async () => {
  let count = 0,
    now = 100000;
  const client = new HttpClient(
    async () => {
      count++;
      return response({}, 429, { 'retry-after': '5' });
    },
    () => now,
  );
  await assert.rejects(client.json('https://pd.ap.a.pvp.net/x'), (e) => e.retryAt === 105000);
  await assert.rejects(client.json('https://pd.ap.a.pvp.net/y'), code('RATE_LIMIT'));
  assert.equal(count, 1);
  now = 105001;
  await assert.rejects(client.json('https://pd.ap.a.pvp.net/y'), code('RATE_LIMIT'));
  assert.equal(count, 2);
});
test('HTML errors cannot be mistaken for account JSON', async () => {
  const client = new HttpClient(
    async () =>
      new Response('<html>challenge</html>', { headers: { 'content-type': 'text/html' } }),
  );
  await assert.rejects(client.json('https://auth.riotgames.com/userinfo'), code('SCHEMA'));
});
test('redirected response is rejected', async () => {
  const r = response({});
  Object.defineProperty(r, 'redirected', { value: true });
  await assert.rejects(
    new HttpClient(async () => r).json('https://auth.riotgames.com/userinfo'),
    code('NETWORK_POLICY'),
  );
});
test('parallel request pool never exceeds its bound', async () => {
  let active = 0,
    peak = 0;
  const client = new HttpClient(
    async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 3));
      active--;
      return response({});
    },
    Date.now,
    3,
  );
  await Promise.all(
    Array.from({ length: 24 }, (_, i) => client.json(`https://pd.ap.a.pvp.net/${i}`)),
  );
  assert.equal(peak, 3);
});
test('single flight shares pending work and cache expires', async () => {
  let count = 0,
    now = 1;
  const cache = new SingleFlightCache(() => now),
    load = async () => {
      count++;
      await new Promise((resolve) => setTimeout(resolve, 2));
      return count;
    };
  assert.deepEqual(await Promise.all([cache.get('x', 10, load), cache.get('x', 10, load)]), [1, 1]);
  assert.equal(await cache.get('x', 10, load), 1);
  now = 12;
  assert.equal(await cache.get('x', 10, load), 2);
});
test('failed single flight is not cached as success', async () => {
  const cache = new SingleFlightCache();
  await assert.rejects(
    cache.get('x', 1000, async () => {
      throw Error();
    }),
  );
  assert.equal(await cache.get('x', 1000, async () => 1), 1);
});
test('public metadata requests never include Riot authorization', async () => {
  const seen = [];
  const publicClient = new CatalogClient(
    new HttpClient(async (url, init) => {
      seen.push({ url, init });
      return response(
        url.includes('version')
          ? { data: { riotClientVersion: 'release-10.00-test' } }
          : { data: [] },
      );
    }),
  );
  await publicClient.version();
  await publicClient.load();
  assert.ok(seen.length > 5);
  for (const request of seen) {
    assert.equal(new URL(request.url).origin, 'https://valorant-api.com');
    assert.equal(new Headers(request.init.headers).get('Authorization'), null);
  }
});
test('connect validates identity at Riot and resolves geo without retaining ID token', async () => {
  const s = session(),
    calls = [];
  const http = new HttpClient(async (url, init) => {
    calls.push({ url, init });
    return response(
      url.includes('userinfo')
        ? { sub: ID, acct: { game_name: 'Own', tag_line: 'TEST' } }
        : url.includes('entitlements.auth')
          ? { entitlements_token: s.entitlementsToken }
          : { affinities: { live: 'ap' } },
    );
  });
  const result = await connectAccount(http, {
    accessToken: s.accessToken,
    idToken: jwt({ sub: ID }),
    expiresAt: s.account.expiresAt,
  });
  assert.equal(result.account.puuid, ID);
  assert.equal(result.idToken, undefined);
  assert.equal(calls.length, 3);
});
test('tokens belonging to two different accounts cannot be combined', async () => {
  const s = session();
  const http = new HttpClient(async (url) =>
    response(url.includes('userinfo') ? { sub: ID } : { entitlements_token: s.entitlementsToken }),
  );
  await assert.rejects(
    connectAccount(
      http,
      { accessToken: s.accessToken, idToken: jwt({ sub: OTHER }), expiresAt: s.account.expiresAt },
      'ap',
    ),
    code('ACCOUNT_MISMATCH'),
  );
});
const publicStub = { version: async () => 'release-10.00-test' };
test('v2 disappearance allows documented v3 POST fallback with same own-account scope', async () => {
  const calls = [];
  const client = new RiotClient(
    session(),
    new HttpClient(async (url, init) => {
      calls.push({ url, init });
      return url.includes('/v2/') ? response({}, 404) : response(storefront());
    }),
    publicStub,
    catalog(),
  );
  const data = await client.store();
  assert.equal(data.endpoint, 'v3');
  assert.equal(calls[1].init.method, 'POST');
  assert.equal(calls[1].init.body, '{}');
  assert.ok(calls.every((c) => c.url.endsWith(ID)));
});
for (const status of [401, 403, 429])
  test(`${status} cannot trigger alternate store endpoint`, async () => {
    let calls = 0;
    const client = new RiotClient(
      session(),
      new HttpClient(async () => {
        calls++;
        return response({}, status);
      }),
      publicStub,
      catalog(),
    );
    await assert.rejects(client.store());
    assert.equal(calls, 1);
  });
test('disposed account refuses further requests', async () => {
  const client = new RiotClient(
    session(),
    new HttpClient(async () => {
      throw Error('must not fetch');
    }),
    publicStub,
    catalog(),
  );
  client.dispose();
  await assert.rejects(client.store(), code('SESSION_REMOVED'));
});
test('expired account cannot make live requests', async () => {
  const s = session();
  s.account.expiresAt = Date.now();
  const client = new RiotClient(
    s,
    new HttpClient(async () => {
      throw Error();
    }),
    publicStub,
    catalog(),
  );
  await assert.rejects(client.store(), code('SESSION_EXPIRED'));
});
test('match outside own loaded history is blocked', async () => {
  let detailsCalled = false;
  const client = new RiotClient(
    session(),
    new HttpClient(async (url) => {
      if (url.includes('match-details')) detailsCalled = true;
      return response(url.includes('match-history') ? { History: [] } : { Matches: [] });
    }),
    publicStub,
    catalog(),
  );
  await assert.rejects(client.matchDetail(MATCH), code('MATCH_SCOPE'));
  assert.equal(detailsCalled, false);
});
test('pagination rejects abusive ranges', async () => {
  const client = new RiotClient(session(), new HttpClient(), publicStub, catalog());
  await assert.rejects(client.matchHistory(-1), code('PAGINATION'));
  await assert.rejects(client.matchHistory(0, 10000), code('PAGINATION'));
});
test('a failing store does not erase successful balances; no demo substitution', async () => {
  const client = new RiotClient(
    session(),
    new HttpClient(async (url) =>
      response(
        url.includes('wallet') ? { Subject: ID, Balances: { x: 25 } } : {},
        url.includes('storefront') ? 403 : 200,
      ),
    ),
    publicStub,
    catalog(),
  );
  const result = await client.snapshot();
  assert.equal(result.demo, false);
  assert.equal(result.store.status, 'error');
  assert.equal(result.wallet.status, 'ready');
  assert.equal(result.wallet.data[0].amount, 25);
  assert.equal(result.collection.status, 'error');
});
test('mismatched response subject cannot become store data', async () => {
  const client = new RiotClient(
    session(),
    new HttpClient(async () => response({ ...storefront(), Subject: OTHER })),
    publicStub,
    catalog(),
  );
  await assert.rejects(client.store(), code('ACCOUNT_MISMATCH'));
});
test('clearing cache prevents an old pending result from repopulating it', async () => {
  const cache = new SingleFlightCache();
  let finish;
  const pending = cache.get(
    'x',
    10000,
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  cache.clear();
  finish('old');
  await pending;
  assert.equal(await cache.get('x', 10000, async () => 'new'), 'new');
});
