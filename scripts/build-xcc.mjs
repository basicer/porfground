import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const root = path.resolve(process.env.XCC_SOURCE_DIR ?? '.tools/sources/xcc');
const dirs = ['src/wcc', 'src/cc/frontend'];
const sources = dirs.flatMap((dir) =>
  fs
    .readdirSync(path.join(root, dir))
    .filter((x) => x.endsWith('.c'))
    .map((x) => `${dir}/${x}`),
);
sources.push(
  'src/util/archive.c',
  'src/cpp/preprocessor.c',
  'src/cpp/pp_parser.c',
  'src/cpp/macro.c',
  'src/util/util.c',
  'src/util/table.c',
);
const sdk = process.env.WASI_SDK_PATH ?? path.resolve('.tools/wasi-sdk-34.0-x86_64-windows');
const clang = path.join(sdk, 'bin', process.platform === 'win32' ? 'clang.exe' : 'clang');
const result = spawnSync(
  clang,
  [
    ...sources,
    '-o',
    path.resolve('.tools/xcc.wasm'),
    '-O1',
    '-lc-printscan-long-double',
    '-D__wasm',
    '-DXCC_TARGET_ARCH=XCC_ARCH_WASM',
    '-Isrc/util',
    '-Isrc/cpp',
    '-Isrc/cc/frontend',
    '-include',
    path.resolve('scripts/xcc-host.h'),
    '-Wl,-z,stack-size=8388608',
  ],
  { cwd: root, stdio: 'inherit' },
);
process.exit(result.status ?? 1);
