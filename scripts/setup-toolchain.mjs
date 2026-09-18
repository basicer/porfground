import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0)
    throw new Error(`${command} failed (${result.status}): ${result.error ?? ''}`);
};
for (const dir of ['.tools', 'public/toolchain']) fs.mkdirSync(dir, { recursive: true });
// Every build gets fresh upstream default-branch sources. Only the SDK is reused.
const sources = fs.mkdtempSync(path.resolve('.tools/sources-'));
const revisions = {};
const download = (url, dest) => {
  if (!fs.existsSync(dest) || fs.statSync(dest).size === 0)
    run('curl', ['-fL', '--retry', '3', '--max-time', '300', url, '-o', dest]);
};
for (const [name, repo] of [
  ['porffor', 'CanadaHonk/porffor'],
  ['xcc', 'tyfkda/xcc'],
]) {
  const dir = path.join(sources, name);
  run('git', ['clone', '--depth', '1', `https://github.com/${repo}.git`, dir]);
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Could not resolve ${name} revision`);
  revisions[name] = result.stdout.trim();
  console.log(`${name}: ${revisions[name]}`);
}
const porffor = path.join(sources, 'porffor');
const platforms = { win32: 'windows', linux: 'linux', darwin: 'macos' };
const platform = platforms[process.platform],
  arch = process.arch === 'arm64' ? 'arm64' : 'x86_64';
if (!platform) throw new Error(`Unsupported build host ${process.platform}.`);
const sdk = process.env.WASI_SDK_PATH ?? path.resolve(`.tools/wasi-sdk-34.0-${arch}-${platform}`);
const clang = path.join(sdk, 'bin', process.platform === 'win32' ? 'clang.exe' : 'clang');
if (!fs.existsSync(clang)) {
  const tarball = '.tools/wasi-sdk.tar.gz';
  download(
    `https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-34/wasi-sdk-34.0-${arch}-${platform}.tar.gz`,
    tarball,
  );
  run('tar', ['-xzf', tarball, '-C', '.tools']);
}
// Normalize Windows paths and CRLF for the upstream POSIX-oriented bundler.
const buildPath = path.join(porffor, 'selfhosted/build.mjs');
let build = fs.readFileSync(buildPath, 'utf8').replaceAll('\r\n', '\n');
build = build
  .replace(
    "path.resolve(new URL('../', import.meta.url).pathname)",
    "path.resolve(import.meta.dirname, '..').replaceAll('\\\\', '/')",
  )
  .replace('path.normalize(file);', "path.normalize(file).replaceAll('\\\\', '/');")
  .replace(
    "fs.readFileSync(file, 'utf8').replace(/^#!",
    "fs.readFileSync(file, 'utf8').replaceAll('\\r\\n', '\\n').replace(/^#!",
  );
fs.writeFileSync(buildPath, build);
// Decode large constant tables at runtime rather than unrolling thousands of
// literals into the bootstrap entry point (which exceeds browser local limits).
const builtinsPath = path.join(porffor, 'compiler/builtins_precompiled.js');
const builtins = fs.readFileSync(builtinsPath, 'utf8').replaceAll('\r\n', '\n');
fs.writeFileSync(
  builtinsPath,
  builtins.replace(/^const (strings|huffTree|huffTokens) = (\[.*\]);$/gm, (_, name, array) => {
    JSON.parse(array);
    return `const ${name} = JSON.parse(${JSON.stringify(array)});`;
  }),
);
run(process.execPath, [buildPath]);
run(process.execPath, [
  path.join(porffor, 'runtime/index.js'),
  'c',
  '--compress-data',
  '--no-ic',
  path.join(porffor, 'selfhosted/bundle.js'),
  '-o',
  path.join(porffor, 'selfhosted/stage1.c'),
]);
console.log('Building Porffor WASM (this may take several minutes)…');
run(clang, [
  '-c',
  path.join(porffor, 'selfhosted/stage1.c'),
  '-o',
  '.tools/porffor.o',
  '-O1',
  '-mllvm',
  '-wasm-enable-sjlj',
  '-D_WASI_EMULATED_MMAN',
  '-D_WASI_EMULATED_SIGNAL',
  '-Wno-pointer-sign',
  '-include',
  'scripts/wasi-compat.h',
]);
run(clang, [
  '.tools/porffor.o',
  'scripts/wasi-memory.c',
  '-o',
  '.tools/porffor.wasm',
  '-lsetjmp',
  '-lm',
  '-lwasi-emulated-signal',
  '-Wl,-z,stack-size=16777216',
]);
fs.copyFileSync('.tools/porffor.wasm', 'public/toolchain/porffor.wasm');
const buildEnv = { ...process.env, WASI_SDK_PATH: sdk, XCC_SOURCE_DIR: path.join(sources, 'xcc') };
run(process.execPath, ['scripts/build-xcc.mjs'], { env: buildEnv });
run(process.execPath, ['scripts/build-xcc-libc.mjs'], { env: buildEnv });
for (const name of ['porffor', 'xcc'])
  fs.copyFileSync(path.join(sources, name, 'LICENSE'), `public/toolchain/${name}-LICENSE`);
const sha256 = (file) =>
  createHash('sha256')
    .update(fs.readFileSync(`public/toolchain/${file}`))
    .digest('hex');
fs.writeFileSync(
  'public/toolchain/manifest.json',
  JSON.stringify(
    {
      ...revisions,
      wasiSdk: '34.0',
      builtAt: new Date().toISOString(),
      files: { 'porffor.wasm': sha256('porffor.wasm'), 'wccfiles.zip': sha256('wccfiles.zip') },
    },
    null,
    2,
  ) + '\n',
);
console.log('Toolchain ready. Run npm run dev.');
