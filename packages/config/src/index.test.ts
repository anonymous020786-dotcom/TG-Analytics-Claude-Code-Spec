import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ConfigError, defineConfig, loadConfig, redactConfig } from './index';

const spec = defineConfig({
  shape: {
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    LOG_LEVEL: z.enum(['info', 'debug']).default('info'),
    DATABASE_URL: z.string().min(10),
  },
  secrets: ['DATABASE_URL'],
});

const SECRET = 'fake-database-url-for-tests';
const noFiles = () => {
  throw new Error('no file access expected');
};

function errorOf(fn: () => unknown): ConfigError {
  try {
    fn();
  } catch (e) {
    if (e instanceof ConfigError) return e;
    throw e;
  }
  throw new Error('expected ConfigError');
}

describe('loadConfig', () => {
  it('parses, coerces and applies defaults (APP_ENV defaults to local)', () => {
    const cfg = loadConfig(spec, { PORT: '8080', DATABASE_URL: SECRET }, noFiles);

    expect(cfg).toEqual({ APP_ENV: 'local', PORT: 8080, LOG_LEVEL: 'info', DATABASE_URL: SECRET });
  });

  it('ignores undeclared environment variables', () => {
    const cfg = loadConfig(spec, { DATABASE_URL: SECRET, PATH: '/bin', UNRELATED: 'x' }, noFiles);

    expect(Object.keys(cfg).sort()).toEqual(['APP_ENV', 'DATABASE_URL', 'LOG_LEVEL', 'PORT']);
  });

  it('returns a frozen object', () => {
    const cfg = loadConfig(spec, { DATABASE_URL: SECRET }, noFiles);

    expect(Object.isFrozen(cfg)).toBe(true);
  });

  it('reports every invalid or missing key at once', () => {
    const err = errorOf(() => loadConfig(spec, { PORT: 'abc', LOG_LEVEL: 'loud', APP_ENV: 'prod' }, noFiles));

    expect(err.issues.map((i) => i.split(':')[0]).sort()).toEqual(['APP_ENV', 'DATABASE_URL', 'LOG_LEVEL', 'PORT']);
  });

  it('never echoes secret values in errors', () => {
    const err = errorOf(() => loadConfig(spec, { DATABASE_URL: 'short' }, noFiles));

    expect(err.message).toContain('DATABASE_URL');
    expect(err.message).not.toContain('short');
  });

  it('reads secrets from *_FILE and trims the trailing newline', () => {
    const cfg = loadConfig(spec, { DATABASE_URL_FILE: '/run/secrets/db' }, (p) => {
      expect(p).toBe('/run/secrets/db');
      return `${SECRET}\n`;
    });

    expect(cfg.DATABASE_URL).toBe(SECRET);
  });

  it('rejects a secret supplied both directly and via *_FILE', () => {
    const err = errorOf(() => loadConfig(spec, { DATABASE_URL: SECRET, DATABASE_URL_FILE: '/x' }, noFiles));

    expect(err.issues).toEqual(['DATABASE_URL: set only one of DATABASE_URL or DATABASE_URL_FILE']);
  });

  it('reports an unreadable secret file without failing other keys silently', () => {
    const err = errorOf(() => loadConfig(spec, { DATABASE_URL_FILE: '/missing', PORT: 'abc' }, noFiles));

    expect(err.issues).toContain('DATABASE_URL_FILE: cannot read secret file');
    expect(err.issues.some((i) => i.startsWith('PORT'))).toBe(true);
  });

  it('ignores *_FILE for non-secret keys', () => {
    const cfg = loadConfig(spec, { DATABASE_URL: SECRET, PORT_FILE: '/x' }, noFiles);

    expect(cfg.PORT).toBe(3001);
  });

  it('allows placeholder secrets only in local', () => {
    expect(loadConfig(spec, { DATABASE_URL: 'changeme-changeme' }, noFiles).DATABASE_URL).toBe('changeme-changeme');

    for (const APP_ENV of ['development', 'staging', 'production']) {
      const err = errorOf(() => loadConfig(spec, { APP_ENV, DATABASE_URL: 'changeme-changeme' }, noFiles));
      expect(err.issues).toEqual([`DATABASE_URL: placeholder secret not allowed when APP_ENV=${APP_ENV}`]);
    }
  });
});

describe('redactConfig', () => {
  it('masks secret keys for safe logging', () => {
    const cfg = loadConfig(spec, { DATABASE_URL: SECRET }, noFiles);

    expect(redactConfig(spec, cfg)).toEqual({ APP_ENV: 'local', PORT: 3001, LOG_LEVEL: 'info', DATABASE_URL: '[REDACTED]' });
  });
});
