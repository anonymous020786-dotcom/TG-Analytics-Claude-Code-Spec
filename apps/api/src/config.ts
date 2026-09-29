import { defineConfig, loadConfig, type Config } from '@tga/config';
import { z } from 'zod';

/**
 * API configuration. Every variable is documented in `.env.example` and
 * docs/operations/CONFIGURATION.md; a test keeps them in sync.
 */
export const apiConfigSpec = defineConfig({
  shape: {
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  },
  secrets: [],
});

export type ApiConfig = Config<typeof apiConfigSpec.shape>;

export function loadApiConfig(env: Record<string, string | undefined> = process.env): ApiConfig {
  return loadConfig(apiConfigSpec, env);
}
