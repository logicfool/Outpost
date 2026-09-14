const fs = require('node:fs');
const path = require('node:path');

const gradle = path.join(
  __dirname,
  '..',
  'node_modules',
  '@react-native-cookies',
  'cookies',
  'android',
  'build.gradle',
);
if (fs.existsSync(gradle)) {
  const source = fs.readFileSync(gradle, 'utf8');
  const patched = source.replace(/\bjcenter\(\)/g, 'mavenCentral()');
  if (patched !== source) {
    fs.writeFileSync(gradle, patched);
    console.log('Patched jcenter() in @react-native-cookies/cookies');
  }
}
