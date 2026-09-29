import { describe, expect, it } from 'vitest';
import { checkPackage, classify, moduleName } from './check-boundaries.mjs';

const pkg = (overrides) => ({ dependencies: [], imports: [], processNames: [], ...overrides });
const imp = (spec, extra = {}) => ({ file: 'src/x.ts', spec, ...extra });

describe('classify / moduleName', () => {
  it('classifies workspace locations', () => {
    expect(classify('packages/logging')).toEqual({ kind: 'library', name: 'logging' });
    expect(classify('packages/adapter-telegram')).toEqual({ kind: 'adapter', name: 'adapter-telegram' });
    expect(classify('apps/web').kind).toBe('web');
    expect(classify('apps/api').kind).toBe('process');
    expect(classify('workers/metrics').kind).toBe('process');
  });

  it('reduces specifiers to module names', () => {
    expect(moduleName('@tga/logging/sub')).toBe('@tga/logging');
    expect(moduleName('pino/file')).toBe('pino');
    expect(moduleName('node:fs')).toBe('fs');
  });
});

describe('checkPackage', () => {
  it('allows the §4 matrix (auth -> database)', () => {
    expect(checkPackage(pkg({ dir: 'packages/auth', name: '@tga/auth', dependencies: ['@tga/database'] }))).toEqual([]);
  });

  it('rejects a library importing a package outside its rule', () => {
    const v = checkPackage(pkg({ dir: 'packages/logging', name: '@tga/logging', imports: [imp('@tga/database')] }));
    expect(v).toHaveLength(1);
    expect(v[0]).toMatch(/may not import @tga\/database/);
  });

  it('rejects web importing database or queues', () => {
    const v = checkPackage(pkg({ dir: 'apps/web', name: '@tga/web', dependencies: ['@tga/database'], imports: [imp('@tga/queues')] }));
    expect(v).toHaveLength(2);
  });

  it('allows web to import ui/types/validation', () => {
    expect(checkPackage(pkg({ dir: 'apps/web', name: '@tga/web', imports: [imp('@tga/ui'), imp('@tga/types')] }))).toEqual([]);
  });

  it('rejects provider SDKs outside adapter packages, including scoped wildcards', () => {
    const v = checkPackage(pkg({ dir: 'apps/api', name: '@tga/api', imports: [imp('telegram'), imp('@aws-sdk/client-s3')] }));
    expect(v).toHaveLength(2);
    expect(checkPackage(pkg({ dir: 'packages/adapter-telegram', name: '@tga/adapter-telegram', imports: [imp('telegram')] }))).toEqual([]);
  });

  it('allows database drivers only in packages/database', () => {
    expect(checkPackage(pkg({ dir: 'packages/database', name: '@tga/database', dependencies: ['@prisma/client', 'pg'] }))).toEqual([]);
    const v = checkPackage(pkg({ dir: 'apps/api', name: '@tga/api', imports: [imp('@prisma/client'), imp('pg')] }));
    expect(v).toHaveLength(2);
    expect(v[0]).toMatch('may only be imported by packages/database');
  });

  it('rejects I/O modules in pure libraries', () => {
    const v = checkPackage(pkg({ dir: 'packages/analytics', name: '@tga/analytics', imports: [imp('node:fs'), imp('ioredis')] }));
    expect(v).toHaveLength(2);
  });

  it('rejects process code importing other process code', () => {
    const v = checkPackage(pkg({ dir: 'workers/metrics', name: '@tga/worker-metrics', imports: [imp('@tga/api')], processNames: ['@tga/api'] }));
    expect(v[0]).toMatch(/must not import process code/);
  });

  it('rejects relative imports that escape the package', () => {
    const v = checkPackage(pkg({ dir: 'apps/api', name: '@tga/api', imports: [imp('../../workers/metrics/src/x', { escapes: true }), imp('./ok')] }));
    expect(v).toHaveLength(1);
  });

  it('rejects libraries without a rule and misnamed packages', () => {
    expect(checkPackage(pkg({ dir: 'packages/mystery', name: '@tga/mystery' }))[0]).toMatch(/no rule/);
    expect(checkPackage(pkg({ dir: 'packages/types', name: 'types' }))[0]).toMatch(/must be named/);
  });
});
