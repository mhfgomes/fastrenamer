import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import electron from 'vite-plugin-electron/simple';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { injectProductionCspMeta } from './electron/csp.ts';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

// Production builds get a strict CSP <meta> tag whose script-src hashes are
// computed from the final index.html, so they cannot drift from the inline
// theme bootstrap script. The dev server keeps the relaxed header-based policy
// set by the main process (React Refresh/HMR need inline scripts + websockets).
const productionCspPlugin = (): Plugin => ({
  name: 'fastrenamer:production-csp',
  apply: 'build',
  transformIndexHtml: {
    order: 'post',
    handler: (html) => injectProductionCspMeta(html),
  },
});

export default defineConfig(({ mode }) => ({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    tailwindcss(),
    react(),
    productionCspPlugin(),
    ...(mode === 'test'
      ? []
      : [
          electron({
            main: {
              // The preview worker is its own entry so main can spawn it from dist-electron
              // (Electron's worker_threads load it fine from inside app.asar).
              entry: {
                main: 'electron/main.ts',
                'preview-worker': 'electron/preview-worker.ts',
              },
              vite: {
                build: {
                  rollupOptions: {
                    external: ['node:sqlite', 'electron-updater'],
                  },
                },
              },
            },
            preload: {
              input: {
                preload: 'electron/preload.ts',
              },
              vite: {
                build: {
                  rolldownOptions: {
                    // Sandboxed preloads must be CommonJS; use a .cjs extension so
                    // the file is never mistaken for an ES module.
                    output: { entryFileNames: '[name].cjs', chunkFileNames: '[name].cjs' },
                  },
                },
              },
            },
          }),
        ]),
  ],
  resolve: {
    alias: [
      { find: '@renderer', replacement: path.resolve(import.meta.dirname, 'src/renderer') },
      { find: '@shared', replacement: path.resolve(import.meta.dirname, 'src/shared') },
    ],
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist-renderer',
    // Never inline fonts as data: URIs; the CSP only allows `font-src 'self'`.
    assetsInlineLimit: (file: string) => (/\.(woff2?|ttf|otf)$/i.test(file) ? false : undefined),
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts', 'electron/**/*.test.ts'],
  },
}));
