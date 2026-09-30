import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { ConfigError } from '@tga/config';
import { describe, expect, it } from 'vitest';
import { apiConfigSpec, loadApiConfig } from './config';

const exampleEnv = parseEnv(readFileSync(join(__dirname, '../../../.env.example'), 'utf8'));

describe('api config', () => {
  it('uses safe defaults when nothing is set', () => {
    expect(loadApiConfig({ DATABASE_URL: 'x' })).toEqual({ APP_ENV: 'local', PORT: 3001, LOG_LEVEL: 'info', DATABASE_URL: 'x', METRICS_REFRESH_MINUTES: 360, METADATA_REFRESH_MINUTES: 1_440, SEO_MIN_MEMBERS: 1_000, SEO_MIN_HISTORY_DAYS: 7, PUBLIC_SITE_URL: 'http://127.0.0.1:3000', SESSION_ABSOLUTE_DAYS: 30, SESSION_IDLE_DAYS: 7, COOKIE_SECURE: true });
  });

  it('accepts .env.example as-is', () => {
    expect(() => loadApiConfig({ ...exampleEnv, DATABASE_URL: 'x' })).not.toThrow();
  });

  it('documents every api variable in .env.example', () => {
    const documented = Object.keys(exampleEnv);
    for (const key of ['APP_ENV', ...Object.keys(apiConfigSpec.shape)]) {
      expect(documented).toContain(key);
    }
  });

  it('keeps secrets out of .env.example', () => {
    for (const key of apiConfigSpec.secrets ?? []) {
      expect(exampleEnv[key] ?? '').toBe('');
    }
  });

  it('rejects an invalid port and log level', () => {
    expect(() => loadApiConfig({ DATABASE_URL: 'x', PORT: '70000', LOG_LEVEL: 'verbose' })).toThrow(ConfigError);
  });
});
