import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AuditLogRepository,
  ChannelRepository,
  FeatureFlagRepository,
  InvalidCursorError,
  JobRepository,
  MAX_PAGE_SIZE,
  PostRepository,
} from '../src';
import { makeChannel, resetTables, testDb } from './helpers';

const db = testDb();
const channels = new ChannelRepository(db);
const posts = new PostRepository(db);
const jobs = new JobRepository(db);
const audit = new AuditLogRepository(db);
const flags = new FeatureFlagRepository(db);

beforeEach(() => resetTables(db));
afterAll(() => db.$disconnect());

describe('ChannelRepository', () => {
  it('finds by id, Telegram ID and current username (normalized)', async () => {
    const c = await makeChannel(db, { username: 'tech_news' });

    expect((await channels.findById(c.id))?.id).toBe(c.id);
    expect((await channels.findByTelegramId(c.telegramId))?.id).toBe(c.id);
    expect((await channels.findByUsername('@Tech_News'))?.id).toBe(c.id);
    expect(await channels.findByUsername('missing')).toBeNull();
  });

  it('resolves a previous username through aliases', async () => {
    const c = await makeChannel(db, { username: 'new_name' });
    const t = new Date('2026-01-01T00:00:00Z');
    await db.channelAlias.create({ data: { channelId: c.id, username: 'old_name', firstSeenAt: t, lastSeenAt: t } });

    expect((await channels.findByUsername('old_name'))?.id).toBe(c.id);
  });

  it('walks every visible channel exactly once and hides moderated ones', async () => {
    const created = [];
    for (let i = 0; i < 7; i += 1) created.push(await makeChannel(db));
    await makeChannel(db, { hiddenAt: new Date() });

    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await channels.list({ limit: 3, ...(cursor ? { cursor } : {}) });
      expect(page.items.length).toBeLessThanOrEqual(3);
      seen.push(...page.items.map((x) => x.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);

    expect(seen).toEqual(created.map((c) => c.id).sort());
    expect((await channels.list({ includeHidden: true, limit: 50 })).items).toHaveLength(8);
  });

  it('caps page size and rejects tampered cursors', async () => {
    expect((await channels.list({ limit: 10_000 })).items.length).toBeLessThanOrEqual(MAX_PAGE_SIZE);
    await expect(channels.list({ cursor: 'garbage!' })).rejects.toBeInstanceOf(InvalidCursorError);
  });
});

describe('PostRepository', () => {
  it('pages newest-first with stable ties and no duplicates', async () => {
    const c = await makeChannel(db);
    const same = new Date('2026-03-01T12:00:00Z');
    for (let i = 1; i <= 5; i += 1) {
      await db.post.create({
        data: { channelId: c.id, telegramMessageId: BigInt(i), postedAt: i <= 3 ? same : new Date(Date.UTC(2026, 2, i)) },
      });
    }

    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await posts.listByChannel({ channelId: c.id, limit: 2, ...(cursor ? { cursor } : {}) });
      ids.push(...page.items.map((p) => p.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);

    const all = await db.post.findMany({ where: { channelId: c.id }, orderBy: [{ postedAt: 'desc' }, { id: 'desc' }] });
    expect(ids).toEqual(all.map((p) => p.id));
    expect(new Set(ids).size).toBe(5);
  });

  it('rejects a duplicate Telegram message for the same channel', async () => {
    const c = await makeChannel(db);
    const data = { channelId: c.id, telegramMessageId: 42n, postedAt: new Date() };
    await db.post.create({ data });
    await expect(db.post.create({ data })).rejects.toThrow();
  });
});

describe('JobRepository', () => {
  const input = { queue: 'channel.metrics', type: 'collect', idempotencyKey: 'c1:2026-01-01', payloadVersion: 1, payload: { entityId: 'c1' }, maxAttempts: 5 };

  it('enqueues idempotently on (queue, idempotencyKey)', async () => {
    const first = await jobs.enqueue(input);
    const second = await jobs.enqueue({ ...input, payload: { entityId: 'different' } });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.job.id).toBe(first.job.id);
    expect(await db.job.count()).toBe(1);
  });

  it('allows the same key on a different queue', async () => {
    await jobs.enqueue(input);
    expect((await jobs.enqueue({ ...input, queue: 'channel.posts' })).created).toBe(true);
  });

  it('rejects unbounded or invalid retry settings', async () => {
    await expect(jobs.enqueue({ ...input, idempotencyKey: 'a', maxAttempts: 0 })).rejects.toThrow();
    await expect(jobs.enqueue({ ...input, idempotencyKey: 'b', payloadVersion: 0 })).rejects.toThrow();
    const { job } = await jobs.enqueue({ ...input, idempotencyKey: 'c' });
    await expect(db.job.update({ where: { id: job.id }, data: { attempt: 6 } })).rejects.toThrow();
    await expect(db.job.update({ where: { id: job.id }, data: { status: 'exploded' } })).rejects.toThrow();
  });
});

describe('AuditLogRepository', () => {
  it('appends entries', async () => {
    const entry = await audit.append({ actorType: 'system', action: 'test.appended', targetType: 'channel', targetId: 'x', metadata: { a: 1 } });
    expect(entry.action).toBe('test.appended');
  });

  it('is append-only: UPDATE, DELETE and TRUNCATE are rejected by the database', async () => {
    const entry = await audit.append({ actorType: 'system', action: 'test.immutable' });

    await expect(db.auditLog.update({ where: { id: entry.id }, data: { action: 'tampered' } })).rejects.toThrow(/append-only/);
    await expect(db.auditLog.delete({ where: { id: entry.id } })).rejects.toThrow(/append-only/);
    await expect(db.$executeRawUnsafe('TRUNCATE audit_logs')).rejects.toThrow(/append-only/);
    expect((await db.auditLog.findUnique({ where: { id: entry.id } }))?.action).toBe('test.immutable');
  });

  it('rejects unknown actor types', async () => {
    await expect(db.auditLog.create({ data: { actorType: 'root', action: 'x' } })).rejects.toThrow();
  });
});

describe('FeatureFlagRepository', () => {
  it('fails closed for unknown flags and toggles known ones', async () => {
    expect(await flags.isEnabled('collector.mtproto')).toBe(false);
    await flags.set('collector.mtproto', true, 'MTProto collector');
    expect(await flags.isEnabled('collector.mtproto')).toBe(true);
    await flags.set('collector.mtproto', false);
    expect(await flags.isEnabled('collector.mtproto')).toBe(false);
  });
});
