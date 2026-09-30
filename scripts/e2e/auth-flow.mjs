// Sign in with Telegram E2E (PHASE-16) through the staging edge.
//   node scripts/e2e/auth-flow.mjs <baseUrl> [--auth on|off]
// With --auth on, it signs a Login Widget payload for a synthetic test user (Telegram id
// 999000001) with the staging bot token read from staging/secrets/telegram_bot_token, exactly as
// Telegram's widget would, and walks sign-in → account → sign-out. The token is never printed.
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:\/\//.test(a)) ?? 'http://127.0.0.1:8080').replace(/\/+$/, '');
const authOn = (args.includes('--auth') ? args[args.indexOf('--auth') + 1] : 'on') === 'on';
const origin = new URL(base).origin;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push([name, 'ok']);
  } catch (error) {
    results.push([name, `FAIL: ${error instanceof Error ? error.message : String(error)}`]);
  }
}
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

/** Tiny cookie jar: keeps name=value pairs, honours Max-Age=0 deletions. */
class Jar {
  map = new Map();
  absorb(res) {
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split('; ');
      const [k, v] = pair.split('=');
      if (attrs.includes('Max-Age=0')) this.map.delete(k);
      else this.map.set(k, v);
    }
  }
  header() {
    return [...this.map].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

const req = (p, init = {}) => fetch(base + p, { redirect: 'manual', signal: AbortSignal.timeout(15_000), ...init });

function signedPayload(overrides = {}) {
  const token = readFileSync(path.join(root, 'staging/secrets/telegram_bot_token'), 'utf8').trim();
  const data = { id: 999000001, first_name: 'E2E', last_name: 'Tester', username: 'tga_e2e_tester', auth_date: Math.floor(Date.now() / 1000) - 2, ...overrides };
  const check = Object.keys(data)
    .sort()
    .map((k) => `${k}=${data[k]}`)
    .join('\n');
  return { ...data, hash: createHmac('sha256', createHash('sha256').update(token).digest()).update(check).digest('hex') };
}

async function bootstrap(jar) {
  const res = await req('/api/v1/auth/session', { headers: { cookie: jar.header() } });
  jar.absorb(res);
  return { res, body: res.status === 200 ? await res.json() : null };
}

const post = (p, jar, csrf, body, extra = {}) =>
  req(p, { method: 'POST', headers: { 'content-type': 'application/json', origin, cookie: jar.header(), ...(csrf ? { 'x-csrf-token': csrf } : {}), ...extra }, body: JSON.stringify(body) });

if (!authOn) {
  await check('sign-in is hidden while auth.login is off', async () => {
    expect((await req('/api/v1/auth/session')).status === 404, 'session endpoint');
    expect((await req('/login')).status === 404, '/login page');
    expect(!(await (await req('/')).text()).includes('href="/login"'), 'nav shows Sign in');
  });
} else {
  await check('login page and nav link exist', async () => {
    const page = await req('/login');
    expect(page.status === 200, `/login status ${page.status}`);
    const html = await page.text();
    expect(/<meta name="robots" content="noindex/.test(html), 'login page must be noindex');
    expect((await (await req('/')).text()).includes('href="/login"'), 'nav Sign in link');
  });

  await check('bootstrap sets a __Host- pre-session cookie and returns a CSRF token and bot', async () => {
    const jar = new Jar();
    const { res, body } = await bootstrap(jar);
    expect(res.status === 200 && res.headers.get('cache-control') === 'no-store', 'status/cache');
    expect(body.data.authenticated === false && /^[A-Za-z0-9_-]{43}$/.test(body.data.csrfToken) && body.data.loginBot.username, 'body');
    const set = res.headers.getSetCookie().join(' ');
    expect(/__Host-tga_pre=[^;]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=86400; Secure/.test(set), `pre cookie attributes: ${set.replace(/=[A-Za-z0-9_-]{43}/, '=…')}`);
  });

  await check('CSRF, origin and signature are enforced at the edge-facing API', async () => {
    const jar = new Jar();
    const { body } = await bootstrap(jar);
    expect((await post('/api/v1/auth/telegram', jar, null, signedPayload())).status === 403, 'no CSRF token');
    expect((await post('/api/v1/auth/telegram', jar, body.data.csrfToken, signedPayload(), { origin: 'https://evil.example' })).status === 403, 'foreign origin');
    expect((await post('/api/v1/auth/telegram', jar, body.data.csrfToken, { ...signedPayload(), id: 1 })).status === 401, 'tampered payload');
    expect((await post('/api/v1/auth/telegram', jar, body.data.csrfToken, signedPayload({ auth_date: Math.floor(Date.now() / 1000) - 7200 }))).status === 401, 'stale payload');
  });

  await check('sign in → account page → sign out', async () => {
    const jar = new Jar();
    const { body } = await bootstrap(jar);
    const login = await post('/api/v1/auth/telegram', jar, body.data.csrfToken, signedPayload());
    expect(login.status === 200, `sign-in status ${login.status}`);
    jar.absorb(login);
    const session = login.headers.getSetCookie().find((c) => c.startsWith('__Host-tga_session='));
    expect(session && /; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000; Secure$/.test(session), 'session cookie attributes');
    const { data } = await login.json();

    const account = await req('/account', { headers: { cookie: jar.header() } });
    expect(account.status === 200, `/account status ${account.status}`);
    const html = await account.text();
    expect(html.includes('E2E Tester') && html.includes('@tga_e2e_tester'), 'account shows the user');
    expect(html.includes('href="/account"'), 'nav shows the account link');

    const out = await post('/api/v1/auth/logout', jar, data.csrfToken, {});
    expect(out.status === 200, `sign-out status ${out.status}`);
    jar.absorb(out);
    const after = await req('/account', { headers: { cookie: jar.header() } });
    expect(after.status >= 300 && after.status < 400 && (after.headers.get('location') ?? '').includes('/login'), `after sign-out /account should redirect, got ${after.status}`);
  });

  await check('authorization (PHASE-17): A cannot end B\'s session (404); non-admins get 403 on admin APIs', async () => {
    async function signInAs(id, first) {
      const jar = new Jar();
      const { body } = await bootstrap(jar);
      const res = await post('/api/v1/auth/telegram', jar, body.data.csrfToken, signedPayload({ id, first_name: first, username: `tga_e2e_${id}` }));
      expect(res.status === 200, `sign-in ${id}: ${res.status}`);
      jar.absorb(res);
      const { data } = await res.json();
      return { jar, csrf: data.csrfToken, userId: data.user.id };
    }
    const a = await signInAs(999000001, 'E2E');
    const b = await signInAs(999000002, 'Other');
    try {
      const list = await req('/api/v1/auth/sessions', { headers: { cookie: b.jar.header() } });
      expect(list.status === 200, `B lists own sessions: ${list.status}`);
      const bSession = (await list.json()).data.find((s) => s.current).id;
      const idor = await req(`/api/v1/auth/sessions/${bSession}`, { method: 'DELETE', headers: { origin, cookie: a.jar.header(), 'x-csrf-token': a.csrf } });
      expect(idor.status === 404, `A ending B's session must be 404, got ${idor.status}`);
      const stillIn = await req('/api/v1/auth/sessions', { headers: { cookie: b.jar.header() } });
      expect(stillIn.status === 200, 'B must still be signed in');
      const admin = await req(`/api/v1/admin/users/${b.userId}/roles`, { headers: { cookie: a.jar.header() } });
      expect(admin.status === 403, `non-admin on admin API must be 403, got ${admin.status}`);
      expect((await req(`/api/v1/admin/users/${b.userId}/roles`)).status === 401, 'anonymous admin API must be 401');
    } finally {
      await post('/api/v1/auth/logout', a.jar, a.csrf, {});
      await post('/api/v1/auth/logout', b.jar, b.csrf, {});
    }
  });

  await check('open redirects are refused on /login?next=', async () => {
    const jar = new Jar();
    const { body } = await bootstrap(jar);
    const login = await post('/api/v1/auth/telegram', jar, body.data.csrfToken, signedPayload());
    jar.absorb(login);
    for (const next of ['https://evil.example/', '//evil.example/', '/\\evil.example']) {
      const res = await req(`/login?next=${encodeURIComponent(next)}`, { headers: { cookie: jar.header() } });
      const loc = res.headers.get('location') ?? '';
      expect(res.status >= 300 && res.status < 400 && loc.endsWith('/account'), `next=${next} redirected to ${loc}`);
    }
    const { data } = await login.json();
    await post('/api/v1/auth/logout', jar, data.csrfToken, {});
  });
}

for (const [name, outcome] of results) console.log(`${outcome === 'ok' ? 'PASS' : 'FAIL'}  ${name}${outcome === 'ok' ? '' : ` — ${outcome}`}`);
process.exit(results.every(([, o]) => o === 'ok') ? 0 : 1);
