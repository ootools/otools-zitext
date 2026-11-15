import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Build config for the composed tree (`.build/`), produced by scripts/build.mjs.
 *
 * The single most important piece is `resolve.alias`: upstream imports Tauri's
 * JavaScript APIs everywhere. Every one of those specifiers is redirected to a
 * shim that talks to the OTools host instead of a Rust backend. `base: './'`
 * is required because the host serves the entry as `otools-plugin://<uuid>/...`.
 */
const root = path.dirname(fileURLToPath(import.meta.url));
const shim = (file: string) => path.join(root, 'shim', file);

export default defineConfig({
  root,
  base: './',
  publicDir: path.join(root, 'public'),
  plugins: [react()],
  clearScreen: false,
  resolve: {
    alias: [
      { find: /^@tauri-apps\/api\/core$/, replacement: shim('core.ts') },
      { find: /^@tauri-apps\/api\/event$/, replacement: shim('event.ts') },
      { find: /^@tauri-apps\/api\/window$/, replacement: shim('window.ts') },
      { find: /^@tauri-apps\/api\/app$/, replacement: shim('app.ts') },
      { find: /^@tauri-apps\/plugin-dialog$/, replacement: shim('dialog.ts') },
      { find: /^@tauri-apps\/plugin-clipboard-manager$/, replacement: shim('clipboard.ts') },
    ],
  },
  optimizeDeps: {
    include: ['@monaco-editor/react', 'monaco-editor'],
  },
  worker: { format: 'es' },
  build: {
    outDir: path.resolve(root, '..', 'dist'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 7500,
    rollupOptions: {
      output: {
        manualChunks: (id: string) =>
          id.includes('monaco-editor') || id.includes('@monaco-editor/react') ? 'monaco' : undefined,
      },
    },
  },
  server: {
    port: 5395,
    strictPort: true,
    host: '127.0.0.1',
  },
});
