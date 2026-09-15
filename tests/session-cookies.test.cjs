const test = require('node:test'),
  assert = require('node:assert/strict');
const { ID, OTHER, jwt, session, code } = require('./helpers.cjs');
const {
  selectRiotCookies,
  cleanSessionCookies,
  assertCookieSubject,
} = require('../.test-build/sessionCookies.js');
const { validateSession, rotatedCookies, sessionActive } = require('../.test-build/auth.js');
const { stageSessionRenewal, sessionHealth } = require('../.test-build/sessionRenewal.js');
const cookie = (name, value, domain = '.auth.riotgames.com', rest = {}) => ({
  name,
  value,
  domain,
  path: '/',
  secure: true,
  ...rest,
});
test('leading-dot auth-domain cookie reproduces old iOS filter bug and is now captured', () => {
  assert.equal('auth.riotgames.com'.includes('.auth.riotgames.com'), false);
  const raw = { ssid: cookie('ssid', 'second-cookie'), sub: cookie('sub', OTHER) };
  assert.equal(selectRiotCookies(raw, true, OTHER).ssid, 'second-cookie');
});
test('trusted parent domain, host-only auth and authorize path work', () => {
  for (const domain of ['.riotgames.com', 'auth.riotgames.com', '.auth.riotgames.com']) {
    assert.equal(
      selectRiotCookies({ ssid: cookie('ssid', 'value', domain, { path: '/authorize' }) }, true)
        .ssid,
      'value',
    );
  }
});
test('foreign lookalike domains, unrelated paths and expired cookies cannot be reused', () => {
  for (const rest of [
    { domain: 'auth.riotgames.com.evil.invalid' },
    { domain: 'evilriotgames.com' },
    { path: '/other' },
    { expires: '2020-01-01T00:00:00Z' },
  ]) {
    assert.throws(
      () => selectRiotCookies({ ssid: { ...cookie('ssid', 'value'), ...rest } }, true),
      code('REAUTH_COOKIE'),
    );
  }
});
test('iOS requires domain metadata while Android URL-scoped reads may omit it', () => {
  const raw = { ssid: { name: 'ssid', value: 'android-cookie' } };
  assert.throws(() => selectRiotCookies(raw, true), code('REAUTH_COOKIE'));
  assert.equal(selectRiotCookies(raw, false).ssid, 'android-cookie');
});
test('cookie from the first account cannot be attached to the second account', () => {
  const raw = { ssid: cookie('ssid', 'first-cookie'), sub: cookie('sub', ID) };
  assert.throws(() => selectRiotCookies(raw, true, OTHER), code('REAUTH_ACCOUNT_MISMATCH'));
});
test('cookie allowlist strips arbitrary keys and unsafe header values', () => {
  assert.deepEqual(
    cleanSessionCookies({
      ssid: 'abc',
      __cf_bm: 'ignored',
      injected: 'x',
      tdid: 'x; ssid=bad',
      csid: 'a\r\nb',
    }),
    { ssid: 'abc' },
  );
});
test('8192-byte boundary survives secure session validation', () => {
  const saved = session();
  saved.reauth = { cookies: { ssid: 'a'.repeat(8192) }, capturedAt: 1 };
  assert.equal(validateSession(saved).reauth.cookies.ssid.length, 8192);
  assert.equal(validateSession(saved).account.canReauth, true);
});
test('stale account flags are derived from actual vault contents', () => {
  const s = session();
  s.account.canReauth = true;
  assert.equal(validateSession(s).account.canReauth, false);
  s.reauth = { cookies: { ssid: 'saved' }, capturedAt: 1 };
  s.account.canReauth = false;
  assert.equal(validateSession(s).account.canReauth, true);
});
test('cookie rotation handles empty getSetCookie implementations and Expires deletions', () => {
  const headers = new Headers({
    'set-cookie': 'ssid=next; Secure, tdid=gone; Expires=Wed, 01 Jan 2020 00:00:00 GMT',
  });
  headers.getSetCookie = () => [];
  assert.deepEqual(rotatedCookies({ ssid: 'old', tdid: 'old' }, headers), { ssid: 'next' });
});
test('renewal checkpoint contains rotated credentials but cannot initialize ready API access', () => {
  const s = session();
  s.reauth = { cookies: { ssid: 'old' }, capturedAt: 1 };
  const saved = stageSessionRenewal(s, {
    accessToken: jwt({ sub: ID, exp: Date.now() / 1000 + 3600 }),
    expiresAt: Date.now() + 3500000,
    reauthCookies: { ssid: 'new' },
  });
  assert.equal(saved.reauth.cookies.ssid, 'new');
  assert.equal(saved.renewalPending, true);
  assert.equal(sessionActive(saved), false);
  assert.equal(sessionHealth(saved).token, 'pending');
  assert.equal(sessionHealth(saved).reusable, true);
});
test('renewal checkpoint rejects a different subject without modifying old credentials', () => {
  const s = session();
  s.reauth = { cookies: { ssid: 'old' }, capturedAt: 1 };
  assert.throws(
    () =>
      stageSessionRenewal(s, {
        accessToken: jwt({ sub: OTHER }),
        expiresAt: Date.now() + 3500000,
        reauthCookies: { ssid: 'other' },
      }),
    code('ACCOUNT_MISMATCH'),
  );
  assert.equal(s.reauth.cookies.ssid, 'old');
});
test('explicit session-cookie deletion does not resurrect the old ssid during renewal', () => {
  const s = session();
  s.reauth = { cookies: { ssid: 'old' }, capturedAt: 1 };
  const staged = stageSessionRenewal(s, {
    accessToken: s.accessToken,
    expiresAt: s.account.expiresAt,
    reauthCookies: {},
  });
  assert.equal(staged.reauth, undefined);
  assert.equal(staged.account.canReauth, false);
});
