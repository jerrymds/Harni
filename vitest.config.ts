import { defineConfig } from 'vitest/config';

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
          root: './packages/agent-core',
          environment: 'node',
          include: ['test/**/*.test.ts'],
          testTimeout: 20000,
          hookTimeout: 20000,
        },
      },
      {
        test: {
          name: 'server',
          root: './apps/server',
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
          root: './apps/web',
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
