// Public web E2E (PHASE-13): visits every public route through the edge and checks status,
// key content, states, robots and leaks. Read-only; no JavaScript execution (server HTML).
//   node scripts/e2e/public-routes.mjs <baseUrl> --channel <collected username> [--rankings on|off] [--search on|off]
const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:\/\//.test(a)) ?? 'http://127.0.0.1:8080').replace(/\/+$/, '');
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const channel = opt('--channel', undefined);
const rankingsOn = opt('--rankings', 'off') === 'on';
const searchOn = opt('--search', 'on') === 'on';
if (!channel) throw new Error('--channel <username> is required (an allow-listed, collected channel)');

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
async function page(path) {
  const res = await fetch(base + path, { redirect: 'manual', signal: AbortSignal.timeout(15_000), headers: { accept: 'text/html' } });
  return { status: res.status, headers: res.headers, html: res.status >= 300 && res.status < 400 ? '' : await res.text() };
}
function common(p, path) {
  expect(/<meta name="robots" content="noindex, nofollow"/.test(p.html), `${path}: missing noindex meta`);
  expect(/<meta name="viewport" content="width=device-width, initial-scale=1"/.test(p.html), `${path}: missing viewport meta`);
  expect(!/api:3001|127\.0\.0\.1:3001|API_INTERNAL_URL/.test(p.html), `${path}: internal API address leaked`);
}
const ok = async (path, ...needles) => {
  const p = await page(path);
  expect(p.status === 200, `${path}: status ${p.status}`);
  common(p, path);
  for (const n of needles) expect(n instanceof RegExp ? n.test(p.html) : p.html.includes(n), `${path}: missing ${n}`);
  return p;
};
const missing = async (path) => {
  const p = await page(path);
  expect(p.status === 404, `${path}: expected 404, got ${p.status}`);
};

await check('home: search form, methodology link', () => ok('/', 'role="search"', 'href="/docs"'));
await check('methodology lists metric definitions', () => ok('/docs', 'Methodology', 'Subscribers', 'Missing data'));
await check(`channel page: identity → metrics → chart → posts → freshness`, async () => {
  const p = await ok(`/channel/${channel}`, `@${channel}`, 'Subscribers', 'Post analytics and recent posts are not available yet', 'Data freshness');
  const order = ['id="metrics"', 'id="posts"', 'id="freshness"'].map((s) => p.html.indexOf(s));
  expect(order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1])), 'sections out of order');
  expect(/<svg[^>]+role="img"/.test(p.html) || p.html.includes('No subscriber history'), 'chart (or empty state) not rendered');
});
await check('statistics page: range tabs, chart and data table', async () => {
  await ok(`/channel/${channel}/statistics`, 'aria-current="page"', 'Show data table');
  await ok(`/channel/${channel}/statistics?days=7`, '7 days');
  await ok(`/channel/${channel}/statistics?days=999`); // unsupported window falls back
});
await check('posts page: honest unavailable state, not an empty list', () => ok(`/channel/${channel}/posts`, 'Post data is not available yet'));
await check('unknown channel sub-routes are real 404s', async () => {
  await missing('/channel/zz_unknown_zz');
  await missing('/channel/zz_unknown_zz/statistics');
  await missing('/channel/zz_unknown_zz/posts');
});
if (searchOn) {
  await check('search: results, empty and invalid states', async () => {
    await ok(`/search?q=${encodeURIComponent(channel.slice(0, 4))}`, `/channel/${channel}`);
    await ok('/search?q=zzqqxxnomatch', 'No public channels or groups match');
    await ok('/search?q=a', 'That search could not be run');
    await ok('/search', 'Search by channel or group name');
  });
  await check('channels browse and filters', async () => {
    await ok('/channels', `/channel/${channel}`);
    await ok('/channels?type=group&minMembers=999999999999', 'No channels match these filters');
  });
} else {
  await check('search and browse are 404 while search.public is off', async () => {
    await missing('/search?q=tele');
    await missing('/channels');
  });
}
if (rankingsOn) {
  await check('rankings: tabs, methodology, disclaimer', () => ok('/rankings', 'aria-label="Rankings"', 'How this ranking is calculated', 'not an official Telegram ranking'));
  await check('trending: labelled as a calculated signal', () => ok('/trending', 'Not official Telegram data', 'How this ranking is calculated'));
  await check('nav shows rankings', () => ok('/', 'href="/rankings"'));
} else {
  await check('rankings and trending are 404 until OD-015 is approved', async () => {
    await missing('/rankings');
    await missing('/trending');
    const home = await page('/');
    expect(!home.html.includes('href="/rankings"'), 'nav links to disabled rankings');
  });
}
await check('deferred routes are not published (pricing, categories)', async () => {
  await missing('/pricing');
  await missing('/channels/news');
  await missing('/rankings/news');
});

for (const [name, outcome] of results) console.log(`${outcome === 'ok' ? 'PASS' : 'FAIL'}  ${name}${outcome === 'ok' ? '' : ` — ${outcome}`}`);
process.exit(results.every(([, o]) => o === 'ok') ? 0 : 1);
