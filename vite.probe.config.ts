import { defineConfig } from 'vite';

// Bundles the in-page probe into one IIFE script, `dist/probe.js`, which the
// background worker injects through the Chrome DevTools Protocol.
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'es2020',
    sourcemap: false,
    lib: {
      entry: 'src/capture/probe.entry.ts',
      formats: ['iife'],
      name: 'BugTrailProbe',
      fileName: () => 'probe.js',
    },
  },
});
