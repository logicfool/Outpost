const { test } = require('node:test');
const assert = require('node:assert/strict');
const auth = require('../.test-build/auth.js');
const v = require('../.test-build/validation.js');
const { ID, OTHER, jwt, session, code } = require('./helpers.cjs');
const now = 1789383600000;
const attempt = { state: 'a'.repeat(64), nonce: 'b'.repeat(64), createdAt: now };
const callback = (patch = {}) =>
  auth.REDIRECT_URI +
  '#' +
  new URLSearchParams({
    state: attempt.state,
    access_token: jwt({ exp: now / 1000 + 3600 }),
    id_token: jwt({ nonce: attempt.nonce, sub: ID }),
    token_type: 'Bearer',
    expires_in: '3600',
    ...patch,
  });
test('authorization uses HTTPS Riot origin and exact callback, nonce, state', () => {
  const u = new URL(auth.authorizationUrl(attempt));
  assert.equal(u.origin, 'https://auth.riotgames.com');
  assert.equal(u.searchParams.get('state'), attempt.state);
  assert.equal(u.searchParams.get('nonce'), attempt.nonce);
  assert.equal(u.searchParams.get('redirect_uri'), auth.REDIRECT_URI);
});
test('weak state is rejected before sign-in', () =>
  assert.throws(() => auth.authorizationUrl({ ...attempt, state: 'weak' }), code('AUTH_STATE')));
test('valid callback yields bounded token session', () =>
  assert.equal(auth.parseCallback(callback(), attempt, now).expiresAt, now + 3600000));
test('callback state mismatch fails closed', () =>
  assert.throws(
    () => auth.parseCallback(callback({ state: 'other' }), attempt, now),
    code('AUTH_STATE'),
  ));
test('callback nonce mismatch fails closed', () =>
  assert.throws(
    () => auth.parseCallback(callback({ id_token: jwt({ nonce: 'other' }) }), attempt, now),
    code('AUTH_NONCE'),
  ));
test('duplicate token parameters fail closed', () =>
  assert.throws(
    () => auth.parseCallback(callback() + '&access_token=duplicate-token', attempt, now),
    code('AUTH_REDIRECT'),
  ));
test('old sign-in window fails', () =>
  assert.throws(() => auth.parseCallback(callback(), attempt, now + 601000), code('AUTH_TIMEOUT')));
test('future-dated sign-in window fails', () =>
  assert.throws(
    () => auth.parseCallback(callback(), { ...attempt, createdAt: now + 31000 }, now),
    code('AUTH_TIMEOUT'),
  ));
test('callback URL query is rejected', () =>
  assert.throws(
    () => auth.parseCallback(callback().replace('/opt_in#', '/opt_in?extra=true#'), attempt, now),
    code('AUTH_REDIRECT'),
  ));
test('invalid expiry fails instead of creating permanent session', () =>
  assert.throws(
    () => auth.parseCallback(callback({ expires_in: 'abc' }), attempt, now),
    code('AUTH_EXPIRY'),
  ));
test('expiry cannot exceed one hour even when server value is longer', () =>
  assert.equal(
    auth.parseCallback(callback({ expires_in: '999999' }), attempt, now).expiresAt,
    now + 3600000,
  ));
test('access-token expiry is respected when earlier', () =>
  assert.equal(
    auth.parseCallback(callback({ access_token: jwt({ exp: now / 1000 + 100 }) }), attempt, now)
      .expiresAt,
    now + 100000,
  ));
test('expired access token is rejected', () =>
  assert.throws(
    () =>
      auth.parseCallback(callback({ access_token: jwt({ exp: now / 1000 - 1 }) }), attempt, now),
    code('SESSION_EXPIRED'),
  ));
test('unsupported token type fails', () =>
  assert.throws(
    () => auth.parseCallback(callback({ token_type: 'basic' }), attempt, now),
    code('AUTH_TOKEN'),
  ));
test('Riot rejection does not expose upstream error text', () =>
  assert.throws(
    () => auth.parseCallback(callback({ error: 'secret-sensitive-error' }), attempt, now),
    (e) => e.code === 'AUTH_DENIED' && !e.message.includes('secret-sensitive'),
  ));
for (const url of [
  'https://auth.riotgames.com.evil.invalid/',
  'http://auth.riotgames.com/',
  'https://auth.riotgames.com@evil.invalid/',
  'https://auth.riotgames.com:8443/',
  'file:///etc/passwd',
  'javascript:alert(1)',
  'https://playvalorant.com/other',
])
  test(`navigation blocked: ${url}`, () => assert.equal(auth.isLoginNavigationAllowed(url), false));
test('regional routing uses NA shard for BR and LATAM', () => {
  assert.equal(auth.shardFor('br'), 'na');
  assert.equal(auth.shardFor('latam'), 'na');
  assert.equal(auth.shardFor('ap'), 'ap');
  assert.throws(() => auth.shardFor('india'), code('REGION'));
});
test('userinfo stores only minimal approved metadata', () => {
  const a = auth.accountFromUserInfo(
    {
      sub: ID,
      acct: { game_name: 'नाम', tag_line: 'TEST' },
      email: 'private@example.invalid',
      phone_number: 'sensitive',
      country: 'ind',
    },
    'ap',
    now + 1000,
    now,
  );
  assert.equal(a.gameName, 'नाम');
  assert.equal(a.email, undefined);
  assert.equal(a.phone_number, undefined);
});
test('malformed JWT is an untrusted empty hint, not an identity', () =>
  assert.deepEqual(auth.decodeJwtClaimsUnverified('garbage'), {}));
test('session shard mismatch and demo sessions are rejected', () => {
  const s = session();
  assert.throws(
    () => auth.validateSession({ ...s, account: { ...s.account, shard: 'eu' } }),
    code('SESSION_INVALID'),
  );
  assert.throws(
    () => auth.validateSession({ ...s, account: { ...s.account, demo: true } }),
    code('SESSION_INVALID'),
  );
});
test('token validation blocks whitespace/header injection', () =>
  assert.throws(() => v.token('a'.repeat(30) + '\r\nHost:evil'), code('INVALID_TOKEN')));
test('image URLs are restricted to public catalog media', () => {
  assert.ok(v.safeImage('https://media.valorant-api.com/image.png'));
  assert.equal(v.safeImage('https://media.valorant-api.com.evil.invalid/x'), undefined);
  assert.equal(v.safeImage('http://media.valorant-api.com/x'), undefined);
});
test('unknown error never reflects token-bearing text', () =>
  assert.ok(!v.safeError(new Error('access_token=secret')).message.includes('secret')));
test('different response subject is rejected', () =>
  assert.throws(() => v.sameSubject({ Subject: OTHER }, ID), code('ACCOUNT_MISMATCH')));
