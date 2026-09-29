import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { describe, expect, it } from 'vitest';
import { defineConfig, loadConfig } from './index';
import { schedulerConfigShape, schedulerSecrets } from './scheduler';

const example = parseEnv(readFileSync(join(__dirname, '../../../.env.example'), 'utf8'));
const spec = defineConfig({ shape: schedulerConfigShape, secrets: [...schedulerSecrets] });

describe('scheduler config', () => {
  it('documents every scheduler variable in .env.example and keeps secrets empty', () => {
    for (const key of Object.keys(schedulerConfigShape)) expect(Object.keys(example)).toContain(key);
    for (const key of schedulerSecrets) expect(example[key]).toBe('');
  });

  it('applies provisional defaults and rejects out-of-range intervals', () => {
    expect(loadConfig(spec, { DATABASE_URL: 'x' })).toMatchObject({ SCHEDULER_TICK_SECONDS: 60, METRICS_REFRESH_MINUTES: 360, METADATA_REFRESH_MINUTES: 1_440 });
    expect(() => loadConfig(spec, { DATABASE_URL: 'x', METRICS_REFRESH_MINUTES: '1' })).toThrow();
    expect(() => loadConfig(spec, { DATABASE_URL: 'x', SCHEDULER_TICK_SECONDS: '0' })).toThrow();
  });
});
