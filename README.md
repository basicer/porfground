# porfground

A browser-only JavaScript → C → WebAssembly playground built with Vite, React,
CodeMirror 6, Dockview, and xterm.js. Both compilers run as WebAssembly locally.
No compilation service, JavaScript `eval`, or mocked compiler output is used.

## Run

Requires Node.js 22.18+ (Node 24 recommended).

```sh
npm ci
npm run toolchain:setup
npm run dev
```

Setup generates the ignored toolchain in `public/toolchain`. Vite prints the local
URL. Edit `main.js` to regenerate the read-only C pane after a 350 ms debounce.
Click **Run** or press **Ctrl+Enter / Cmd+Enter** to compile the current source
through xcc and execute it. The button becomes **Stop** during execution.
The **Build output** tab contains compiler warnings/errors, runtime stderr, and
exit status. The **stdout** tab contains only program stdout and clears for each
run. Run opens stdout; failures open Build output. Both tabs use xterm.js.
Drag the Dockview tabs and splitters to rearrange or resize panes. Small screens
start with a vertical stack. Source text is saved locally when storage is available.

## Build and verify

```sh
npm run build
npm run preview
npx playwright install chromium
npm test
npm run format
npm run format:check
```

The browser tests exercise real compiler binaries: Fibonacci output, live edits,
syntax errors and recovery, persistence, stopping an infinite loop, and mobile
layout. Screenshots and test artifacts are written to the OS temporary directory.

## Rebuild the compilers

```sh
npm run toolchain:setup
```

Every setup run clones the newest default-branch sources of Porffor and xcc into
a fresh ignored `.tools/sources-*` directory. It builds both WASM compilers, then
uses the newly built xcc to compile its own libc and startup objects from source.
No Porffor/xcc sources, binaries, headers, or libc archives are vendored or downloaded
prebuilt. The WASI SDK bootstrap toolchain (about 600 MB on Windows) is downloaded
and reused locally. Setup requires `git`, `curl`, and `tar`. An existing SDK
can be selected with `WASI_SDK_PATH`. Allow several minutes for the
initial bootstrap build. Only Windows x64 has been verified here.

`public/toolchain/manifest.json` records resolved upstream revisions, build time,
and artifact SHA-256 hashes, so each deployment can be traced to its sources.
Compiler MIT licenses are included beside their binaries.

Porffor's upstream native bootstrap needs these adaptations for the browser:

- Normalize Windows paths and line endings in its self-host bundler.
- Decode three large precompiled constant tables with `JSON.parse`, avoiding
  WebAssembly's per-function local-variable limit without changing table values.
- Use WASI exception handling for `setjmp` and an anonymous linear-memory arena
  in place of native virtual-memory reservations.
- Reject native subprocess operations with `ENOSYS`; compilation only emits C.
- Disable inline caches for this compilation target.

xcc's small libc needs the compatibility headers in `src/xcc-compat.ts`.
The C preview shows the actual source passed to xcc: top-level static runtime
helpers receive external linkage to avoid an upstream unused-static-data bug.
Function-local static state is preserved. A few upstream generated-C warnings
are expected, including unreachable code; they remain visible in the terminal.

Each compile starts with fresh WASI process state. Successful C output is cached
for Run. A worker keeps the UI responsive, suppresses output after 256 KiB, and
is terminated after 30 seconds or when Stop is pressed. Executed programs receive
a separate in-memory filesystem and EOF on stdin. A modern browser with WASM
exception handling is required. Native OS APIs, threads, and native coroutine
assembly are outside this browser target; unsupported programs report diagnostics.

## Project structure

- `src/main.tsx`: dock layout, CodeMirror editors, xterm terminal, worker lifecycle.
- `src/compiler.worker.ts`: live Porffor compile, xcc compile, WASM execution.
- `src/wasi.ts`: isolated in-memory WASI processes.
- `src/xcc-compat.ts`: C runtime compatibility and linkage preparation.
- `scripts/setup-toolchain.mjs`: fresh upstream source downloads and WASM bootstrap.
- `scripts/build-xcc-libc.mjs`: compile and package xcc's libc and headers.
- `tests/playground.spec.ts`: real browser integration tests.

Upstream projects: [Porffor](https://github.com/CanadaHonk/porffor) and
[xcc](https://github.com/tyfkda/xcc).

## GitHub Pages

`.github/workflows/pages.yml` builds on pushes to `master` or `main`, or through
Actions → Build and deploy GitHub Pages → Run workflow. Deployment only runs for
the repository's default branch. Set **Settings → Pages → Source → GitHub Actions**
once in the GitHub repository, then push the project.

Each workflow run installs npm dependencies, freshly clones and builds the latest
Porffor and xcc sources (including libc), builds Vite, tests the production site
in Chromium, and publishes `dist` using GitHub's Pages artifact/deployment actions.
Failed builds or tests prevent publication. Compiler artifacts and source
checkouts are never cached or committed; only npm's package download cache is used.
Resolved source revisions and binary hashes are included in the workflow summary.

Pages' configured base path is passed through `VITE_BASE_PATH`, including to the
worker's compiler downloads and production browser tests. This supports project
sites such as `/porfground/`, user sites, and custom-domain sites.

To verify a project-site build locally in PowerShell:

```powershell
$env:VITE_BASE_PATH = '/porfground/'
npm run build
$env:PLAYWRIGHT_PRODUCTION = '1'
npm test
```
