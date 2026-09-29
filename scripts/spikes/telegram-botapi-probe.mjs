// PHASE-05A spike: read-only Bot API capability probe (docs/telegram/CAPABILITY-MATRIX.md).
// Usage: node scripts/spikes/telegram-botapi-probe.mjs   (reads TELEGRAM_BOT_TOKEN from .env; never prints it)
// Not production code: no retries by design; respect any retry_after before re-running.
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(readFileSync('.env', 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const token = env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error('TELEGRAM_BOT_TOKEN missing from .env');
async function call(method, params = {}) {
  const url = `https://api.telegram.org/bot${token}/${method}?` + new URLSearchParams(params);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    return await res.json();
  } catch (e) {
    return { ok: false, description: `network: ${e.name}` };
  }
}
const describe = (r) => (r.ok ? r.result : { error_code: r.error_code, description: r.description, retry_after: r.parameters?.retry_after });

const me = await call('getMe');
console.log('getMe:', me.ok ? { ok: true, is_bot: me.result.is_bot, username_present: !!me.result.username } : describe(me));

const chat = await call('getChat', { chat_id: '@telegram' });
if (chat.ok) {
  const r = chat.result;
  console.log('getChat(@telegram) ok; fields returned:', Object.keys(r).sort().join(', '));
  console.log('  sample:', { id: r.id, type: r.type, title: r.title, username: r.username, linked_chat_id: r.linked_chat_id, has_visible_history: r.has_visible_history });
} else console.log('getChat(@telegram):', describe(chat));

const count = await call('getChatMemberCount', { chat_id: '@telegram' });
console.log('getChatMemberCount(@telegram):', count.ok ? { ok: true, count: count.result } : describe(count));

if (chat.ok && chat.result.linked_chat_id) {
  const g = await call('getChat', { chat_id: String(chat.result.linked_chat_id) });
  console.log('getChat(linked discussion group by id):', g.ok ? { ok: true, type: g.result.type, fields: Object.keys(g.result).length } : describe(g));
}

const missing = await call('getChat', { chat_id: '@this_channel_should_not_exist_zz9' });
console.log('getChat(nonexistent):', describe(missing));
