const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm'),
  ts = require('typescript');
const React = require('react'),
  Renderer = require('react-test-renderer'),
  { act } = Renderer;
const { ID, OTHER, session, code } = require('./helpers.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;
const compiled = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/state/useActions.ts'), 'utf8'),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  },
).outputText;
const tick = () => new Promise((r) => setImmediate(r));
async function fixture(t) {
  let revision = 1,
    accountId = ID,
    actions,
    dispatches = 0,
    release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const runtime = {
    repository: { snapshot: async () => null },
    confirmPurchase: async (_, id, validate) => {
      await gate;
      validate();
      dispatches++;
      return { id, accountId: ID, state: 'accepted' };
    },
  };
  const m = { exports: {} },
    load = (name) => {
      if (name === 'react') return React;
      if (name.endsWith('/runtime')) return { getRuntime: async () => runtime };
      if (name.endsWith('/secure')) return { randomId: () => OTHER };
      if (name.startsWith('../core/'))
        return require(path.join(__dirname, '../.test-build', name.slice(8) + '.js'));
      throw Error(name);
    };
  vm.runInThisContext('(function(require,module,exports){' + compiled + '\n})')(load, m, m.exports);
  function App() {
    actions = m.exports.useActions(
      session().account,
      { items: {} },
      null,
      () => {},
      () => {},
      () => {},
      () => ({ accountId, revision }),
    );
    return null;
  }
  let renderer;
  await act(async () => {
    renderer = Renderer.create(React.createElement(App));
    await tick();
  });
  t.after(async () => {
    await act(async () => {
      renderer.unmount();
    });
  });
  return {
    actions,
    release,
    select(id) {
      accountId = id;
      revision++;
    },
    get dispatches() {
      return dispatches;
    },
  };
}
test('leaving and returning to the same account invalidates pending purchase consent', async (t) => {
  const h = await fixture(t),
    sending = h.actions.confirmPurchase(OTHER);
  const failed = assert.rejects(sending, code('ACCOUNT_CHANGED'));
  await tick();
  h.select(OTHER);
  h.select(ID);
  h.release();
  await failed;
  assert.equal(h.dispatches, 0);
});
test('account switch is observed before the next React render can happen', async (t) => {
  const h = await fixture(t);
  h.select(OTHER);
  h.release();
  await assert.rejects(h.actions.confirmPurchase(OTHER), code('ACCOUNT_CHANGED'));
  assert.equal(h.dispatches, 0);
});
test('unchanged explicit confirmation reaches the injected dispatcher once', async (t) => {
  const h = await fixture(t);
  const sending = h.actions.confirmPurchase(OTHER);
  h.release();
  assert.equal((await sending).state, 'accepted');
  assert.equal(h.dispatches, 1);
});
