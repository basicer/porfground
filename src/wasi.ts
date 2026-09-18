import {
  WASI,
  File,
  Directory,
  OpenFile,
  ConsoleStdout,
  PreopenDirectory,
} from '@bjorn3/browser_wasi_shim';
import type { Inode } from '@bjorn3/browser_wasi_shim';
export { File, Directory };
export type Files = Map<string, Inode>;
export function put(files: Files, path: string, data: Uint8Array) {
  const parts = path.split('/').filter(Boolean);
  for (const part of parts.slice(0, -1)) {
    if (!files.has(part)) files.set(part, new Directory(new Map()));
    const dir = files.get(part);
    if (!(dir instanceof Directory)) throw new Error(`Not a directory: ${part}`);
    files = dir.contents;
  }
  files.set(parts.at(-1)!, new File(data));
}
export async function execute(
  module: WebAssembly.Module,
  args: string[],
  files: Files,
  output: (text: string, error: boolean) => void,
) {
  const stdout = new TextDecoder(),
    stderr = new TextDecoder();
  const wasi = new WASI(
    args,
    ['PWD=/', 'HOME=/', 'INCLUDE=/usr/include', 'LIB=/usr/lib', 'NO_COLOR=1'],
    [
      new OpenFile(new File([])),
      new ConsoleStdout((bytes) => output(stdout.decode(bytes, { stream: true }), false)),
      new ConsoleStdout((bytes) => output(stderr.decode(bytes, { stream: true }), true)),
      new PreopenDirectory('/', files),
      new PreopenDirectory('.', files),
    ],
    { debug: false },
  );
  const instance = await WebAssembly.instantiate(module, {
    wasi_snapshot_preview1: wasi.wasiImport,
  });
  const code = wasi.start(instance as unknown as Parameters<WASI['start']>[0]);
  output(stdout.decode(), false);
  output(stderr.decode(), true);
  return code;
}
export async function loadModule(url: string) {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Could not load ${url}: HTTP ${response.status}. Run npm run toolchain:setup.`);
  return WebAssembly.compile(await response.arrayBuffer());
}
