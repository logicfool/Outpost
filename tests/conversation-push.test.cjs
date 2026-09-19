const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm'),
  ts = require('typescript');
const React = require('react'),
  Renderer = require('react-test-renderer'),
  { act } = Renderer;
global.IS_REACT_ACT_ENVIRONMENT = true;
const { ID } = require('./helpers.cjs');
for (const platform of ['android', 'ios'])
  test(
    platform +
      ': an opened conversation imports once and then receives push without a history-poll timer',
    async (t) => {
      t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
      let requests = 0,
        tree,
        change;
      const model = {
        settings: { autoChatHistory: true },
        chat: { status: 'ready', friends: [{ subject: ID }] },
        autoSyncChatHistory: async () => {
          requests++;
        },
      };
      const native = {
        Platform: { OS: platform },
        AppState: {
          currentState: 'active',
          addEventListener: (_, fn) => {
            change = fn;
            return { remove() {} };
          },
        },
      };
      const code = ts.transpileModule(
          fs.readFileSync(path.join(__dirname, '../src/state/useConversationSync.ts'), 'utf8'),
          { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
        ).outputText,
        m = { exports: {} };
      const load = (n) =>
        n === 'react'
          ? React
          : n === 'react-native'
            ? native
            : (() => {
                throw Error(n);
              })();
      vm.runInThisContext('(function(require,module,exports){' + code + '\n})')(load, m, m.exports);
      function Probe({ value }) {
        m.exports.useConversationSync(value, ID);
        return null;
      }
      await act(async () => {
        tree = Renderer.create(React.createElement(Probe, { value: model }));
      });
      assert.equal(requests, 1);
      await act(async () => {
        t.mock.timers.tick(10 * 60000);
      });
      assert.equal(requests, 1);
      await act(async () => {
        tree.update(
          React.createElement(Probe, {
            value: { ...model, chat: { ...model.chat, status: 'error' } },
          }),
        );
      });
      await act(async () => {
        tree.update(React.createElement(Probe, { value: model }));
      });
      assert.equal(requests, 2);
      await act(async () => tree.unmount());
    },
  );
