import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { Client } from 'pg';

/**
 * Integration-test database bootstrap. Requires TEST_DATABASE_URL pointing at a database
 * whose name ends in "_test" — this guard prevents wiping a real database. The public
 * schema is dropped and rebuilt with the real migrations (`prisma migrate deploy`).
 */
export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error('TEST_DATABASE_URL is required for @tga/database integration tests (see docs/operations/DATABASE.md).');
  }
  const name = new URL(url).pathname.replace(/^\//, '');
  if (!name.endsWith('_test')) {
    throw new Error(`Refusing to run integration tests against database "${name}": its name must end with "_test".`);
  }
  return url;
}

export default async function setup(): Promise<void> {
  const url = testDatabaseUrl();
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 5_000 });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
  } finally {
    await client.end();
  }
  const pkgRoot = path.resolve(__dirname, '..');
  execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
    cwd: pkgRoot,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
}
