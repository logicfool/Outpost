const test = require('node:test'),
  assert = require('node:assert/strict');
const { AimService, aimOrigin } = require('../.test-build/aimService.js');
const { aimSnapshot, prepareAimDocument } = require('../.test-build/aimSettings.js');
const { AppError } = require('../.test-build/validation.js');
const { ID, OTHER, clone, document, change, store } = require('./aim-helpers.cjs');
function fixture(options = {}) {
  const repository = store();
  let now = 100000,
    doc = document(),
    reads = 0,
    writes = 0;
  const owners = [];
  const api = async (id) => ({
    readAimDocument: async () => {
      owners.push(id);
      reads++;
      if (options.read) return options.read({ reads, doc, now });
      return clone(doc);
    },
    writeAimDocument: async (data, guard) => {
      options.beforeDispatch?.();
      guard();
      writes++;
      assert.ok(repository.states.get(id)?.pending, 'journal must precede PUT');
      if (options.write) return options.write({ data, set: (v) => (doc = clone(v)), doc });
      doc = { ...doc, data: clone(data) };
    },
  });
  const service = new AimService(
    repository,
    api,
    () => now,
    () => OTHER,
  );
  return {
    repository,
    service,
    counts: () => ({ reads, writes }),
    owners,
    getDoc: () => clone(doc),
    setDoc: (v) => (doc = clone(v)),
    time: (v) => (now = v),
    advance: (v) => (now += v),
    consent: () => ({ gameClosed: true, confirmedAt: now }),
    restart: () =>
      new AimService(
        repository,
        api,
        () => now,
        () => OTHER,
      ),
  };
}
test('initial settings sync is a single read with persistent per-account cooldown', async () => {
  const h = fixture();
  const values = await Promise.all([
    h.service.sync(ID, 'auto'),
    h.service.sync(ID, 'auto'),
    h.service.sync(ID, 'manual'),
  ]);
  assert.equal(h.counts().reads, 1);
  assert.equal(values[0].snapshot.accountId, ID);
  await h.restart().sync(ID, 'manual');
  assert.equal(h.counts().reads, 1);
  h.advance(60001);
  await h.service.sync(ID, 'auto');
  assert.equal(h.counts().reads, 2);
  await h.service.sync(ID, 'manual');
  assert.equal(h.counts().reads, 2);
});
test('reconnecting marks one fresh read without discarding cached settings', async () => {
  const h = fixture();
  await h.service.sync(ID);
  h.advance(60001);
  await h.service.markLogin(ID);
  assert.ok(h.repository.states.get(ID).snapshot);
  await h.service.sync(ID, 'auto');
  assert.equal(h.counts().reads, 2);
  assert.equal(h.repository.states.get(ID).needsSync, false);
});
test('confirmed settings apply performs two preflight reads, one PUT, and a readback', async () => {
  const h = fixture(),
    result = await h.service.apply(ID, change(), h.consent(), () => {});
  assert.deepEqual(h.counts(), { reads: 3, writes: 1 });
  assert.equal(result.pending, undefined);
  assert.equal(result.snapshot.sensitivity.hipfire, 0.3);
  await assert.rejects(
    h.service.apply(
      ID,
      { ...change(), expectedRevision: result.snapshot.revision },
      h.consent(),
      () => {},
    ),
    (e) => e.code === 'AIM_WAIT',
  );
  assert.equal(h.counts().writes, 1);
});
test('closing-game confirmation is required and expires before dispatch', async () => {
  const h = fixture();
  for (const consent of [
    { gameClosed: false, confirmedAt: 100000 },
    { gameClosed: true, confirmedAt: 1 },
    { gameClosed: true, confirmedAt: 999999 },
  ])
    await assert.rejects(
      h.service.apply(ID, change(), consent, () => {}),
      (e) => e.code === 'AIM_CONFIRM',
    );
  assert.deepEqual(h.counts(), { reads: 0, writes: 0 });
});
test('concurrent changes to any settings field abort the write without rolling back Riot', async () => {
  const h = fixture({
    read: ({ reads, doc }) => {
      const d = clone(doc);
      if (reads === 2) d.data.futureSettings.keep = false;
      return d;
    },
  });
  await assert.rejects(
    h.service.apply(ID, change(), h.consent(), () => {}),
    (e) => e.code === 'AIM_CONFLICT',
  );
  assert.equal(h.counts().writes, 0);
});
test('an uncertain successful write survives restart and is reconciled read-only', async () => {
  const h = fixture({
    write: ({ data, set, doc }) => {
      set({ ...doc, data });
      throw new AppError('NETWORK', 'Lost acknowledgement');
    },
  });
  const result = await h.service.apply(ID, change(), h.consent(), () => {});
  assert.equal(result.error.code, 'AIM_UNCONFIRMED');
  assert.ok(result.pending);
  assert.equal(h.counts().writes, 1);
  await assert.rejects(
    h.restart().apply(ID, change(), h.consent(), () => {}),
    (e) => e.code === 'AIM_PENDING',
  );
  h.advance(60001);
  const checked = await h.restart().sync(ID);
  assert.equal(checked.pending, undefined);
  assert.equal(checked.snapshot.sensitivity.hipfire, 0.3);
  assert.equal(h.counts().writes, 1);
});
test('an unconfirmed write is never resent and can be dismissed only after a fresh read', async () => {
  const h = fixture({
    write: () => {
      throw new AppError('NETWORK', 'Disconnected');
    },
  });
  await h.service.apply(ID, change(), h.consent(), () => {});
  await assert.rejects(
    h.service.acceptServerState(ID, () => {}),
    (e) => e.code === 'AIM_PENDING',
  );
  h.advance(60001);
  await h.service.sync(ID);
  assert.ok(h.repository.states.get(ID).pending);
  await h.service.acceptServerState(ID, () => {});
  assert.equal(h.repository.states.get(ID).pending, undefined);
  assert.equal(h.counts().writes, 1);
});
test('explicit HTTP rejection is not confused with uncertain outcome', async () => {
  const h = fixture({
      write: () => {
        throw new AppError('ACCESS_DENIED', 'Denied', undefined, 403);
      },
    }),
    result = await h.service.apply(ID, change(), h.consent(), () => {});
  assert.equal(result.pending, undefined);
  assert.equal(result.error.code, 'ACCESS_DENIED');
  assert.equal(h.counts().writes, 1);
});
test('Retry-After survives service restart and stops manual settings reads and writes', async () => {
  const h = fixture({
    read: () => {
      throw new AppError('RATE_LIMIT', 'Wait', 220000, 429);
    },
  });
  await h.service.sync(ID);
  h.advance(60001);
  await h.restart().sync(ID);
  assert.equal(h.counts().reads, 1);
  await assert.rejects(
    h.restart().apply(ID, change(), h.consent(), () => {}),
    (e) => e.code === 'RATE_LIMIT',
  );
  assert.equal(h.counts().reads, 1);
  assert.equal(h.counts().writes, 0);
});
test('account switching immediately before dispatch cannot send the old confirmation', async () => {
  let selected = true;
  const h = fixture({
      beforeDispatch: () => {
        selected = false;
      },
    }),
    guard = () => {
      if (!selected) throw new AppError('ACCOUNT_CHANGED', 'Changed');
    };
  await assert.rejects(
    h.service.apply(ID, change(), h.consent(), guard),
    (e) => e.code === 'ACCOUNT_CHANGED',
  );
  assert.equal(h.counts().writes, 0);
});
test('accounts have independent cache, requests and pending journals', async () => {
  const h = fixture();
  await h.service.sync(ID);
  await h.service.sync(OTHER);
  assert.deepEqual(h.owners, [ID, OTHER]);
  assert.equal(h.repository.states.get(ID).snapshot.accountId, ID);
  assert.equal(h.repository.states.get(OTHER).snapshot.accountId, OTHER);
});
test('unknown regions never become arbitrary credential-bearing hosts', () => {
  for (const input of ['', 'pbe', 'localhost', 'ap.evil.example', 'https://evil.example'])
    assert.throws(() => aimOrigin(input));
  assert.equal(aimOrigin('AP'), 'https://player-preferences-apse1.pp.sgp.pvp.net');
  assert.equal(aimOrigin('EU'), 'https://player-preferences-euc1.pp.sgp.pvp.net');
  assert.equal(aimOrigin('KR'), 'https://player-preferences-apne1.pp.sgp.pvp.net');
});
test('HTTP errors during post-write verification never erase an accepted write journal', async () => {
  for (const status of [401, 403, 429]) {
    const h = fixture({
      read: ({ reads, doc }) => {
        if (reads === 3)
          throw new AppError(
            'VERIFY_FAILED',
            'Readback failed',
            status === 429 ? 250000 : undefined,
            status,
          );
        return clone(doc);
      },
    });
    const state = await h.service.apply(ID, change(), h.consent(), () => {});
    assert.ok(state.pending);
    assert.equal(state.error.code, 'AIM_UNCONFIRMED');
    assert.equal(h.counts().writes, 1);
    await assert.rejects(
      h.restart().apply(ID, change(), h.consent(), () => {}),
      (e) => e.code === 'AIM_PENDING',
    );
    assert.equal(h.counts().writes, 1);
  }
});
test('failure to durably journal the operation prevents any settings write', async () => {
  const h = fixture(),
    save = h.repository.saveAimState;
  h.repository.saveAimState = async (id, state) => {
    if (state.pending) throw new AppError('LOCAL_DATA', 'Storage unavailable');
    return save(id, state);
  };
  await assert.rejects(h.service.apply(ID, change(), h.consent(), () => {}));
  assert.equal(h.counts().writes, 0);
});
test('inherited or non-string regions cannot become a preferences host', () => {
  for (const input of ['constructor', '__proto__', 'toString', null, 42])
    assert.throws(
      () => aimOrigin(input),
      (e) => e.code === 'AIM_REGION',
    );
});

