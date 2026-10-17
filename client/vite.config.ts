import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const clientDir = fileURLToPath(new URL('.', import.meta.url));
const sharedDir = fileURLToPath(new URL('../shared', import.meta.url));

export default defineConfig({
  root: clientDir,
  plugins: [react()],
  resolve: {
    alias: { '@shared': sharedDir },
  },
  build: {
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
    // The dev server talks to the Node app, so cookies stay same-origin.
    proxy: { '/api': 'http://127.0.0.1:8080' },
  },
});
