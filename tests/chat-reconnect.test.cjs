const test = require('node:test'),
  assert = require('node:assert/strict');
const { ChatReconnect, chatConnectionLabel } = require('../.test-build/chatReconnect.js');
function fixture() {
  let now = 1000000;
  const p = new ChatReconnect(
    () => now,
    () => 0,
  );
  return {
    p,
    advance: (ms) => (now += ms),
    get now() {
      return now;
    },
  };
}
test('connection failures back off exponentially and remain bounded after six failures', () => {
  const h = fixture(),
    delays = [];
  for (let i = 0; i < 9; i++) {
    const next = h.p.failed('CHAT_NETWORK');
    delays.push(next - h.now);
    h.advance(next - h.now);
  }
  assert.deepEqual(delays, [10000, 20000, 40000, 80000, 160000, 300000, 300000, 300000, 300000]);
  assert.equal(h.p.blocked, false);
});
test('server retry deadlines override the local reconnect schedule', () => {
  const h = fixture();
  assert.equal(h.p.failed('RATE_LIMIT', h.now + 900000), h.now + 900000);
});
test('a short ready interval does not reset the backoff and a sustained connection does', () => {
  const h = fixture();
  h.p.failed('CHAT_NETWORK');
  h.advance(10000);
  h.p.ready();
  h.advance(500);
  assert.equal(h.p.failed('CHAT_NETWORK') - h.now, 20000);
  h.advance(20000);
  h.p.ready();
  h.advance(60001);
  assert.equal(h.p.failed('CHAT_NETWORK') - h.now, 10000);
});
test('repeated ready-state presence updates do not prevent stable-connection recovery', () => {
  const h = fixture();
  h.p.failed('CHAT_NETWORK');
  h.p.ready();
  h.advance(40000);
  h.p.ready();
  h.advance(21000);
  assert.equal(h.p.failed('CHAT_NETWORK') - h.now, 10000);
});
test('rejected credentials get only one automatic retry until credentials change', () => {
  const h = fixture();
  h.p.credentials(9000000);
  assert.equal(h.p.failed('CHAT_AUTH') - h.now, 60000);
  h.advance(60000);
  assert.equal(h.p.failed('CHAT_AUTH'), undefined);
  assert.equal(h.p.blocked, true);
  h.p.credentials(9000000);
  assert.equal(h.p.blocked, true);
  h.p.credentials(10000000);
  assert.equal(h.p.blocked, false);
});
test('unsafe identity and unsupported protocol failures do not loop', () => {
  for (const code of [
    'ACCOUNT_MISMATCH',
    'SESSION_REMOVED',
    'CHAT_IDENTITY',
    'CHAT_PROTOCOL',
    'CHAT_CONFIG',
    'CHAT_XML',
    'NATIVE_REQUIRED',
  ]) {
    const h = fixture();
    assert.equal(h.p.failed(code), undefined);
    assert.equal(h.p.blocked, true);
  }
});
test('jitter spreads clients without retrying earlier than the base interval', () => {
  const p = new ChatReconnect(
    () => 100000,
    () => 1,
  );
  assert.equal(p.failed('NETWORK'), 111500);
});
test('connection notices are passive and do not ask users to connect or disconnect', () => {
  for (const status of ['disconnected', 'connecting', 'authenticating', 'error'])
    assert.ok(!/tap|press|disconnect/i.test(chatConnectionLabel({ status })));
  assert.match(chatConnectionLabel({ status: 'error', errorCode: 'CHAT_AUTH' }), /Sign in again/);
});
test('a renewed account session unblocks a previous sign-in requirement but not a protocol mismatch', () => {
  const h = fixture();
  h.p.credentials(9000000);
  h.p.failed('AUTH_REDIRECT');
  assert.equal(h.p.blocked, true);
  h.p.credentials(10000000);
  assert.equal(h.p.blocked, false);
  h.p.failed('CHAT_PROTOCOL');
  h.p.credentials(11000000);
  assert.equal(h.p.blocked, true);
});
