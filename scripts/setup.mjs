import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
if (Number(process.versions.node.split('.')[0]) < 22)
  throw new Error('Install Node.js 22 LTS or newer before setup.');
const bin = (name) => (process.platform === 'win32' ? `${name}.cmd` : name);
function run(name, args) {
  const result = spawnSync(bin(name), args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.error || result.status !== 0) {
    console.error(`Setup stopped at ${name}. Check the output above; no success is being assumed.`);
    process.exit(result.status ?? 1);
  }
}

run('npm', ['install']);
const modules = JSON.parse(readFileSync('native-dependencies.json', 'utf8'));
run('npx', ['expo', 'install', ...modules]);
run('npm', ['install', '--save-dev', '@types/react@~19.2.0']);
run('npx', ['expo', 'install', '--fix']);
run('npm', ['test']);
run('npm', ['run', 'typecheck']);
if (!existsSync('package-lock.json')) throw new Error('Dependency lockfile was not generated.');
console.log('\nSetup complete. Commit package.json and package-lock.json after reviewing changes.');
console.log('Run npm run android, or npm run ios on macOS. Web is demo-only.');
