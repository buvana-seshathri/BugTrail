import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Builds the extension pages and the background worker into `dist/`.
// The in-page probe is built separately (see vite.probe.config.ts) because it
// must be a single self-contained script.
export default defineConfig({
  plugins: [react()],
  base: '',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome116',
    sourcemap: true,
    modulePreload: false,
    rollupOptions: {
      input: {
        background: 'src/background/index.ts',
        sidepanel: 'src/pages/sidepanel.html',
        panel: 'src/pages/panel.html',
        popup: 'src/pages/popup.html',
        devtools: 'src/pages/devtools.html',
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js'),
      },
    },
  },
});
