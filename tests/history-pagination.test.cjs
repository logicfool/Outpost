const test = require('node:test'),
  assert = require('node:assert/strict');
const { RiotClient } = require('../.test-build/riot.js'),
  { HttpClient } = require('../.test-build/http.js');
const { ID, session, catalog, response } = require('./helpers.cjs');

function fixture() {
  const requests = [];
  const client = new RiotClient(
    session(),
    new HttpClient(async (url) => {
      requests.push(url);
      const query = new URL(url).searchParams,
        start = Number(query.get('startIndex')),
        end = Number(query.get('endIndex'));
      if (end - start > 20)
        return response(
          {
            httpStatus: 400,
            errorCode: url.includes('competitiveupdates')
              ? 'MMR_INVALID_INDICES'
              : 'MATCH_HISTORY_INVALID_INDICES',
            message: 'invalid indices',
          },
          400,
        );
      if (url.includes('competitiveupdates')) return response({ Matches: [] });
      return response({
        Subject: ID,
        BeginIndex: start,
        EndIndex: Math.min(end, 87),
        Total: 87,
        History: Array.from({ length: Math.max(0, Math.min(end, 87) - start) }, (_, n) => ({
          MatchID: `aaaaaaaa-aaaa-4aaa-8aaa-${String(n + start).padStart(12, '0')}`,
          GameStartTime: 1700000000000 - (n + start) * 1000,
          QueueID: 'competitive',
        })),
      });
    }),
    { version: async () => 'release-fixture' },
    catalog(),
  );
  return { client, requests };
}
test('history and RR use valid 20-entry windows at nonzero offsets', async () => {
  const h = fixture(),
    rows = await h.client.matchHistory(20, 20);
  assert.equal(rows.length, 20);
  assert.equal(h.requests.length, 2);
  for (const url of h.requests) {
    const q = new URL(url).searchParams;
    assert.equal(q.get('startIndex'), '20');
    assert.equal(q.get('endIndex'), '40');
  }
});
test('the rejected 50-entry window is blocked before either endpoint is contacted', async () => {
  const h = fixture();
  await assert.rejects(h.client.matchHistory(0, 50), (e) => e.code === 'PAGINATION');
  assert.equal(h.requests.length, 0);
});
test('an 87-match history returns seven final rows, not an unavailable feature', async () => {
  const h = fixture();
  assert.equal((await h.client.matchHistory(80, 20)).length, 7);
});
for (const errorCode of ['MATCH_HISTORY_INVALID_INDICES', 'MMR_INVALID_INDICES'])
  test(
    errorCode + ' keeps a range-specific diagnostic instead of endpoint unavailable',
    async () => {
      const http = new HttpClient(async () =>
        response(
          { httpStatus: 400, errorCode, message: 'invalid indices used when querying history' },
          400,
        ),
      );
      await assert.rejects(
        http.json('https://pd.ap.a.pvp.net/match-history/v1/history/' + ID),
        (e) =>
          e.code === 'HISTORY_RANGE' &&
          e.status === 400 &&
          !e.message.includes('temporarily unavailable'),
      );
    },
  );
