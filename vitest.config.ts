import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    maxConcurrency: 3,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        'dist/**',
        '**/*.d.ts',
        '**/*.config.*',
        '**/test/**',
        '**/tests/**',
        'temp_*/**',
      ],
    },
    projects: [
      {
        test: {
          name: 'agent-core',
          root: fileURLToPath(new URL('./packages/agent-core', import.meta.url)),
          environment: 'node',
          include: ['test/**/*.test.ts'],
          testTimeout: 20000,
          hookTimeout: 20000,
        },
      },
      {
        test: {
          name: 'server',
          root: fileURLToPath(new URL('./apps/server', import.meta.url)),
          environment: 'node',
          include: ['test/**/*.test.ts'],
          fileParallelism: false,
          testTimeout: 30000,
          hookTimeout: 30000,
        },
      },
      {
        test: {
          name: 'web',
          root: fileURLToPath(new URL('./apps/web', import.meta.url)),
          environment: 'jsdom',
          globals: true,
          setupFiles: ['./src/test/setup.ts'],
          include: ['src/**/*.test.{ts,tsx}'],
          testTimeout: 15000,
        },
      },
    ],
  },
});
