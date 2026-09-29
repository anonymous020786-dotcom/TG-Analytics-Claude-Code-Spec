/**
 * Operator CLI for dead-letter handling until the admin UI exists (PHASE-26).
 *   list:     node dist/redrive-cli.js list
 *   re-drive: node dist/redrive-cli.js redrive <jobId> --actor <operator-id>
 * Every re-drive is audited (actor recorded). Reads DATABASE_URL from the environment.
 */
import { ConfigError, defineConfig, loadConfig } from '@tga/config';
import { createDatabase, JobRepository } from '@tga/database';
import { z } from 'zod';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTOR = /^[a-zA-Z0-9._@-]{2,64}$/;
const spec = defineConfig({ shape: { DATABASE_URL: z.string().min(1) }, secrets: ['DATABASE_URL'] });

function usage(): never {
  process.stderr.write('usage: redrive-cli list | redrive <jobId> --actor <operator-id>\n');
  process.exit(2);
}

async function main(): Promise<void> {
  const [command, jobId, flag, actor] = process.argv.slice(2);
  let config;
  try {
    config = loadConfig(spec);
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
  const db = createDatabase({ url: config.DATABASE_URL, poolMax: 1 });
  const jobs = new JobRepository(db);
  try {
    if (command === 'list') {
      const page = await jobs.listDeadLetters({ limit: 100 });
      for (const d of page.items) process.stdout.write(`${d.jobId}\t${d.errorClass}\t${d.deadAt.toISOString()}\t${(d.errorMessage ?? '').slice(0, 120)}\n`);
      if (page.nextCursor) process.stdout.write('(more dead letters exist; showing the newest 100)\n');
    } else if (command === 'redrive') {
      if (!jobId || !UUID.test(jobId) || flag !== '--actor' || !actor || !ACTOR.test(actor)) usage();
      const result = await jobs.redrive(jobId, { actorType: 'user', actorId: actor });
      process.stdout.write(`${result}\n`);
      if (result !== 'redriven') process.exitCode = 1;
    } else {
      usage();
    }
  } finally {
    await db.$disconnect();
  }
}

void main();