function externalSettings(h, hipfire = 0.61) {
  const d = h.getDoc();
  d.modified++;
  d.data.floatSettings[0].value = hipfire;
  d.data.floatSettings[1].value = 1.31;
  d.data.floatSettings[2].value = 0.83;
  const { defaultCrosshair } = require('../.test-build/crosshair.js'),
    { crosshairToRiot } = require('../.test-build/aimSettings.js');
  const library = JSON.parse(d.data.stringSettings[0].value);
  library.profiles.push(crosshairToRiot(defaultCrosshair('Changed in VALORANT')));
  library.currentProfile = 1;
  d.data.stringSettings[0].value = JSON.stringify(library);
  h.setDoc(d);
  return d;
}
test('manual refresh replaces locally chosen aim values with changed Riot values after five seconds', async () => {
  const h = fixture();
  await h.service.sync(ID);
  const preset = { id: OTHER, accountId: ID, name: 'Keep preset' };
  await h.repository.saveAimPreset(preset);
  externalSettings(h);
  h.advance(5001);
  const state = await h.service.sync(ID, 'manual');
  assert.deepEqual(state.snapshot.sensitivity, { hipfire: 0.61, ads: 1.31, scoped: 0.83 });
  assert.equal(state.snapshot.current, 1);
  assert.equal(state.snapshot.crosshairs[1].name, 'Changed in VALORANT');
  assert.deepEqual(await h.repository.aimPresets(ID), [preset]);
  assert.deepEqual(h.counts(), { reads: 2, writes: 0 });
  assert.equal(state.error, undefined);
});
test('automatic profile refresh replaces existing cached settings after a minute without writes', async () => {
  const h = fixture();
  const old = await h.service.sync(ID);
  externalSettings(h, 0.72);
  h.advance(59999);
  await h.service.sync(ID, 'auto');
  assert.equal(h.counts().reads, 1);
  h.advance(1);
  const state = await h.restart().sync(ID, 'auto');
  assert.equal(h.counts().reads, 2);
  assert.notEqual(state.snapshot.revision, old.snapshot.revision);
  assert.equal(state.snapshot.sensitivity.hipfire, 0.72);
  assert.equal(h.counts().writes, 0);
});
test('successful manual pulls debounce for five seconds rather than caching for a minute', async () => {
  const h = fixture();
  await h.service.sync(ID);
  externalSettings(h);
  h.advance(4999);
  const waiting = await h.restart().sync(ID, 'manual');
  assert.equal(waiting.error.code, 'AIM_READ_WAIT');
  assert.equal(h.counts().reads, 1);
  assert.equal(h.repository.states.get(ID).error, undefined);
  h.advance(1);
  await h.service.sync(ID, 'manual');
  assert.equal(h.counts().reads, 2);
});
test('a cached automatic flight cannot swallow explicit manual revalidation', async () => {
  const h = fixture();
  await h.service.sync(ID);
  externalSettings(h);
  h.advance(6000);
  const [auto, manual] = await Promise.all([
    h.service.sync(ID, 'auto'),
    h.service.sync(ID, 'manual'),
  ]);
  assert.equal(auto.snapshot.sensitivity.hipfire, 0.25);
  assert.equal(manual.snapshot.sensitivity.hipfire, 0.61);
  assert.equal(h.counts().reads, 2);
});
test('failed manual revalidation keeps last good values and honors its full retry delay', async () => {
  const h = fixture({
    read: ({ reads, doc }) => {
      if (reads > 1) throw new AppError('NETWORK', 'Offline');
      return clone(doc);
    },
  });
  const original = await h.service.sync(ID);
  h.advance(5000);
  const failed = await h.service.sync(ID, 'manual');
  assert.deepEqual(failed.snapshot, original.snapshot);
  assert.equal(failed.error.code, 'NETWORK');
  h.advance(10000);
  await h.restart().sync(ID, 'manual');
  assert.equal(h.counts().reads, 2);
});
test('manual revalidation after apply imports external changes without replaying the preset', async () => {
  const h = fixture();
  await h.service.apply(ID, change(), h.consent(), () => {});
  externalSettings(h, 0.42);
  h.advance(5000);
  const result = await h.service.sync(ID, 'manual');
  assert.equal(result.snapshot.sensitivity.hipfire, 0.42);
  assert.equal(h.counts().writes, 1);
  assert.equal(result.pending, undefined);
});
test('parallel manual pulls issue one new preference request after debounce', async () => {
  const h = fixture();
  await h.service.sync(ID);
  externalSettings(h);
  h.advance(5000);
  const results = await Promise.all(Array.from({ length: 8 }, () => h.service.sync(ID, 'manual')));
  assert.equal(h.counts().reads, 2);
  assert.ok(results.every((r) => r.snapshot.sensitivity.hipfire === 0.61));
});
