const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os');
const yaml = require('js-yaml');
const { result, validate, main } = require('../.github/actions/upload-release-artifact/report.cjs');
const root = path.resolve(__dirname, '..');
const env = () => ({
  ARTIFACT_PREFIX: 'outpost-android',
  RETENTION_DAYS: '30',
  GITHUB_RUN_ID: '100',
  GITHUB_RUN_ATTEMPT: '2',
  GITHUB_REPOSITORY: 'logicfool/Outpost',
  GITHUB_SERVER_URL: 'https://github.com',
  OUTCOME_1: 'failure',
  OUTCOME_2: 'failure',
  OUTCOME_3: 'failure',
});
const success = (e, n) =>
  Object.assign(e, {
    ['OUTCOME_' + n]: 'success',
    ['ID_' + n]: '500',
    ['URL_' + n]: 'https://github.com/logicfool/Outpost/actions/runs/100/artifacts/500',
  });
for (const attempt of [1, 2, 3])
  test('release upload reports only finalized success on attempt ' + attempt, () => {
    const e = success(env(), attempt),
      r = result(e);
    assert.equal(r.attempt, attempt);
    assert.equal(r.id, '500');
    assert.equal(r.name, 'outpost-android-100-2-try' + attempt);
  });
test('persistent upload failure cannot turn a release job green', () => {
  assert.throws(() => result(env()), /three upload attempts/);
  const e = env();
  e.ID_1 = '500';
  e.URL_1 = 'https://github.com/logicfool/Outpost/actions/runs/100/artifacts/500';
  assert.throws(() => result(e), /three upload attempts/);
});
test('invalid names, retention and forged artifact destinations fail before output', () => {
  for (const prefix of ['../secret', 'x\ny', '$(echo unsafe)', '', 'x'.repeat(90)])
    assert.throws(() => validate({ ...env(), ARTIFACT_PREFIX: prefix }));
  for (const days of ['0', '91', 'NaN', '-1'])
    assert.throws(() => validate({ ...env(), RETENTION_DAYS: days }));
  for (const url of [
    'http://github.com/logicfool/Outpost/actions/runs/100/artifacts/500',
    'https://evil.test/500',
    'https://github.com/another/project/actions/runs/100/artifacts/500',
    'https://github.com/logicfool/Outpost/actions/runs/100/artifacts/500?token=private',
  ]) {
    const e = success(env(), 2);
    e.URL_2 = url;
    assert.throws(() => result(e));
  }
});
test('successful artifact links are written to job outputs and the run summary', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'outpost-upload-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const e = success(env(), 2);
  e.GITHUB_OUTPUT = path.join(dir, 'output');
  e.GITHUB_STEP_SUMMARY = path.join(dir, 'summary');
  main(e, 'report');
  assert.match(fs.readFileSync(e.GITHUB_OUTPUT, 'utf8'), /artifact-url=https:\/\/github.com/);
  assert.match(fs.readFileSync(e.GITHUB_STEP_SUMMARY, 'utf8'), /attempt 2/);
});
test('composite action retries the uploader at most three times with independent attempt names', () => {
  const action = yaml.load(
    fs.readFileSync(path.join(root, '.github/actions/upload-release-artifact/action.yml'), 'utf8'),
  );
  const uploads = action.runs.steps.filter((s) => s.uses?.startsWith('actions/upload-artifact@'));
  assert.equal(uploads.length, 3);
  for (const [index, step] of uploads.entries()) {
    assert.equal(step.uses, 'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a');
    assert.equal(step['continue-on-error'], true);
    assert.equal(step.with['if-no-files-found'], 'error');
    assert.equal(step.with['compression-level'], 6);
    assert.equal(step.with['include-hidden-files'], false);
    assert.ok(step.with.name.endsWith('try' + (index + 1)));
    if (index)
      assert.ok(
        step.if.includes(`steps.upload_${index}.outcome == 'failure'`) &&
          step.if.includes('!cancelled()'),
      );
  }
  assert.deepEqual(
    action.runs.steps.filter((s) => s.run?.startsWith('sleep ')).map((s) => s.run),
    ['sleep 15', 'sleep 30'],
  );
  const last = action.runs.steps.at(-1);
  assert.equal(last.id, 'result');
  assert.equal(last['continue-on-error'], undefined);
  assert.ok(last.run.includes('report.cjs'));
});
test('release workflow retains real native compilation, signer validation and read-only repository permissions', () => {
  const file = fs.readFileSync(path.join(root, '.github/workflows/release-builds.yml'), 'utf8'),
    workflow = yaml.load(file);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.ok(file.includes('./gradlew assembleRelease --no-daemon'));
  assert.ok(file.includes('apksigner" verify --print-certs'));
  assert.ok(file.includes('fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c'));
  const android = workflow.jobs.android.steps,
    upload = android.find((s) => s.uses === './.github/actions/upload-release-artifact');
  assert.ok(upload);
  assert.ok(
    upload.with.path
      .split('\n')
      .filter(Boolean)
      .every((p) => p.startsWith('dist-release/')),
  );
  assert.ok(android.findIndex((s) => s.name === 'Verify the APK') < android.indexOf(upload));
  assert.ok(!file.includes('ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION'));
  assert.ok(!file.includes('actions/upload-artifact@v4'));
  for (const job of Object.values(workflow.jobs))
    for (const step of job.steps)
      if (step.uses?.startsWith('actions/')) assert.match(step.uses, /@[0-9a-f]{40}$/);
});
test('failed delivery leaves a useful summary but no download output', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'outpost-upload-fail-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const e = env();
  e.GITHUB_OUTPUT = path.join(dir, 'output');
  e.GITHUB_STEP_SUMMARY = path.join(dir, 'summary');
  assert.throws(() => main(e, 'report'), /three upload attempts/);
  assert.equal(fs.existsSync(e.GITHUB_OUTPUT), false);
  assert.match(fs.readFileSync(e.GITHUB_STEP_SUMMARY, 'utf8'), /delivery failed/);
});
function simulateUpload(t, failures, cancelAfterFirst = false) {
  const action = yaml.load(
    fs.readFileSync(path.join(root, '.github/actions/upload-release-artifact/action.yml'), 'utf8'),
  );
  const e = env(),
    trace = { uploads: [], waits: [], reported: false },
    steps = {};
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'outpost-upload-simulation-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  e.GITHUB_OUTPUT = path.join(dir, 'output');
  e.GITHUB_STEP_SUMMARY = path.join(dir, 'summary');
  const values = {
    inputs: { name: e.ARTIFACT_PREFIX, path: 'dist-release/*.apk', 'retention-days': '30' },
    github: { run_id: e.GITHUB_RUN_ID, run_attempt: e.GITHUB_RUN_ATTEMPT },
    steps,
  };
  const expand = (s) =>
    String(s).replace(
      /\$\{\{\s*(.*?)\s*\}\}/g,
      (_, key) => key.split('.').reduce((v, k) => v?.[k], values) ?? '',
    );
  for (const step of action.runs.steps) {
    if (step.if) {
      if (cancelAfterFirst && trace.uploads.length) continue;
      const previous = /steps\.(upload_\d+)\.outcome == 'failure'/.exec(step.if);
      if (previous && steps[previous[1]]?.outcome !== 'failure') continue;
    }
    if (step.uses) {
      const n = trace.uploads.length + 1,
        failed = n <= failures;
      trace.uploads.push(expand(step.with.name));
      steps[step.id] = {
        outcome: failed ? 'failure' : 'success',
        outputs: failed
          ? {}
          : {
              'artifact-id': String(500 + n),
              'artifact-url': `https://github.com/logicfool/Outpost/actions/runs/100/artifacts/${500 + n}`,
            },
      };
    } else if (step.run.startsWith('sleep ')) trace.waits.push(Number(step.run.split(' ')[1]));
    else if (step.id === 'result') {
      for (const [key, value] of Object.entries(step.env)) e[key] = expand(value);
      trace.reported = true;
      try {
        main(e, 'report');
        trace.result = result(e);
      } catch (error) {
        trace.error = error.message;
      }
    } else if (step.run.includes('validate')) validate(e);
    else throw Error('Unexpected composite step ' + step.id);
  }
  return trace;
}
for (const failures of [0, 1, 2])
  test(
    'actual composite control flow recovers from ' + failures + ' synthetic upload failures',
    (t) => {
      const trace = simulateUpload(t, failures);
      assert.equal(trace.uploads.length, failures + 1);
      assert.equal(new Set(trace.uploads).size, trace.uploads.length);
      assert.deepEqual(trace.waits, [15, 30].slice(0, failures));
      assert.equal(trace.error, undefined);
      assert.equal(trace.result.attempt, failures + 1);
    },
  );
test('three finalization failures exhaust recovery and do not claim delivery', (t) => {
  const trace = simulateUpload(t, 3);
  assert.equal(trace.uploads.length, 3);
  assert.deepEqual(trace.waits, [15, 30]);
  assert.match(trace.error, /three upload attempts/);
  assert.equal(trace.result, undefined);
});
test('cancelled artifact runs do not wait, retry or report a download', (t) => {
  const trace = simulateUpload(t, 1, true);
  assert.equal(trace.uploads.length, 1);
  assert.deepEqual(trace.waits, []);
  assert.equal(trace.reported, false);
});
