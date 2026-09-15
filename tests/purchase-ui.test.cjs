const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm'),
  ts = require('typescript');
const React = require('react'),
  Renderer = require('react-test-renderer'),
  { act } = Renderer;
const { ID, OTHER } = require('./helpers.cjs'),
  { makeDemo } = require('../.test-build/demo.js'),
  { quotePurchase } = require('../.test-build/purchases.js');
global.IS_REACT_ACT_ENVIRONMENT = true;
const tick = () => new Promise((r) => setImmediate(r));
const js = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/ui/PurchaseControls.tsx'), 'utf8'),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  },
).outputText;
function fixture(options = {}) {
  const data = makeDemo().snapshot,
    item = data.store.data.daily[0].item;
  let calls = 0,
    reviews = 0,
    checks = 0;
  const m = { exports: {} },
    load = (n) =>
      n === 'react' || n === 'react/jsx-runtime'
        ? require(n)
        : n === 'react-native'
          ? { View: 'View', Text: 'Text', Switch: 'Switch' }
          : n === './components'
            ? { Button: (p) => React.createElement('Button', p) }
            : n === './theme'
              ? {
                  useTheme: () => ({
                    C: { gold: '#aa8800' },
                    S: { card: {}, h3: {}, body: {}, small: {}, row: {}, h2: {} },
                  }),
                }
              : n.startsWith('../core/')
                ? require('../.test-build/' + n.slice(8) + '.js')
                : (() => {
                    throw Error(n);
                  })();
  vm.runInThisContext('(function(require,module,exports){' + js + '\n})')(load, m, m.exports);
  const record = {
    id: OTHER,
    accountId: ID,
    offerId: data.store.data.daily[0].id,
    itemId: item.id,
    name: item.name,
    price: 1775,
    at: Date.now(),
    state: 'failed',
    errorCode: 'PURCHASE_ENDPOINT',
    httpStatus: 404,
    message: 'Riot rejected this route.',
  };
  const model = {
    active: { puuid: ID, gameName: 'Fixture', tagLine: 'TEST' },
    settings: { allowPurchases: true },
    snapshot: data,
    purchaseQuote: async () => {
      reviews++;
      return quotePurchase(data.store.data, data.wallet.data, item.id, ID, OTHER);
    },
    confirmPurchase: async () => {
      calls++;
      if (options.error) throw options.error;
      return options.result ?? record;
    },
    checkPurchase: async () => {
      checks++;
      return {
        ...record,
        state: 'complete',
        ownershipVerified: true,
        message: 'Ownership confirmed.',
      };
    },
  };
  let renderer;
  const button = (title) =>
    renderer.root.findAllByType('Button').find((b) => b.props.title === title);
  return {
    model,
    get calls() {
      return calls;
    },
    get reviews() {
      return reviews;
    },
    get checks() {
      return checks;
    },
    button,
    root: () => renderer.root,
    async mount() {
      await act(async () => {
        renderer = Renderer.create(
          React.createElement(m.exports.PurchaseControls, { model, item }),
        );
        await tick();
      });
    },
    async press(title) {
      await act(async () => {
        const b = button(title);
        assert.ok(b, 'Missing ' + title);
        if (!b.props.disabled) b.props.onPress();
        await tick();
      });
    },
    async accept() {
      await act(async () => {
        renderer.root.findByType('Switch').props.onValueChange(true);
        await tick();
      });
    },
    async close() {
      await act(async () => {
        renderer.unmount();
        await tick();
      });
    },
  };
}
test('reviewing and cancelling never sends a purchase', async (t) => {
  const h = fixture();
  await h.mount();
  t.after(() => h.close());
  await h.press('Review VP purchase');
  assert.equal(h.calls, 0);
  assert.equal(h.button('Confirm spend 1775 VP').props.disabled, true);
  await h.press('Cancel purchase');
  assert.equal(h.calls, 0);
  assert.ok(h.button('Review VP purchase'));
});
test('a rejected checkout shows diagnostic codes and a fresh-review route', async (t) => {
  const h = fixture();
  await h.mount();
  t.after(() => h.close());
  await h.press('Review VP purchase');
  await h.accept();
  await h.press('Confirm spend 1775 VP');
  assert.equal(h.calls, 1);
  assert.ok(h.button('Review a new purchase'));
  const text = JSON.stringify(
    h
      .root()
      .findAllByType('Text')
      .map((n) => n.props.children),
  );
  assert.match(text, /PURCHASE_ENDPOINT/);
  await h.press('Review a new purchase');
  assert.equal(h.reviews, 2);
  assert.equal(h.calls, 1);
});
test('a consumed confirmation error is not left behind as a reusable buy button', async (t) => {
  const { AppError } = require('../.test-build/validation.js'),
    h = fixture({ error: new AppError('PURCHASE_CHANGED', 'Price changed') });
  await h.mount();
  t.after(() => h.close());
  await h.press('Review VP purchase');
  await h.accept();
  await h.press('Confirm spend 1775 VP');
  assert.equal(h.calls, 1);
  assert.equal(h.button('Confirm spend 1775 VP'), undefined);
  assert.ok(h.button('Review VP purchase'));
});
test('an uncertain result offers read-only checking rather than another purchase', async (t) => {
  const h = fixture({
    result: {
      id: OTHER,
      accountId: ID,
      state: 'unknown',
      price: 1775,
      name: 'Fixture',
      message: 'Unconfirmed',
    },
  });
  await h.mount();
  t.after(() => h.close());
  await h.press('Review VP purchase');
  await h.accept();
  await h.press('Confirm spend 1775 VP');
  assert.equal(h.button('Review VP purchase'), undefined);
  await h.press('Check purchase outcome');
  assert.equal(h.calls, 1);
  assert.equal(h.checks, 1);
});
