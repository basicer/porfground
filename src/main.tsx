import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState } from 'react';
import {
  DockviewReact,
  themeDark,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
  type DockviewApi,
} from 'dockview';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { cpp } from '@codemirror/lang-cpp';
import { oneDark } from '@codemirror/theme-one-dark';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import 'dockview/dist/styles/dockview.css';
import '@xterm/xterm/css/xterm.css';
import '@fontsource-variable/jetbrains-mono';
import './style.css';

const initialSource = `function fib(n) {
  if (n <= 1) return n;
  return fib(n - 1) + fib(n - 2);
}

const n = 10;

function test() {
  const val = fib(n);
  Porffor.c\`printf("fibonacci %.15g = %.15g\\n", n.val, val.val);\`;
}
test();

// Print a short sequence.
let sequence = [];
for (let i = 0; i <= n; i++) {
  sequence.push(fib(i));
}
console.log(sequence.join(' '));`;
const editorTheme = EditorView.theme({
  '&': { height: '100%', backgroundColor: '#10141e', fontSize: '14px' },
  '.cm-scroller': {
    fontFamily: '"JetBrains Mono Variable", Consolas, monospace',
    lineHeight: '1.75',
  },
  '.cm-content': { padding: '16px 0' },
  '.cm-gutters': { backgroundColor: '#10141e', color: '#626d84', border: 'none' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 18px 0 16px' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: '#171c2a' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor': { borderLeftColor: '#c4b5fd' },
});

type OutputChannel = 'build' | 'stdout';
type Model = {
  source: string;
  c: string;
  edit?: EditorView;
  preview?: EditorView;
  terminals: Partial<Record<OutputChannel, Terminal>>;
  logs: Record<OutputChannel, string[]>;
  change: (s: string) => void;
};
function CodePanel({ params }: IDockviewPanelProps<{ model: Model; kind: 'source' | 'c' }>) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const { model, kind } = params;
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: kind === 'source' ? model.source : model.c,
        extensions: [
          basicSetup,
          kind === 'source' ? javascript() : cpp(),
          oneDark,
          editorTheme,
          EditorView.contentAttributes.of({
            'aria-label': kind === 'source' ? 'JavaScript source' : 'Generated C code',
          }),
          ...(kind === 'c'
            ? [EditorState.readOnly.of(true), EditorView.editable.of(false)]
            : [
                EditorView.updateListener.of((update) => {
                  if (update.docChanged) model.change(update.state.doc.toString());
                }),
              ]),
        ],
      }),
    });
    if (kind === 'source') model.edit = view;
    else model.preview = view;
    return () => {
      view.destroy();
      if (kind === 'source') model.edit = undefined;
      else model.preview = undefined;
    };
  }, [params]);
  return <div ref={host} className="editor-host" />;
}
function TerminalPanel({ params }: IDockviewPanelProps<{ model: Model; channel: OutputChannel }>) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const term = new Terminal({
      convertEol: true,
      screenReaderMode: true,
      fontFamily: '"JetBrains Mono Variable", Consolas, monospace',
      fontSize: 14,
      lineHeight: 1.5,
      cursorBlink: false,
      disableStdin: true,
      scrollback: 5000,
      theme: {
        background: '#0b0e15',
        foreground: '#d2d9e9',
        cursor: '#bca5ff',
        red: '#f38ba8',
        green: '#a6da95',
        yellow: '#eed49f',
        brightBlack: '#7f8aa1',
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current!);
    params.model.terminals[params.channel] = term;
    for (const line of params.model.logs[params.channel]) term.write(line);
    const observer = new ResizeObserver(() => {
      if (host.current?.clientWidth) fit.fit();
    });
    observer.observe(host.current!);
    let alive = true;
    void document.fonts.ready.then(() => {
      if (alive) {
        fit.fit();
        term.refresh(0, term.rows - 1);
      }
    });
    return () => {
      alive = false;
      observer.disconnect();
      params.model.terminals[params.channel] = undefined;
      term.dispose();
    };
  }, [params]);
  return (
    <div
      ref={host}
      className="terminal-host"
      aria-label={params.channel === 'build' ? 'Build and compiler output' : 'Program stdout'}
    />
  );
}
const components = { code: CodePanel, terminal: TerminalPanel };

