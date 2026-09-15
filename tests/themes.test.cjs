const test = require('node:test');
const assert = require('node:assert/strict');
const { PALETTES, resolveTheme, themePreference } = require('../.test-build/theme.js');
const l = (hex) => {
  const c = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => (Math.max(l(a), l(b)) + 0.05) / (Math.min(l(a), l(b)) + 0.05);
test('theme choice defaults safely and follows system changes', () => {
  assert.equal(themePreference('not-a-theme'), 'navy');
  assert.equal(resolveTheme('system', 'light'), 'light');
  assert.equal(resolveTheme('system', 'dark'), 'dark');
  assert.equal(resolveTheme('navy', 'light'), 'navy');
});
for (const [mode, c] of Object.entries(PALETTES))
  test(`${mode} text and primary button maintain readable contrast`, () => {
    for (const ink of ['ink', 'muted', 'subtle'])
      assert.ok(
        contrast(c[ink], c.surface) >= 4.5,
        `${ink} contrast=${contrast(c[ink], c.surface)}`,
      );
    assert.ok(contrast('#FFFFFF', c.accent) >= 4.5);
  });
