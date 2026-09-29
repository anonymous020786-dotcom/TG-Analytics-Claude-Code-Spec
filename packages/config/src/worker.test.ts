import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { describe, expect, it } from 'vitest';
import { defineConfig, loadConfig } from './index';
import { workerConfigShape, workerSecrets } from './worker';

const example = parseEnv(readFileSync(join(__dirname, '../../../.env.example'), 'utf8'));
const spec = defineConfig({ shape: workerConfigShape, secrets: [...workerSecrets] });

describe('worker config', () => {
  it('documents every worker variable in .env.example', () => {
    for (const key of Object.keys(workerConfigShape)) expect(Object.keys(example)).toContain(key);
  });

  it('keeps worker secrets empty in .env.example', () => {
    for (const key of workerSecrets) expect(example[key]).toBe('');
  });

  it('requires secrets and bounds concurrency', () => {
    expect(() => loadConfig(spec, {})).toThrow(/DATABASE_URL|REDIS_URL|TELEGRAM_BOT_TOKEN/);
    const env = { DATABASE_URL: 'x', REDIS_URL: 'y', TELEGRAM_BOT_TOKEN: 'z' };
    expect(loadConfig(spec, env)).toMatchObject({ WORKER_CONCURRENCY: 2, QUEUE_PREFIX: 'tga', TELEGRAM_CREDENTIAL_ID: 'bot-1' });
    expect(() => loadConfig(spec, { ...env, WORKER_CONCURRENCY: '500' })).toThrow();
  });
});
