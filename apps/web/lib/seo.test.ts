import { describe, expect, it } from 'vitest';
import { absoluteUrl, breadcrumbList, channelDescription, channelJsonLd, clampDescription, jsonLd, pageMetadata, robots, siteOrigin, sitemapXml } from './seo';

const O = 'https://tga.example';

describe('siteOrigin / absoluteUrl', () => {
  it('accepts an http(s) origin and rejects anything else', () => {
    expect(siteOrigin('https://tga.example/')).toBe(O);
    expect(siteOrigin(undefined)).toBe('http://127.0.0.1:3000');
    for (const bad of ['ftp://x.example', 'https://x.example/app', 'https://u:p@x.example', 'https://x.example/?a=1', 'javascript:alert(1)']) expect(() => siteOrigin(bad)).toThrow();
  });

  it('only builds site-relative URLs', () => {
    expect(absoluteUrl('/channel/telegram', O)).toBe(`${O}/channel/telegram`);
    expect(() => absoluteUrl('https://evil.example/x', O)).toThrow();
    expect(() => absoluteUrl('//evil.example/x', O)).toThrow();
  });
});

describe('robots / pageMetadata', () => {
  it('keeps non-indexable pages followable', () => {
    expect(robots(true)).toEqual({ index: true, follow: true });
    expect(robots(false)).toEqual({ index: false, follow: true });
  });

  it('sets canonical, Open Graph and Twitter from one source', () => {
    process.env.PUBLIC_SITE_URL = O;
    const m = pageMetadata({ title: 'T', description: 'D', path: '/docs', indexable: false });
    expect(m.alternates?.canonical).toBe(`${O}/docs`);
    expect(m.openGraph).toMatchObject({ title: 'T', description: 'D', url: `${O}/docs` });
    expect(m.twitter).toMatchObject({ card: 'summary', title: 'T' });
    delete process.env.PUBLIC_SITE_URL;
  });
});

describe('descriptions never fabricate data', () => {
  it('includes the count only when one was observed', () => {
    const base = { title: 'Telegram News', username: 'telegram', type: 'channel', description: null };
    expect(channelDescription({ ...base, members: { value: '9441662' } })).toContain('9,441,662 subscribers');
    const none = channelDescription({ ...base, members: null });
    expect(none).not.toMatch(/\d/);
    expect(none).toContain('public Telegram channel');
  });

  it('clamps long text at a word boundary', () => {
    const d = clampDescription(`${'word '.repeat(60)}end`);
    expect(d.length).toBeLessThanOrEqual(160);
    expect(d.endsWith('…')).toBe(true);
    expect(clampDescription('  short   text ')).toBe('short text');
  });
});

describe('jsonLd', () => {
  it('cannot be broken out of by untrusted text', () => {
    const out = jsonLd({ name: '</script><script>alert(1)</script>', x: 'a&b', l: '\u2028' });
    expect(out).not.toMatch(/<|>|&|\u2028/);
    expect(JSON.parse(out)).toEqual({ name: '</script><script>alert(1)</script>', x: 'a&b', l: '\u2028' });
  });

  it('builds breadcrumbs and a channel WebPage', () => {
    expect(breadcrumbList([{ name: 'Home', path: '/' }, { name: 'X', path: '/channel/x' }], O).itemListElement[1]).toEqual({ '@type': 'ListItem', position: 2, name: 'X', item: `${O}/channel/x` });
    const ld = channelJsonLd({ title: 'T', username: 'telegram', description: null, members: { observedAt: '2026-09-20T00:00:00.000Z' } }, '/channel/telegram', O);
    expect(ld).toMatchObject({ '@type': 'WebPage', dateModified: '2026-09-20T00:00:00.000Z', about: { sameAs: 'https://t.me/telegram' } });
  });
});

describe('sitemapXml', () => {
  it('escapes values and produces a valid empty urlset', () => {
    expect(sitemapXml([{ loc: `${O}/a?x=1&y=<2>` }])).toContain('<loc>https://tga.example/a?x=1&amp;y=&lt;2&gt;</loc>');
    expect(sitemapXml([])).toBe('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</urlset>\n');
  });
});
