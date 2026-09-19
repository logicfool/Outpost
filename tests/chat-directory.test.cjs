const test = require('node:test'),
  assert = require('node:assert/strict');
const { ChatDirectoryMemory } = require('../.test-build/chatDirectory.js');
test('returning to the same directory route retains filter, search and scroll offset', () => {
  const memory = new ChatDirectoryMemory(),
    route = { type: 'friends' },
    view = memory.forRoute('a', route);
  Object.assign(view, { filter: 'online', query: 'Lumen', offset: 240 });
  assert.equal(memory.forRoute('a', route), view);
  assert.deepEqual(memory.forRoute('a', route), { filter: 'online', query: 'Lumen', offset: 240 });
});
test('new directories begin at Recent and account changes cannot restore another account search', () => {
  const memory = new ChatDirectoryMemory(),
    route = {};
  memory.forRoute('a', route).query = 'Private name';
  assert.equal(memory.forRoute('a', {}).query, '');
  assert.equal(memory.forRoute('b', route).query, '');
  assert.equal(memory.forRoute('a', route).query, '');
});
const React = require('react'),
  Renderer = require('react-test-renderer'),
  { act } = Renderer;
const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm'),
  ts = require('typescript');
global.IS_REACT_ACT_ENVIRONMENT = true;
for (const platform of ['android', 'ios'])
  test(
    platform + ': the chat directory remounts with its saved view instead of resetting to Recent',
    async () => {
      const m = { exports: {} },
        source = ts.transpileModule(
          fs.readFileSync(path.join(__dirname, '../src/ui/ChatsPanel.tsx'), 'utf8'),
          {
            compilerOptions: {
              module: ts.ModuleKind.CommonJS,
              target: ts.ScriptTarget.ES2022,
              jsx: ts.JsxEmit.ReactJSX,
            },
          },
        ).outputText;
      const load = (name) => {
        if (name === 'react') return React;
        if (name === 'react/jsx-runtime') return require(name);
        if (name === 'react-native')
          return {
            Platform: { OS: platform },
            FlatList: React.forwardRef((props, ref) => {
              React.useImperativeHandle(ref, () => ({ scrollToOffset() {} }));
              return React.createElement('List', props, props.ListHeaderComponent);
            }),
            Pressable: 'Pressable',
            Text: 'Text',
            TextInput: 'TextInput',
            View: 'View',
          };
        if (name === '@expo/vector-icons') return { Feather: 'Icon' };
        if (name === './ChatConnectionNotice') return { ChatConnectionNotice: 'ConnectionNotice' };
        if (name === './theme')
          return { useTheme: () => ({ C: {}, S: { content: {}, body: {}, small: {} } }) };
        if (name === './components')
          return {
            Button: 'Button',
            Empty: 'Empty',
            ModalHeader: 'Header',
            ModalPage: 'Page',
            Tabs: 'Tabs',
          };
        if (name === './PlayerAvatar') return { PlayerAvatar: 'Avatar' };
        if (name === './Skeleton') return { Skeleton: 'Skeleton' };
        if (name.startsWith('../core/'))
          return require(path.join(__dirname, '../.test-build', name.slice(8) + '.js'));
        throw Error(name);
      };
      vm.runInThisContext('(function(require,module,exports){' + source + '\n})')(
        load,
        m,
        m.exports,
      );
      const view = { filter: 'recent', query: '', offset: 0 },
        model = {
          chat: { status: 'ready', friends: [], messages: {}, unread: {} },
          savedConversations: [],
          catalog: {},
          historyLoading: false,
        };
      let tree;
      const mount = () =>
        Renderer.create(
          React.createElement(m.exports.ChatsPanel, { model, view, onBack() {}, onNavigate() {} }),
        );
      await act(async () => {
        tree = mount();
      });
      for (const filter of ['online', 'all']) {
        await act(async () => {
          tree.root.findByType('Tabs').props.onChange(filter);
        });
        await act(async () => {
          tree.root.findByType('TextInput').props.onChangeText('Lumen');
          tree.root
            .findByType('List')
            .props.onScroll({ nativeEvent: { contentOffset: { y: 144 } } });
        });
        await act(async () => tree.unmount());
        await act(async () => {
          tree = mount();
        });
        assert.equal(tree.root.findByType('Tabs').props.value, filter);
        assert.equal(tree.root.findByType('TextInput').props.value, 'Lumen');
        assert.equal(tree.root.findByType('List').props.contentOffset.y, 144);
      }
      await act(async () => tree.unmount());
    },
  );
