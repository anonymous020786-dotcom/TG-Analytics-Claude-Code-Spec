// Creates staging secrets as files under staging/secrets/ (git-ignored), for Docker secrets.
// Never prints secret values. Existing files are kept unless --rotate is given.
//   node scripts/staging/init-secrets.mjs            # create missing secrets
//   node scripts/staging/init-secrets.mjs --rotate   # regenerate DB/Redis passwords (see STAGING.md first)
// The Telegram bot token is taken from STAGING_TELEGRAM_BOT_TOKEN (preferred) or TELEGRAM_BOT_TOKEN
// in the environment; staging should use its own dedicated token (D-015).
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dir = path.join(root, 'staging', 'secrets');
const rotate = process.argv.includes('--rotate');
mkdirSync(dir, { recursive: true });

const file = (name) => path.join(dir, name);
const write = (name, value) => {
  writeFileSync(file(name), value, { encoding: 'utf8', mode: 0o600 });
  try {
    chmodSync(file(name), 0o600);
  } catch {
    /* not supported on every filesystem */
  }
  console.log(`wrote staging/secrets/${name}`);
};
const password = () => randomBytes(24).toString('base64url');

let pg = existsSync(file('postgres_password')) ? readFileSync(file('postgres_password'), 'utf8').trim() : null;
let redis = existsSync(file('redis_password')) ? readFileSync(file('redis_password'), 'utf8').trim() : null;
if (!pg || rotate) write('postgres_password', (pg = password()));
if (!redis || rotate) write('redis_password', (redis = password()));
// Connection URLs always follow the passwords (hosts are compose service names).
write('database_url', `postgresql://tga:${pg}@postgres:5432/tga`);
write('redis_url', `redis://:${redis}@redis:6379/0`);

if (!existsSync(file('telegram_bot_token'))) {
  const token = process.env.STAGING_TELEGRAM_BOT_TOKEN ?? process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error('Missing Telegram bot token: set STAGING_TELEGRAM_BOT_TOKEN, then re-run.');
    process.exit(1);
  }
  write('telegram_bot_token', token.trim());
}
console.log('staging secrets ready (values not shown)');
