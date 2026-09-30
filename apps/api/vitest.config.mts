import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['source'] },
  test: {
    include: ['src/**/*.test.ts'],
    // E2E files share the integration test database: run files serially.
    fileParallelism: false,
  },
});
