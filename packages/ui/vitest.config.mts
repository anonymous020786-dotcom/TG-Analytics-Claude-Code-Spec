import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['source'] },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // The contrast test imports styles.css?raw; Vitest stubs CSS unless it is processed.
    css: { include: [/styles\.css/] },
  },
});
