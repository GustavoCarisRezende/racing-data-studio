import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const local = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  plugins: [react()],
  // These private packages are built in their own workspace, never fetched from npm.
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: [
      { find: '@rds/sandbox-react/style.css', replacement: local('../packages/sandbox-react/src/style.css') },
      ...['contracts', 'core', 'react', 'echarts'].map((name) => ({
        find: `@rds/sandbox-${name}`,
        replacement: local(`../packages/sandbox-${name}/dist/index.js`),
      })),
    ],
  },
  clearScreen: false,
  // Keep SVG assets as local files so the restrictive Tauri CSP can load them.
  build: { assetsInlineLimit: 0 },
  server: { port: 1420, strictPort: true, host: '127.0.0.1', fs: { allow: [local('.'), local('../packages')] } },
});
