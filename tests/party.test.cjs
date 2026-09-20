const test = require('node:test'),
  assert = require('node:assert/strict');
const { ID, OTHER, session, response, code } = require('./helpers.cjs');
const {
  normalizeParty,
  normalizePartyPlayer,
  assertLeader,
  assertQueueReady,
  assertQueueSelectable,
  assertInQueue,
  assertRemovable,
  assertRequest,
  validateInviteCode,
  validateRiotId,
  validateQueueId,
} = require('../.test-build/party.js');
const { RiotClient } = require('../.test-build/riot.js'),
  { HttpClient } = require('../.test-build/http.js');

const PARTY = '66666666-6666-4666-8666-666666666666';
const CARD = '77777777-7777-4777-8777-777777777777';
const catalog = () => ({
  items: { [CARD]: { id: CARD, canonicalId: CARD, name: 'Fixture card', kind: 'card' } },
  bundles: {},
  maps: { '/Game/Maps/Ascent/Ascent': { name: 'Ascent' } },
  tiers: { '21': { name: 'Immortal 1' } },
  contracts: {},
  fetchedAt: 0,
});

const member = (subject, extra = {}) => ({
  Subject: subject,
  CompetitiveTier: 21,
  IsReady: true,
  IsModerator: false,
  IsOwner: subject === ID,
  PlayerIdentity: {
    Subject: subject,
    AccountLevel: 240,
    PlayerCardID: CARD,
    Incognito: false,
    HideAccountLevel: false,
  },
  Pings: [{ GamePodID: 'ap-gp-mumbai-1', Ping: 32 }],
  PlatformType: 'PC',
  ...extra,
});
const raw = (extra = {}) => ({
  ID: PARTY,
  Version: 4,
  State: 'DEFAULT',
  Accessibility: 'CLOSED',
  PartyOwnerID: ID,
  Members: [member(ID), member(OTHER)],
  MatchmakingData: {
    QueueID: 'competitive',
    PreferredGamePods: ['ap-gp-mumbai-1'],
    SkillDisparityRRPenalty: 0,
  },
  EligibleQueues: ['competitive', 'unrated', 'swiftplay'],
  QueueIneligibilities: [],
  Requests: [],
  InviteCode: '',
  MaxPartySize: 5,
  ...extra,
});
const party = (extra = {}, self = ID) => normalizeParty(raw(extra), PARTY, self, catalog(), 1000);

test('party player response maps the account to its current party', () => {
  assert.equal(
    normalizePartyPlayer({ Subject: ID, CurrentPartyID: PARTY, Version: 2 }, ID).partyId,
    PARTY,
  );
});
test('a party belonging to another account is refused', () => {
  assert.throws(
    () => normalizePartyPlayer({ Subject: OTHER, CurrentPartyID: PARTY }, ID),
    code('ACCOUNT_MISMATCH'),
  );
});
test('a missing current party is reported rather than invented', () => {
  assert.throws(() => normalizePartyPlayer({ Subject: ID }, ID), code('PARTY_ABSENT'));
});
test('members carry rank, level, card, ready state and pings', () => {
  const p = party();
  assert.equal(p.members.length, 2);
  assert.equal(p.members[0].self, true);
  assert.equal(p.members[0].owner, true);
  assert.equal(p.members[0].tierName, 'Immortal 1');
  assert.equal(p.members[0].level, 240);
  assert.equal(p.members[0].card.name, 'Fixture card');
  assert.deepEqual(p.members[0].pings, [{ gamePodId: 'ap-gp-mumbai-1', ping: 32 }]);
  assert.equal(p.selfIsLeader, true);
  assert.equal(p.maxSize, 5);
});
test('a hidden party member keeps their identity hidden and their level unavailable', () => {
  const hidden = party({
    Members: [
      member(ID),
      member(OTHER, {
        PlayerIdentity: {
          Subject: OTHER,
          AccountLevel: 240,
          Incognito: true,
          HideAccountLevel: true,
        },
      }),
    ],
  });
  assert.equal(hidden.members[1].name, 'Hidden player');
  assert.equal(hidden.members[1].hidden, true);
  assert.equal(hidden.members[1].level, null);
});
test('own hidden identity stays visible to the account itself', () => {
  const p = party({
    Members: [
      member(ID, {
        PlayerIdentity: { Subject: ID, AccountLevel: 240, Incognito: true, HideAccountLevel: true },
      }),
    ],
  });
  assert.equal(p.members[0].hidden, false);
  assert.equal(p.members[0].level, 240);
});
test('a party without the linked account is refused', () => {
  assert.throws(
    () =>
      normalizeParty(raw({ Members: [member(OTHER)], PartyOwnerID: OTHER }), PARTY, ID, catalog()),
    code('ACCOUNT_MISMATCH'),
  );
});
test('a party identifier that does not match the request is refused', () => {
  assert.throws(() => normalizeParty(raw(), OTHER, ID, catalog()), code('PARTY_SCOPE'));
});
test('a missing roster is a schema error, not an empty party', () => {
  assert.throws(() => normalizeParty({ ID: PARTY }, PARTY, ID, catalog()), code('SCHEMA'));
});
test('matchmaking state, invite code and requests are read from Riot only', () => {
  const queued = party({
    State: 'MATCHMAKING',
    QueueEntryTime: '2026-09-21T10:00:00Z',
    InviteCode: 'AB12CD',
    Requests: [{ ID: 'req-1', Subject: OTHER }],
  });
  assert.equal(queued.inQueue, true);
  assert.equal(queued.inviteCode, 'AB12CD');
  assert.equal(queued.requests[0].subject, OTHER);
  assert.ok(queued.queueEntryAt > 0);
  assert.equal(party().inviteCode, undefined);
});
test('unparsable queue identifiers are dropped instead of shown', () => {
  assert.deepEqual(
    party({ EligibleQueues: ['competitive', 'x', '../escape', 42] }).eligibleQueues,
    ['competitive'],
  );
});

