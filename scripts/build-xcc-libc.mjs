import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { zipSync } from 'fflate';
import { execute, put, File, Directory } from '../src/wasi.ts';

const root = path.resolve(process.env.XCC_SOURCE_DIR ?? '.tools/sources/xcc');
const sdk = process.env.WASI_SDK_PATH;
if (!sdk) throw new Error('WASI_SDK_PATH is required');
const compiler = await WebAssembly.compile(fs.readFileSync('.tools/xcc.wasm'));
const files = new Map();
function loadTree(dir, relative = '') {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) loadTree(path.join(dir, entry.name), name);
    else put(files, `xcc/${name}`, fs.readFileSync(path.join(dir, entry.name)));
  }
}
loadTree(path.join(root, 'include'), 'include');
loadTree(path.join(root, 'libsrc'), 'libsrc');
put(files, 'tmp/.keep', new Uint8Array());
put(files, 'obj/.keep', new Uint8Array());
const groups = {
  wcrt0: ['libsrc/_wasm/crt0'],
  wlibc: [
    'libsrc/math',
    'libsrc/misc',
    'libsrc/stdio',
    'libsrc/stdlib',
    'libsrc/string',
    'libsrc/_wasm/unistd',
  ],
};
const archive = { 'usr/bin/cc': fs.readFileSync('.tools/xcc.wasm') };
for (const [library, dirs] of Object.entries(groups)) {
  const objectPaths = [];
  const outDir = path.resolve('.tools/xcc-lib', library);
  fs.mkdirSync(outDir, { recursive: true });
  for (const dir of dirs) {
    for (const name of fs
      .readdirSync(path.join(root, dir))
      .filter((name) => name.endsWith('.c'))
      .sort()) {
      const object = `${dir.replaceAll('/', '_')}_${name.slice(0, -2)}.o`;
      files.set('tmp', new Directory(new Map()));
      const result = await execute(
        compiler,
        [
          'cc',
          '-c',
          '-Wall',
          '-Werror',
          '-I/xcc/include',
          `/xcc/${dir}/${name}`,
          '-o',
          `/obj/${object}`,
        ],
        files,
        (text) => process.stdout.write(text),
      );
      if (result !== 0) throw new Error(`xcc libc build failed: ${dir}/${name} (exit ${result})`);
      const built = files.get('obj').contents.get(object);
      if (!(built instanceof File)) throw new Error(`Missing object ${object}`);
      const objectPath = path.join(outDir, object);
      fs.writeFileSync(objectPath, built.data);
      objectPaths.push(objectPath);
    }
  }
  const archivePath = path.join(outDir, `${library}.a`);
  // Remove an old archive so upstream-deleted members cannot linger in rebuilds.
  fs.rmSync(archivePath, { force: true });
  const response = path.join(outDir, 'objects.rsp');
  fs.writeFileSync(response, objectPaths.map((p) => `"${p.replaceAll('\\', '/')}"`).join('\n'));
  const ar = path.join(sdk, 'bin', process.platform === 'win32' ? 'llvm-ar.exe' : 'llvm-ar');
  const result = spawnSync(ar, ['rcs', archivePath, `@${response}`], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`Archiving ${library} failed`);
  archive[`usr/lib/${library}.a`] = fs.readFileSync(archivePath);
  console.log(`Built ${library}: ${objectPaths.length} objects`);
}
// Follow upstream's browser header manifest, including its include-path rewrite.
const list = JSON.parse(fs.readFileSync(path.join(root, 'src/wcc/www/lib_list.json'), 'utf8'));
function packHeaders(tree, prefix) {
  for (const [name, value] of Object.entries(tree)) {
    if (typeof value === 'object' && !Array.isArray(value)) {
      packHeaders(value, `${prefix}/${name}`);
      continue;
    }
    const inputs = Array.isArray(value) ? value : [value];
    const text = inputs
      .map((file) =>
        fs
          .readFileSync(path.join(root, file), 'utf8')
          .replaceAll('\r\n', '\n')
          .replace(/^(#include\s+)"\..+\/([\w\d\-_.]+)"$/gm, '$1"$2"'),
      )
      .join('\n');
    archive[`${prefix}/${name}`] = new TextEncoder().encode(text);
  }
}
packHeaders(list.usr.include, 'usr/include');
fs.writeFileSync('public/toolchain/wccfiles.zip', zipSync(archive, { level: 9 }));
console.log('Packaged xcc compiler, headers, and source-built libc.');
