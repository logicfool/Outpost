const { spawnSync } = require('node:child_process');
const { existsSync, readdirSync } = require('node:fs');
const { resolve } = require('node:path');
process.chdir(resolve(__dirname, '..'));
const local = resolve('node_modules/typescript/bin/tsc');
const compiler = existsSync(local)
  ? process.execPath
  : process.platform === 'win32'
    ? 'tsc.cmd'
    : 'tsc';
const compiled = spawnSync(
  compiler,
  [...(existsSync(local) ? [local] : []), '-p', 'tsconfig.core.json'],
  { stdio: 'inherit', shell: !existsSync(local) && process.platform === 'win32' },
);
if (compiled.error || compiled.status !== 0) {
  console.error('Core compilation failed. Install TypeScript via setup.');
  process.exit(1);
}
const tests = readdirSync('tests')
  .filter((name) => name.endsWith('.test.cjs'))
  .sort()
  .map((name) => `tests/${name}`);
if (!tests.length) throw new Error('No test files found.');
const result = spawnSync(process.execPath, ['--test', ...tests], { stdio: 'inherit' });
process.exit(result.status ?? 1);
