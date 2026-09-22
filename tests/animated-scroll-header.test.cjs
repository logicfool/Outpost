const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = (path) => fs.readFileSync(path, 'utf8');

test('native-driven scroll headers use animated scroll containers', () => {
  const screens = read('src/ui/screens.tsx');
  const collection = read('src/ui/CollectionHub.tsx');
  const friends = read('src/ui/FriendsScreen.tsx');
  const header = read('src/ui/ScrollHeader.tsx');

  assert.match(header, /useNativeDriver: true/);
  assert.equal((screens.match(/<Animated\.ScrollView\s+\{\.\.\.scrollHeader\}/g) ?? []).length, 1);
  assert.equal((screens.match(/<Animated\.FlatList\s+\{\.\.\.scrollHeader\}/g) ?? []).length, 2);
  assert.equal(
    (collection.match(/<Animated\.ScrollView\s+\{\.\.\.scrollHeader\}/g) ?? []).length,
    1,
  );
  assert.equal((friends.match(/<Animated\.SectionList\s+\{\.\.\.scrollHeader\}/g) ?? []).length, 1);

  for (const source of [screens, collection, friends])
    assert.doesNotMatch(
      source,
      /<(?:ScrollView|FlatList|SectionList)\s+\{\.\.\.scrollHeader\}/,
      'A native-driven scroll handler must not be attached to an unwrapped scroll container',
    );
});
