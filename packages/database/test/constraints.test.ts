import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { makeChannel, resetTables, testDb } from './helpers';

const db = testDb();

beforeEach(() => resetTables(db));
afterAll(() => db.$disconnect());

describe('catalog constraints', () => {
  it('generates UUID v7 primary keys', async () => {
    const c = await makeChannel(db);
    expect(c.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);
  });

  it('enforces one entity per Telegram ID and per current username', async () => {
    const c = await makeChannel(db, { username: 'unique_name' });
    await expect(
      db.channel.create({ data: { telegramId: c.telegramId, type: 'channel', title: 'dup' } }),
    ).rejects.toThrow();
    await expect(makeChannel(db, { username: 'unique_name' })).rejects.toThrow();
  });

  it.each([
    ['type outside channel|group', { type: 'bot' }],
    ['uppercase username', { username: 'BadName' }],
    ['username with @', { username: '@bad' }],
    ['empty title', { title: '' }],
  ])('rejects %s', async (_label, overrides) => {
    await expect(makeChannel(db, overrides)).rejects.toThrow();
  });

  it('rejects negative member counts and counts without an observation time', async () => {
    const c = await makeChannel(db);
    await expect(db.channel.update({ where: { id: c.id }, data: { memberCount: -1n, memberCountObservedAt: new Date() } })).rejects.toThrow();
    await expect(db.channel.update({ where: { id: c.id }, data: { memberCount: 10n } })).rejects.toThrow();
    await expect(db.channel.update({ where: { id: c.id }, data: { memberCount: 10n, memberCountObservedAt: new Date() } })).resolves.toBeTruthy();
  });

  it('rejects invalid status values', async () => {
    const c = await makeChannel(db);
    await expect(db.channel.update({ where: { id: c.id }, data: { status: 'gone' } })).rejects.toThrow();
    await expect(db.channel.update({ where: { id: c.id }, data: { collectionStatus: 'maybe' } })).rejects.toThrow();
  });

  it('restricts deleting a channel that still has posts (history is kept)', async () => {
    const c = await makeChannel(db);
    await db.post.create({ data: { channelId: c.id, telegramMessageId: 1n, postedAt: new Date() } });
    await expect(db.channel.delete({ where: { id: c.id } })).rejects.toThrow();
  });

  it('rejects edits dated before the post and invalid media rows', async () => {
    const c = await makeChannel(db);
    const posted = new Date('2026-05-01T00:00:00Z');
    await expect(
      db.post.create({ data: { channelId: c.id, telegramMessageId: 1n, postedAt: posted, editedAt: new Date('2026-04-01T00:00:00Z') } }),
    ).rejects.toThrow();
    const p = await db.post.create({ data: { channelId: c.id, telegramMessageId: 2n, postedAt: posted } });
    await expect(db.postMedia.create({ data: { postId: p.id, position: -1, mediaType: 'photo' } })).rejects.toThrow();
    await expect(db.postMedia.create({ data: { postId: p.id, position: 0, mediaType: 'photo', sizeBytes: -5n } })).rejects.toThrow();
  });
});

describe('job ledger constraints', () => {
  it('rejects unknown failure classes on attempts and dead letters', async () => {
    const job = await db.job.create({
      data: { queue: 'q', type: 't', idempotencyKey: 'k', payloadVersion: 1, payload: {}, maxAttempts: 3 },
    });
    await expect(db.jobAttempt.create({ data: { jobId: job.id, attempt: 1, startedAt: new Date(), errorClass: 'oops' } })).rejects.toThrow();
    await expect(db.deadLetterJob.create({ data: { jobId: job.id, errorClass: 'oops' } })).rejects.toThrow();
    await expect(db.deadLetterJob.create({ data: { jobId: job.id, errorClass: 'permanent' } })).resolves.toBeTruthy();
    await expect(db.deadLetterJob.create({ data: { jobId: job.id, errorClass: 'permanent' } })).rejects.toThrow();
  });
});
