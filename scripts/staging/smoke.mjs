// Staging smoke test (PHASE-11B). Read-only HTTP checks against the staging entry point.
//   node scripts/staging/smoke.mjs [baseUrl] [--channel <allow-listed username>]
// With --channel, the channel page flag must be on and the channel collected.
const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:\/\//.test(a)) ?? 'http://127.0.0.1:8080').replace(/\/+$/, '');
const channel = args.includes('--channel') ? args[args.indexOf('--channel') + 1] : undefined;
const results = [];

async function check(name, fn) {
  try {
    await fn();
    results.push([name, 'ok']);
  } catch (error) {
    results.push([name, `FAIL: ${error instanceof Error ? error.message : String(error)}`]);
  }
}
const get = (p, init = {}) => fetch(base + p, { redirect: 'manual', signal: AbortSignal.timeout(10_000), ...init });
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

await check('health', async () => {
  const r = await get('/health/live');
  expect(r.status === 200, `status ${r.status}`);
  expect((await r.json()).status === 'ok', 'body');
});
await check('security headers + no server version', async () => {
  const r = await get('/health/live');
  for (const h of ['x-content-type-options', 'x-frame-options', 'referrer-policy', 'x-robots-tag']) expect(r.headers.get(h), `missing ${h}`);
  expect(!/\d/.test(r.headers.get('server') ?? ''), 'server header leaks a version');
  expect(!r.headers.get('x-powered-by'), 'x-powered-by present');
});
await check('request id propagated', async () => {
  const r = await get('/api/v1/channels/zz_unknown_zz');
  expect(/^[A-Za-z0-9-]{8,64}$/.test(r.headers.get('x-request-id') ?? ''), 'no request id');
});
await check('robots.txt disallows all', async () => {
  const r = await get('/robots.txt');
  expect((await r.text()).includes('Disallow: /'), 'robots.txt');
});
await check('unknown channel is a real 404 (API and page)', async () => {
  expect((await get('/api/v1/channels/zz_unknown_zz')).status === 404, 'api');
  expect((await get('/channel/zz_unknown_zz')).status === 404, 'page');
});
await check('invalid username is 400', async () => {
  expect((await get(`/api/v1/channels/${encodeURIComponent("x'; drop")}`)).status === 400, 'status');
});
if (channel) {
  await check(`channel ${channel}: API data with freshness`, async () => {
    const r = await get(`/api/v1/channels/${channel}`);
    expect(r.status === 200, `status ${r.status} (flag on? collected?)`);
    const d = (await r.json()).data;
    expect(d.username === channel && d.members && d.quality?.verdict, 'fields');
  });
  await check(`channel ${channel}: page renders`, async () => {
    const r = await get(`/channel/${channel}`);
    expect(r.status === 200, `status ${r.status}`);
    expect((await r.text()).includes('not official Telegram statistics'), 'disclaimer');
  });
}

for (const [name, outcome] of results) console.log(`${outcome === 'ok' ? 'PASS' : 'FAIL'}  ${name}${outcome === 'ok' ? '' : ` — ${outcome}`}`);
process.exit(results.every(([, o]) => o === 'ok') ? 0 : 1);