test('non-leaders cannot change the queue, start it or remove members', () => {
  const follower = party({
    PartyOwnerID: OTHER,
    Members: [member(ID, { IsOwner: false }), member(OTHER, { IsOwner: true })],
  });
  assert.equal(follower.selfIsLeader, false);
  assert.throws(() => assertLeader(follower, 'change the queue'), code('PARTY_NOT_LEADER'));
  assert.throws(() => assertQueueReady(follower), code('PARTY_NOT_LEADER'));
  assert.throws(() => assertRemovable(follower, OTHER), code('PARTY_NOT_LEADER'));
  assert.throws(() => assertRequest(follower, 'req-1'), code('PARTY_NOT_LEADER'));
});
test('queues Riot marked ineligible or never listed are refused before dispatch', () => {
  assert.throws(
    () =>
      assertQueueSelectable(
        party({ QueueIneligibilities: [{ QueueID: 'competitive', Reason: 'LEVEL' }] }),
        'competitive',
      ),
    code('QUEUE_INELIGIBLE'),
  );
  assert.throws(() => assertQueueSelectable(party(), 'premier'), code('QUEUE_INELIGIBLE'));
  assert.equal(assertQueueSelectable(party(), 'Competitive'), 'competitive');
});
test('the queue does not start while a member is not ready or no queue is chosen', () => {
  assert.throws(
    () => assertQueueReady(party({ Members: [member(ID), member(OTHER, { IsReady: false })] })),
    code('QUEUE_NOT_READY'),
  );
  assert.throws(() => assertQueueReady(party({ MatchmakingData: {} })), code('QUEUE_MISSING'));
  assert.throws(() => assertQueueReady(party({ State: 'MATCHMAKING' })), code('QUEUE_ALREADY'));
  assert.doesNotThrow(() => assertQueueReady(party()));
});
test('stopping the queue requires an active queue', () => {
  assert.throws(() => assertInQueue(party()), code('QUEUE_IDLE'));
  assert.doesNotThrow(() => assertInQueue(party({ State: 'MATCHMAKING' })));
});
test('the leader cannot be removed and absent members are reported', () => {
  assert.throws(() => assertRemovable(party(), ID), code('PARTY_SELF_REMOVE'));
  assert.throws(
    () => assertRemovable(party(), '88888888-8888-4888-8888-888888888888'),
    code('PARTY_MEMBER_MISSING'),
  );
  assert.equal(assertRemovable(party(), OTHER), OTHER);
});
test('only pending join requests can be declined', () => {
  assert.throws(() => assertRequest(party(), 'req-1'), code('PARTY_REQUEST_MISSING'));
  assert.equal(
    assertRequest(party({ Requests: [{ ID: 'req-1', Subject: OTHER }] }), 'req-1'),
    'req-1',
  );
});
test('typed codes, Riot IDs and queue identifiers are validated before a request is built', () => {
  assert.equal(validateInviteCode(' AB12cd '), 'ab12cd');
  for (const bad of ['ab', 'code with spaces', '../../escape', 'a'.repeat(20)])
    assert.throws(() => validateInviteCode(bad), code('CODE_INVALID'));
  assert.deepEqual(validateRiotId(' Fixture ', '#1234'), { name: 'Fixture', tag: '1234' });
  for (const bad of [
    ['ab', '1234'],
    ['Fixture', '12'],
    ['Fix/ture', '1234'],
    ['Fixture', 'no-tag'],
  ])
    assert.throws(() => validateRiotId(...bad), code('RIOT_ID_INVALID'));
  assert.throws(() => validateQueueId('../escape'), code('QUEUE_INVALID'));
});