function App() {
  const [status, setStatus] = useState('Loading compiler…');
  const [running, setRunning] = useState(false);
  const action = useRef<() => void>(() => {});
  const dock = useRef<DockviewApi | null>(null);
  const model = useRef<Model | null>(null);
  if (!model.current) {
    let source = initialSource;
    try {
      source = localStorage.getItem('porfground.source.v1') ?? source;
    } catch {
      /* Storage may be disabled. */
    }
    model.current = {
      source,
      c: '// Loading Porffor WebAssembly compiler…',
      terminals: {},
      logs: { build: [], stdout: [] },
      change: () => {},
    };
  }
  useEffect(() => {
    const m = model.current!;
    let worker: Worker,
      timer: ReturnType<typeof setTimeout>,
      watchdog: ReturnType<typeof setTimeout>;
    let revision = 0,
      ready = false,
      busy = false,
      runRequested = false,
      disposed = false,
      activeRun = false;
    const write = (s: string, channel: OutputChannel = 'build') => {
      const log = m.logs[channel];
      log.push(s);
      if (log.length > 1000) log.splice(0, 500);
      m.terminals[channel]?.write(s);
    };
    const preview = (s: string) => {
      m.c = s;
      if (m.preview)
        m.preview.dispatch({ changes: { from: 0, to: m.preview.state.doc.length, insert: s } });
    };
    const startWorker = () => {
      ready = false;
      busy = false;
      worker = new Worker(new URL('./compiler.worker.ts', import.meta.url), { type: 'module' });
      watchdog = setTimeout(() => fail('Compiler loading timed out. Press Run to retry.'), 60000);
      worker.onerror = (e) => fail(e.message || 'Compiler worker failed.');
      worker.onmessage = ({ data }) => {
        if (disposed) return;
        if (data.type === 'ready') {
          clearTimeout(watchdog);
          ready = true;
          compile();
        }
        if (data.type === 'output' && (data.revision === revision || data.running))
          write(data.error ? `\x1b[33m${data.text}\x1b[0m` : data.text, data.channel);
        if (data.type === 'c' && data.revision === revision) preview(data.c);
        if (data.type === 'status') setStatus(data.text);
        if (data.type === 'done') {
          if (data.error && (data.revision === revision || activeRun))
            write(`\n\x1b[31m${data.error}\x1b[0m\n`);
          clearTimeout(watchdog);
          busy = false;
          activeRun = false;
          setRunning(false);
          if (data.revision !== revision || runRequested) compile();
          else {
            setStatus(data.ok ? 'Ready' : 'Compilation failed');
            if (!data.ok) dock.current?.getPanel('build')?.api.setActive();
          }
        }
        if (data.type === 'fatal') fail(data.message);
      };
    };
    const fail = (message: string) => {
      clearTimeout(watchdog);
      worker?.terminate();
      ready = false;
      busy = false;
      activeRun = false;
      runRequested = false;
      setRunning(false);
      setStatus('Toolchain error');
      write(`\x1b[31m${message}\x1b[0m\n`);
      dock.current?.getPanel('build')?.api.setActive();
    };
    const compile = () => {
      if (!ready || busy) return;
      busy = true;
      const run = runRequested;
      activeRun = run;
      runRequested = false;
      setRunning(run);
      setStatus(run ? 'Building & running…' : 'Compiling…');
      if (run) {
        m.logs.build = [];
        m.terminals.build?.reset();
        write('\r\n\x1b[90m$ porfground run\x1b[0m\r\n');
        m.logs.stdout = [];
        m.terminals.stdout?.reset();
        dock.current?.getPanel('stdout')?.api.setActive();
      }
      watchdog = setTimeout(
        () => fail('Execution stopped after 30 seconds. Press Run to restart.'),
        30000,
      );
      worker.postMessage({ type: 'compile', source: m.source, revision, run });
    };
    m.change = (source) => {
      m.source = source;
      revision++;
      try {
        localStorage.setItem('porfground.source.v1', source);
      } catch {}
      clearTimeout(timer);
      timer = setTimeout(compile, 350);
    };
    action.current = () => {
      if (activeRun) {
        clearTimeout(watchdog);
        worker.terminate();
        activeRun = false;
        runRequested = false;
        setRunning(false);
        write('\n\x1b[33mExecution stopped.\x1b[0m\n');
        dock.current?.getPanel('build')?.api.setActive();
        startWorker();
        return;
      }
      runRequested = true;
      clearTimeout(timer);
      if (!ready && !busy) {
        worker.terminate();
        clearTimeout(watchdog);
        startWorker();
      } else compile();
    };
    write('\x1b[90mLoading Porffor + xcc…\x1b[0m\n');
    startWorker();
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        action.current();
      }
    };
    window.addEventListener('keydown', key);
    return () => {
      disposed = true;
      worker.terminate();
      clearTimeout(timer);
      clearTimeout(watchdog);
      window.removeEventListener('keydown', key);
    };
  }, []);
  const onReady = ({ api }: DockviewReadyEvent) => {
    dock.current = api;
    const m = model.current!;
    api.addPanel({
      id: 'source',
      component: 'code',
      title: 'main.js',
      params: { model: m, kind: 'source' },
    });
    const narrow = window.innerWidth < 650;
    api.addPanel({
      id: 'c',
      component: 'code',
      title: 'output.c',
      params: { model: m, kind: 'c' },
      position: { referencePanel: 'source', direction: narrow ? 'below' : 'right' },
    });
    const terminal = api.addPanel({
      id: 'build',
      component: 'terminal',
      title: 'Build output',
      params: { model: m, channel: 'build' },
      position: { referencePanel: 'c', direction: 'below' },
    });
    api.addPanel({
      id: 'stdout',
      component: 'terminal',
      title: 'stdout',
      params: { model: m, channel: 'stdout' },
      position: { referencePanel: 'build', direction: 'within' },
      inactive: true,
    });
    requestAnimationFrame(() => {
      terminal.api.setSize({ height: Math.round(api.height * 0.36) });
      api.getPanel('source')?.api.setActive();
    });
  };
  return (
    <div className="app">
      <header>
        <div className="brand">
          <span className="mark" />
          porfground
        </div>
        <div className="pipeline">
          JS <span>→</span> C <span>→</span> WASM
        </div>
        <button onClick={() => action.current()} title="Run / stop (Ctrl+Enter / ⌘Enter)">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d={running ? 'M2 2H12V12H2Z' : 'M3 1.5 12 7 3 12.5Z'} fill="currentColor" />
          </svg>
          {running ? 'Stop' : 'Run'}
        </button>
      </header>
      <main>
        <DockviewReact
          components={components}
          onReady={onReady}
          theme={themeDark}
          defaultTabComponent={({ api }) => <span className="panel-tab">{api.title}</span>}
          disableFloatingGroups
        />
      </main>
      <footer>
        <span className="local">
          <i />
          Local execution{' '}
          <span className="status" role="status">
            {status}
          </span>
        </span>
        <span>Porffor + xcc</span>
      </footer>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
