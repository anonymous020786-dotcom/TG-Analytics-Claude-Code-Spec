/**
 * Operator CLI for role assignments (PHASE-17): the way to create the first admin, and a
 * fallback until the admin UI exists (PHASE-26). Users are identified by Telegram user id
 * (they must have signed in once). Every change is audited; the last admin cannot be removed.
 *   node dist/roles-cli.js list <telegram-user-id>
 *   node dist/roles-cli.js grant <telegram-user-id> <role> --actor <operator-id>
 *   node dist/roles-cli.js revoke <telegram-user-id> <role> --actor <operator-id>
 */
import { ConfigError, defineConfig, loadConfig } from '@tga/config';
import { AuditLogRepository, createDatabase, RoleRepository } from '@tga/database';
import { z } from 'zod';

const TELEGRAM_ID = /^[1-9]\d{0,15}$/;
const ROLE = /^[a-z][a-z0-9_]{1,31}$/;
const ACTOR = /^[a-zA-Z0-9._@-]{2,64}$/;
const spec = defineConfig({ shape: { DATABASE_URL: z.string().min(1) }, secrets: ['DATABASE_URL'] });

function usage(): never {
  process.stderr.write('usage: roles-cli list <telegram-user-id> | grant|revoke <telegram-user-id> <role> --actor <operator-id>\n');
  process.exit(2);
}

async function main(): Promise<void> {
  const [command, tgId, role, flag, actor] = process.argv.slice(2);
  const listing = command === 'list' && tgId && TELEGRAM_ID.test(tgId);
  const changing = (command === 'grant' || command === 'revoke') && tgId && TELEGRAM_ID.test(tgId) && role && ROLE.test(role) && flag === '--actor' && actor && ACTOR.test(actor);
  if (!listing && !changing) usage();
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
  const roles = new RoleRepository(db);
  try {
    const user = await db.user.findUnique({ where: { telegramUserId: BigInt(tgId!) } });
    if (!user) {
      process.stderr.write('no account with that Telegram user id (the person must sign in once first)\n');
      process.exitCode = 1;
      return;
    }
    if (command === 'list') {
      process.stdout.write(`${user.id}\t${(await roles.rolesOf(user.id)).join(',') || '(none)'}\n`);
      return;
    }
    if (!(await roles.roleExists(role!))) {
      process.stderr.write(`unknown role: ${role}\n`);
      process.exitCode = 1;
      return;
    }
    const operator = `operator:${actor!}`;
    const audit = new AuditLogRepository(db);
    if (command === 'grant') {
      const granted = await roles.grant(user.id, role!, operator);
      if (granted) await audit.append({ actorType: 'user', actorId: operator, action: 'role.granted', targetType: 'user', targetId: user.id, metadata: { role: role!, via: 'roles-cli' } });
      process.stdout.write(granted ? `granted ${role}\n` : `already had ${role}\n`);
      return;
    }
    const outcome = await roles.revoke(user.id, role!);
    if (outcome === 'last_holder') {
      process.stderr.write(`refused: this is the last ${role}\n`);
      process.exitCode = 1;
      return;
    }
    if (outcome === 'revoked') await audit.append({ actorType: 'user', actorId: operator, action: 'role.revoked', targetType: 'user', targetId: user.id, metadata: { role: role!, via: 'roles-cli' } });
    process.stdout.write(outcome === 'revoked' ? `revoked ${role}\n` : `did not have ${role}\n`);
  } finally {
    await db.$disconnect();
  }
}

void main();
