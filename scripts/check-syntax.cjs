const fs = require('node:fs'),
  path = require('node:path'),
  cp = require('node:child_process');
let ts;
try {
  ts = require('typescript');
} catch {
  const global = cp.execSync('npm root -g', { encoding: 'utf8' }).trim();
  ts = require(path.join(global, 'typescript'));
}
const root = path.resolve(__dirname, '..');
function walk(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? walk(path.join(directory, entry.name))
        : [path.join(directory, entry.name)],
    );
}
const files = [
  path.join(root, 'App.tsx'),
  path.join(root, 'app.config.ts'),
  ...walk(path.join(root, 'src')),
].filter((file) => /\.tsx?$/.test(file));
let failed = false;
for (const file of files) {
  const result = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
      isolatedModules: true,
    },
  });
  for (const d of result.diagnostics ?? [])
    if (d.category === ts.DiagnosticCategory.Error) {
      failed = true;
      console.error(
        path.relative(root, file),
        ts.flattenDiagnosticMessageText(d.messageText, '\n'),
      );
    }
}
console.log(
  `Syntax checked ${files.length} TypeScript/TSX files. Native semantic typecheck requires installed SDK dependencies.`,
);
process.exit(failed ? 1 : 0);
