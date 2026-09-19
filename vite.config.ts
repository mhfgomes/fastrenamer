import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import electron from 'vite-plugin-electron/simple';
import path from 'node:path';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

export default defineConfig(({ mode }) => ({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    tailwindcss(),
    react(),
    ...(mode === 'test'
      ? []
      : [
          electron({
            main: {
              entry: 'electron/main.ts',
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
            },
          }),
        ]),
  ],
  resolve: {
    alias: [
      { find: '@fast-renamer/rename-engine/sort', replacement: path.resolve(__dirname, 'packages/rename-engine/src/sort.ts') },
      { find: '@fast-renamer/rename-engine/types', replacement: path.resolve(__dirname, 'packages/rename-engine/src/types.ts') },
      { find: '@fast-renamer/rename-engine', replacement: path.resolve(__dirname, 'packages/rename-engine/src/index.ts') },
      { find: '@renderer', replacement: path.resolve(__dirname, 'src/renderer') },
      { find: '@shared', replacement: path.resolve(__dirname, 'src/shared') },
    ],
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist-renderer',
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts', 'electron/**/*.test.ts', 'packages/**/*.test.ts'],
  },
}));
