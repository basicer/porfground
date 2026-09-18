import { unzipSync } from 'fflate';
import { addXccCompatibility, prepareC } from './xcc-compat';
import { execute, put, File, Directory, loadModule, type Files } from './wasi';
const send = (data: unknown) => self.postMessage(data);
const encoder = new TextEncoder(),
  decoder = new TextDecoder();
let porffor: WebAssembly.Module, xcc: WebAssembly.Module, archive: Record<string, Uint8Array>;
let cachedSource: string | undefined, cachedC: string | undefined;
async function initialize() {
  const [module, response] = await Promise.all([
    loadModule(`${import.meta.env.BASE_URL}toolchain/porffor.wasm`),
    fetch(`${import.meta.env.BASE_URL}toolchain/wccfiles.zip`),
  ]);
  if (!response.ok) throw new Error('xcc toolchain missing. Run npm run toolchain:setup.');
  porffor = module;
  archive = unzipSync(new Uint8Array(await response.arrayBuffer()));
  if (!archive['usr/bin/cc']) throw new Error('xcc archive contains no compiler.');
  xcc = await WebAssembly.compile(archive['usr/bin/cc'] as Uint8Array<ArrayBuffer>);
  send({ type: 'ready' });
}
self.onmessage = async ({ data }) => {
  const { source, revision, run } = data;
  let outputBytes = 0;
  const output = (text: string, error: boolean, channel: 'build' | 'stdout' = 'build') => {
    if (!text || outputBytes > 262144) return;
    outputBytes += text.length;
    send({
      type: 'output',
      text: outputBytes > 262144 ? '\n[Output limit reached; further output suppressed.]\n' : text,
      error,
      channel,
      revision,
      running: run,
    });
  };
  try {
    let c = cachedSource === source ? cachedC : undefined;
    if (c === undefined) {
      const files: Files = new Map();
      put(files, 'main.js', encoder.encode(source));
      put(files, 'tmp/.keep', new Uint8Array());
      const exit = await execute(
        porffor,
        ['porf', 'c', 'main.js', '-o', 'output.c', '--no-ic', '--quiet'],
        files,
        output,
      );
      const result = files.get('output.c');
      if (exit !== 0 || !(result instanceof File))
        throw new Error(`Porffor compilation failed (exit ${exit}).`);
      c = prepareC(decoder.decode(result.data));
      cachedSource = source;
      cachedC = c;
    }
    send({ type: 'c', c, revision });
    if (run) {
      send({ type: 'status', text: 'Compiling C with xcc…' });
      const files: Files = new Map();
      for (const [name, bytes] of Object.entries(archive))
        if (!name.endsWith('/')) put(files, name, bytes);
      addXccCompatibility(files);
      put(files, 'tmp/.keep', new Uint8Array());
      put(files, 'output.c', encoder.encode(c));
      const exit = await execute(
        xcc,
        ['cc', '-D__wasi__', '-I/usr/include', '-L/usr/lib', 'output.c', '-o', 'output.wasm'],
        files,
        output,
      );
      if (exit !== 0) throw new Error(`xcc compilation failed (exit ${exit}).`);
      const binary = files.get('output.wasm');
      if (!(binary instanceof File)) throw new Error('xcc produced no WebAssembly binary.');
      send({ type: 'status', text: 'Running WebAssembly…' });
      const module = await WebAssembly.compile(binary.data as Uint8Array<ArrayBuffer>);
      const start = performance.now();
      const exitCode = await execute(
        module,
        ['output.wasm'],
        new Map([['tmp', new Directory(new Map())]]),
        (text, error) => output(text, error, error ? 'build' : 'stdout'),
      );
      output(
        `\n\x1b[90mProcess exited with code ${exitCode} · ${(performance.now() - start).toFixed(0)} ms\x1b[0m\n`,
        false,
      );
      send({ type: 'done', ok: exitCode === 0, revision });
    } else send({ type: 'done', ok: true, revision });
  } catch (error) {
    if (cachedSource !== source)
      send({ type: 'c', c: '// Compilation failed. See the terminal for diagnostics.', revision });
    output(`${error instanceof Error ? error.message : String(error)}\n`, true);
    send({ type: 'done', ok: false, revision });
  }
};
initialize().catch((error) => send({ type: 'fatal', message: String(error) }));
