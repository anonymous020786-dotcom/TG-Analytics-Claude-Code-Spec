import { type Observed, TelegramError, type TelegramEntity } from '@tga/adapter-telegram';
import { ChannelRepository, createDatabase, JobRepository } from '@tga/database';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiscoveryService, type PublicEntityResolver } from './discovery-service';

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) {
  throw new Error('TEST_DATABASE_URL (a *_test database migrated by @tga/database tests) is required');
}
const db = createDatabase({ url, poolMax: 2 });
const channels = new ChannelRepository(db);
const jobs = new JobRepository(db);

const at = new Date('2026-09-29T00:00:00Z');
const telegram: TelegramEntity = {
  telegramId: -1001005640892n,
  type: 'channel',
  username: 'telegram',
  activeUsernames: ['telegram'],
  title: 'Telegram News',
  description: 'Official news',
};

function resolverReturning(...results: (TelegramEntity | TelegramError)[]): PublicEntityResolver & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    resolvePublicEntity: vi.fn(async (username: string): Promise<Observed<TelegramEntity>> => {
      calls.push(username);
      const next = results.shift();
      if (!next) throw new Error('unexpected call');
      if (next instanceof TelegramError) throw next;
      return { value: next, observedAt: at, source: 'bot_api' };
    }),
  };
}

beforeAll(async () => {
  // Schema is created by @tga/database's test harness; make sure it is present.
  await db.$queryRawUnsafe('SELECT 1 FROM channels LIMIT 1');
});
beforeEach(async () => {
  await db.$executeRawUnsafe('TRUNCATE channel_aliases, channels, dead_letter_jobs, job_attempts, jobs RESTART IDENTITY CASCADE');
});
afterAll(() => db.$disconnect());

describe('DiscoveryService', () => {
  it('normalizes a link, resolves, upserts and schedules follow-up jobs', async () => {
    const resolver = resolverReturning(telegram);
    const svc = new DiscoveryService(resolver, channels, jobs);

    const out = await svc.discover('https://t.me/s/Telegram', { traceId: 'trace-1' });

    expect(resolver.calls).toEqual(['telegram']);
    expect(out).toMatchObject({ status: 'indexed', username: 'telegram', created: true, scheduled: ['channel.metadata', 'channel.metrics', 'search.index'] });
    const queued = await db.job.findMany({ orderBy: { queue: 'asc' } });
    expect(queued.map((j) => j.queue)).toEqual(['channel.metadata', 'channel.metrics', 'search.index']);
    expect(queued.every((j) => j.traceId === 'trace-1' && j.maxAttempts === 5 && j.status === 'queued')).toBe(true);
  });

  it('does not schedule channel.posts until the MTProto capability is verified', async () => {
    const out = await new DiscoveryService(resolverReturning(telegram), channels, jobs, { postsEnabled: true }).discover('telegram');
    expect(out.status === 'indexed' && out.scheduled).toContain('channel.posts');
  });

  it('is idempotent: rediscovery converges on the same channel and schedules nothing new', async () => {
    const svc = new DiscoveryService(resolverReturning(telegram, telegram), channels, jobs);
    const first = await svc.discover('@telegram');
    const second = await svc.discover('t.me/telegram');

    expect(first.status === 'indexed' && second.status === 'indexed' && first.channelId === second.channelId).toBe(true);
    expect(second).toMatchObject({ created: false, scheduled: [] });
    expect(await db.channel.count()).toBe(1);
    expect(await db.job.count()).toBe(3);
  });

  it('rejects invalid, invite and private references without calling Telegram', async () => {
    const resolver = resolverReturning();
    const svc = new DiscoveryService(resolver, channels, jobs);

    expect(await svc.discover('https://t.me/+AbCdEf')).toEqual({ status: 'rejected', reason: 'invite_link' });
    expect(await svc.discover('https://t.me/c/123/4')).toEqual({ status: 'rejected', reason: 'private_link' });
    expect(await svc.discover('http://169.254.169.254/')).toEqual({ status: 'rejected', reason: 'not_telegram_host' });
    expect(resolver.calls).toEqual([]);
    expect(await db.channel.count()).toBe(0);
  });

  it('rejects non-public entities and does not store them', async () => {
    const svc = new DiscoveryService(resolverReturning(new TelegramError('permanent', 'not_public', 'x')), channels, jobs);
    expect(await svc.discover('someone_private')).toEqual({ status: 'rejected', reason: 'not_public' });
    expect(await db.channel.count()).toBe(0);
    expect(await db.job.count()).toBe(0);
  });

  it('marks a known channel inaccessible when its username stops resolving, keeping history', async () => {
    const notFound = new TelegramError('invalid_input', 'chat_not_found', 'Bad Request: chat not found');
    const svc = new DiscoveryService(resolverReturning(telegram, notFound), channels, jobs);
    const first = await svc.discover('telegram');

    expect(await svc.discover('telegram')).toEqual({ status: 'rejected', reason: 'not_found' });
    const stored = await db.channel.findUniqueOrThrow({ where: { id: first.status === 'indexed' ? first.channelId : '' } });
    expect(stored.status).toBe('inaccessible');
  });

  it('rethrows retryable failures for the job layer (no silent swallow)', async () => {
    const limited = new TelegramError('rate_limited', 'too_many_requests', 'slow down', { retryAfterMs: 30_000 });
    const svc = new DiscoveryService(resolverReturning(limited), channels, jobs);
    await expect(svc.discover('telegram')).rejects.toBe(limited);
    expect(await db.channel.count()).toBe(0);
  });

  it('enforces the staging allow-list before calling Telegram', async () => {
    const resolver = resolverReturning(telegram);
    const svc = new DiscoveryService(resolver, channels, jobs, { allowlist: new Set(['telegram']) });
    expect(await svc.discover('t.me/durov')).toEqual({ status: 'rejected', reason: 'not_allowlisted' });
    expect(resolver.calls).toEqual([]);
    expect((await svc.discover('@Telegram')).status).toBe('indexed');
  });

  it('records a username change as an alias on rediscovery', async () => {
    const renamed: TelegramEntity = { ...telegram, username: 'telegram_news' };
    const svc = new DiscoveryService(resolverReturning(telegram, renamed), channels, jobs);
    await svc.discover('telegram');
    const out = await svc.discover('telegram_news');

    expect(out).toMatchObject({ status: 'indexed', created: false, previousUsername: 'telegram' });
    expect((await channels.findByUsername('telegram'))?.username).toBe('telegram_news');
  });
});
