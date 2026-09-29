import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['source'] },
  test: {
    include: ['src/**/*.test.ts'],
    // Shares the integration test database with @tga/database: run files serially.
    fileParallelism: false,
    hookTimeout: 60_000,
  },
});
