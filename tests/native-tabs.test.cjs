const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('iOS 26 uses the native bottom tab view while other platforms retain the custom bar', () => {
  const ios = fs.readFileSync('src/ui/NativeTabs.ios.tsx', 'utf8');
  const fallback = fs.readFileSync('src/ui/NativeTabs.tsx', 'utf8');
  const app = fs.readFileSync('App.tsx', 'utf8');
  const config = fs.readFileSync('app.config.ts', 'utf8');
  assert.match(ios, /from 'react-native-bottom-tabs'/);
  assert.match(ios, /nativeGlassAvailable\(\)/);
  assert.match(ios, /UIManager\.getViewManagerConfig\('RNCTabView'\)/);
  assert.match(ios, /!!NativeTabView/);
  assert.match(ios, /selectionTick\(\)/);
  assert.match(ios, /sfSymbol/);
  assert.match(fallback, /return false/);
  assert.match(app, /!nativeTabs/);
  assert.match(config, /'react-native-bottom-tabs'/);
});

test('iOS Settings use native action sheets for Theme and Platform', () => {
  const source = fs.readFileSync('src/ui/screens.tsx', 'utf8');
  assert.match(source, /ActionSheetIOS\.showActionSheetWithOptions/);
  assert.match(source, /title: 'Theme'/);
  assert.match(source, /title: 'Outpost supports PC VALORANT accounts\.'/);
});