function fixture(initial = raw()) {
  let current = initial;
  const calls = [];
  const client = new RiotClient(
    session(),
    new HttpClient(async (url, init) => {
      const path = new URL(url).pathname;
      calls.push({ path, method: init.method ?? 'GET' });
      if (path.endsWith(`/players/${ID}`) && (init.method ?? 'GET') === 'GET')
        return response({ Subject: ID, CurrentPartyID: PARTY, Version: 1 });
      if (path.includes('/name-service/')) return response({});
      if (path.endsWith('/setReady')) {
        current = {
          ...current,
          Members: current.Members.map((m) =>
            m.Subject === ID ? { ...m, IsReady: JSON.parse(init.body).ready } : m,
          ),
        };
        return response(current);
      }
      if (path.endsWith('/queue')) {
        current = {
          ...current,
          MatchmakingData: { ...current.MatchmakingData, QueueID: JSON.parse(init.body).queueId },
        };
        return response(current);
      }
      if (path.endsWith('/matchmaking/join')) {
        current = { ...current, State: 'MATCHMAKING' };
        return response(current);
      }
      if (path.endsWith('/matchmaking/leave')) {
        current = { ...current, State: 'DEFAULT' };
        return response(current);
      }
      if (path.endsWith('/invitecode')) {
        current = { ...current, InviteCode: init.method === 'DELETE' ? '' : 'ZZ99YY' };
        return response(current);
      }
      if (path.includes('/invites/name/')) return response(current);
      return response(current);
    }),
    { version: async () => 'release-fixture' },
    catalog(),
  );
  return {
    client,
    calls,
    get current() {
      return current;
    },
  };
}

test('reading the party issues one player lookup and one party read', async () => {
  const f = fixture();
  const p = await f.client.party(true);
  assert.equal(p.id, PARTY);
  assert.deepEqual(
    f.calls.filter((c) => c.method === 'GET').map((c) => c.path),
    [`/parties/v1/players/${ID}`, `/parties/v1/parties/${PARTY}`],
  );
});
test('ready state, queue change and queue start each send exactly one write', async () => {
  const f = fixture();
  assert.equal((await f.client.setReady(false)).members.find((m) => m.self).ready, false);
  assert.equal((await f.client.changeQueue('unrated')).queueId, 'unrated');
  await f.client.setReady(true);
  assert.equal((await f.client.startQueue()).inQueue, true);
  assert.equal((await f.client.stopQueue()).inQueue, false);
  const writes = f.calls.filter((c) => c.method === 'POST' && !c.path.includes('name-service'));
  assert.deepEqual(
    writes.map((c) => c.path.split('/').slice(-2).join('/')),
    [`${ID}/setReady`, `${PARTY}/queue`, `${ID}/setReady`, 'matchmaking/join', 'matchmaking/leave'],
  );
});
test('an ineligible queue is never dispatched', async () => {
  const f = fixture();
  await assert.rejects(f.client.changeQueue('premier'), code('QUEUE_INELIGIBLE'));
  assert.equal(
    f.calls.filter((c) => c.method === 'POST' && !c.path.includes('name-service')).length,
    0,
  );
});
test('the queue is not started while a member is not ready', async () => {
  const f = fixture(raw({ Members: [member(ID), member(OTHER, { IsReady: false })] }));
  await assert.rejects(f.client.startQueue(), code('QUEUE_NOT_READY'));
  assert.equal(
    f.calls.some((c) => c.path.includes('matchmaking/join')),
    false,
  );
});
test('an account change immediately before dispatch stops the queue start', async () => {
  const f = fixture();
  await assert.rejects(
    f.client.startQueue(() => {
      throw Object.assign(new Error('Changed'), { code: 'ACCOUNT_CHANGED' });
    }),
    (e) => e.code === 'ACCOUNT_CHANGED',
  );
  assert.equal(
    f.calls.some((c) => c.path.includes('matchmaking/join')),
    false,
  );
});
test('party codes are created and disabled through the same path with different methods', async () => {
  const f = fixture();
  assert.equal((await f.client.generatePartyCode()).inviteCode, 'ZZ99YY');
  assert.equal((await f.client.disablePartyCode()).inviteCode, undefined);
  assert.deepEqual(
    f.calls.filter((c) => c.path.endsWith('/invitecode')).map((c) => c.method),
    ['POST', 'DELETE'],
  );
});
test('disabling a code that does not exist sends nothing', async () => {
  const f = fixture();
  await assert.rejects(f.client.disablePartyCode(), code('CODE_MISSING'));
  assert.equal(
    f.calls.some((c) => c.path.endsWith('/invitecode')),
    false,
  );
});
test('an invited Riot ID is percent-encoded into the path', async () => {
  const f = fixture();
  await f.client.invitePlayer('Fixture', '1234');
  assert.ok(
    f.calls.some((c) => c.path === `/parties/v1/parties/${PARTY}/invites/name/Fixture/tag/1234`),
  );
  await assert.rejects(f.client.invitePlayer('Fix/ture', '1234'), code('RIOT_ID_INVALID'));
});

test('an unreported party leader does not default to the linked account', () => {
  const { Members } = raw();
  const unknown = normalizeParty(
    { ...raw(), PartyOwnerID: undefined, Members: Members.map((m) => ({ ...m, IsOwner: false })) },
    PARTY,
    ID,
    catalog(),
  );
  assert.equal(unknown.leaderId, undefined);
  assert.equal(unknown.selfIsLeader, false);
  assert.equal(
    unknown.members.some((m) => m.owner),
    false,
  );
  assert.throws(() => assertLeader(unknown, 'start the queue'), code('PARTY_NOT_LEADER'));
});
