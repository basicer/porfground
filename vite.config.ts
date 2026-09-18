import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react()],
  worker: { format: 'es' },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('codemirror') || id.includes('@lezer')) return 'editor';
          if (id.includes('dockview')) return 'dockview';
          if (id.includes('@xterm')) return 'terminal';
          if (id.includes('react') || id.includes('scheduler')) return 'react';
        },
      },
    },
  },
});
