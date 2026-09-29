/**
 * Operator CLI to request discovery of one public channel/group (until a public submission
 * API exists, PHASE-22). The reference is validated locally (no network); the request is
 * queued (channel.discovery) and audited.
 *   node dist/discover-cli.js <username|t.me link> --actor <operator-id>
 */
import { ConfigError, defineConfig, loadConfig } from '@tga/config';
import { AuditLogRepository, createDatabase, JobRepository } from '@tga/database';
import { QUEUES } from '@tga/queues';
import { normalizeTelegramReference } from '@tga/validation';
import { z } from 'zod';

const ACTOR = /^[a-zA-Z0-9._@-]{2,64}$/;
const spec = defineConfig({ shape: { DATABASE_URL: z.string().min(1) }, secrets: ['DATABASE_URL'] });

async function main(): Promise<void> {
  const [reference, flag, actor] = process.argv.slice(2);
  if (!reference || flag !== '--actor' || !actor || !ACTOR.test(actor)) {
    process.stderr.write('usage: discover-cli <username|t.me link> --actor <operator-id>\n');
    process.exit(2);
  }
  const normalized = normalizeTelegramReference(reference);
  if (!normalized.ok) {
    process.stderr.write(`rejected: ${normalized.reason}\n`);
    process.exit(1);
  }
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
  try {
    const day = new Date().toISOString().slice(0, 10);
    const { job, created } = await new JobRepository(db).enqueue({
      queue: QUEUES.discovery,
      type: 'manual',
      idempotencyKey: `manual:${normalized.username}:${day}`,
      payloadVersion: 1,
      payload: { input: normalized.username },
      maxAttempts: 5,
      priority: 10,
    });
    await new AuditLogRepository(db).append({
      actorType: 'user',
      actorId: actor,
      action: 'discovery.request',
      targetType: 'job',
      targetId: job.id,
      metadata: { username: normalized.username, created },
    });
    process.stdout.write(`${created ? 'queued' : 'already queued today'}: ${normalized.username} (job ${job.id})\n`);
  } finally {
    await db.$disconnect();
  }
}

void main();
