// Public web E2E (PHASE-13): visits every public route through the edge and checks status,
// key content, states, robots and leaks. Read-only; no JavaScript execution (server HTML).
//   node scripts/e2e/public-routes.mjs <baseUrl> --channel <collected username> [--rankings on|off] [--search on|off] [--seo on|off]
const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:\/\//.test(a)) ?? 'http://127.0.0.1:8080').replace(/\/+$/, '');
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const channel = opt('--channel', undefined);
const rankingsOn = opt('--rankings', 'off') === 'on';
const searchOn = opt('--search', 'on') === 'on';
const seoOn = opt('--seo', 'off') === 'on';
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
const titles = new Map();
const robotsOf = (html) => /<meta name="robots" content="([^"]+)"/.exec(html)?.[1];
function common(p, path) {
  const robots = robotsOf(p.html);
  expect(robots, `${path}: missing robots meta`);
  if (!seoOn || p.status !== 200) expect(robots.startsWith('noindex'), `${path}: indexable while seo.indexing is off (${robots})`);
  expect(p.headers.get('x-robots-tag')?.includes('noindex'), `${path}: staging edge noindex header missing`);
  expect(/<meta name="viewport" content="width=device-width, initial-scale=1"/.test(p.html), `${path}: missing viewport meta`);
  expect(!/api:3001|127\.0\.0\.1:3001|API_INTERNAL_URL/.test(p.html), `${path}: internal API address leaked`);
}
const ok = async (path, ...needles) => {
  const p = await page(path);
  expect(p.status === 200, `${path}: status ${p.status}`);
  common(p, path);
  const title = /<title>([^<]*)<\/title>/.exec(p.html)?.[1];
  expect(title, `${path}: missing title`);
  const canonical = /<link rel="canonical" href="([^"]+)"/.exec(p.html)?.[1];
  if (canonical) {
    const prev = titles.get(title);
    expect(!prev || prev === canonical, `${path}: title "${title}" duplicates ${prev}`);
    titles.set(title, canonical);
  }
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
    await missing('/search'); // no query: must still be a real 404 (streamed metadata)
    await missing('/channels');
  });
}
if (rankingsOn) {
  await check('rankings: tabs, methodology, disclaimer', () => ok('/rankings', 'aria-label="Rankings"', 'How this ranking is calculated', 'not an official Telegram ranking'));
  await check('trending: labelled as a calculated signal', () => ok('/trending', 'Not official Telegram data', 'How this ranking is calculated'));
  await check('nav shows rankings', () => ok('/', 'href="/rankings"'));
} else {
  await check('rankings and trending are 404 while rankings.public is off', async () => {
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

await check('SEO metadata: canonical, description, Open Graph, Twitter on public pages', async () => {
  for (const path of ['/', '/docs', `/channel/${channel}`, `/channel/${channel}/statistics?days=7`, `/channel/${channel}/posts`, ...(searchOn ? ['/channels', '/search?q=tele'] : [])]) {
    const p = await page(path);
    expect(p.status === 200, `${path}: status ${p.status}`);
    for (const re of [/<link rel="canonical" href="https?:\/\/[^"]+"/, /<meta name="description" content="[^"]{20,}"/, /<meta property="og:title" content="[^"]+"/, /<meta property="og:url" content="https?:\/\/[^"]+"/, /<meta name="twitter:card" content="summary"/]) {
      expect(re.test(p.html), `${path}: missing ${re}`);
    }
  }
});
await check('canonicals drop query variants (days, cursor, filters)', async () => {
  const canon = async (path) => /<link rel="canonical" href="([^"]+)"/.exec((await page(path)).html)?.[1] ?? '';
  expect((await canon(`/channel/${channel}/statistics?days=90`)).endsWith(`/channel/${channel}/statistics`), 'statistics canonical keeps ?days');
  if (searchOn) expect((await canon('/channels?type=group')).endsWith('/channels'), 'channels canonical keeps filters');
});
await check('JSON-LD parses: WebSite (home), WebPage + BreadcrumbList (channel)', async () => {
  const ld = async (path) => [...(await page(path)).html.matchAll(/<script type="application\/ld\+json">([^<]*)<\/script>/g)].map((m) => JSON.parse(m[1])['@type']);
  expect((await ld('/')).includes('WebSite'), 'home WebSite missing');
  const types = await ld(`/channel/${channel}`);
  expect(types.includes('WebPage') && types.includes('BreadcrumbList'), `channel JSON-LD: ${types}`);
});
await check(`robots decisions (seo.indexing ${seoOn ? 'on' : 'off'})`, async () => {
  const r = async (path) => robotsOf((await page(path)).html);
  expect((await r('/search?q=tele')).startsWith('noindex'), '/search must never be indexed');
  expect((await r(`/channel/${channel}/posts`)).startsWith('noindex'), 'posts must not be indexed');
  if (seoOn) {
    expect((await r('/')) === 'index, follow', 'home should be indexable');
    expect((await r('/docs')) === 'index, follow', 'docs should be indexable');
    if (searchOn) expect((await r('/channels?type=group')).startsWith('noindex'), 'filtered browse must not be indexed');
  }
});
await check('sitemap.xml is valid and lists only indexable pages', async () => {
  const res = await fetch(base + '/sitemap.xml', { signal: AbortSignal.timeout(15_000) });
  expect(res.status === 200 && /xml/.test(res.headers.get('content-type') ?? ''), `sitemap status ${res.status}`);
  const xml = await res.text();
  expect(xml.startsWith('<?xml') && xml.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'), 'not a sitemap');
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  if (!seoOn) expect(locs.length === 0, `sitemap not empty while indexing is off (${locs.length})`);
  else expect(locs.some((l) => l.endsWith('/docs')) && !locs.some((l) => l.includes('/search')), 'sitemap content');
});

for (const [name, outcome] of results) console.log(`${outcome === 'ok' ? 'PASS' : 'FAIL'}  ${name}${outcome === 'ok' ? '' : ` — ${outcome}`}`);
process.exit(results.every(([, o]) => o === 'ok') ? 0 : 1);
