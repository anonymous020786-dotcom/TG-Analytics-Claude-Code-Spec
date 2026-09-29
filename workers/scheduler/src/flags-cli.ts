/**
 * Operator CLI for feature flags until the admin UI exists (PHASE-26). Changes are audited.
 *   node dist/flags-cli.js list
 *   node dist/flags-cli.js set <key> on|off --actor <operator-id>
 */
import { ConfigError, defineConfig, loadConfig } from '@tga/config';
import { AuditLogRepository, createDatabase, FeatureFlagRepository } from '@tga/database';
import { z } from 'zod';

const KEY = /^[a-z0-9]+([._-][a-z0-9]+)*$/;
const ACTOR = /^[a-zA-Z0-9._@-]{2,64}$/;
const spec = defineConfig({ shape: { DATABASE_URL: z.string().min(1) }, secrets: ['DATABASE_URL'] });

function usage(): never {
  process.stderr.write('usage: flags-cli list | set <key> on|off --actor <operator-id>\n');
  process.exit(2);
}

async function main(): Promise<void> {
  const [command, key, value, flag, actor] = process.argv.slice(2);
  if (command !== 'list' && !(command === 'set' && key && KEY.test(key) && (value === 'on' || value === 'off') && flag === '--actor' && actor && ACTOR.test(actor))) usage();
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
    if (command === 'list') {
      for (const f of await db.featureFlag.findMany({ orderBy: { key: 'asc' }, take: 500 })) process.stdout.write(`${f.key}\t${f.enabled ? 'on' : 'off'}\n`);
      return;
    }
    const enabled = value === 'on';
    await new FeatureFlagRepository(db).set(key!, enabled);
    await new AuditLogRepository(db).append({ actorType: 'user', actorId: actor!, action: 'feature_flag.set', targetType: 'feature_flag', targetId: key!, metadata: { enabled } });
    process.stdout.write(`${key} ${value}\n`);
  } finally {
    await db.$disconnect();
  }
}

void main();
