import type { ChannelSearchDocumentInput } from '@tga/types';
import { PayloadError, parsePayload, QUEUES } from '@tga/queues';
import { describe, expect, it, vi } from 'vitest';
import { type IndexDeps, indexChannel } from './index-channel';

const updatedAt = new Date('2026-09-20T10:00:00Z');
const base = { id: 'c1', username: 'telegram', title: 'Telegram News', description: 'News', hiddenAt: null as Date | null, status: 'active', updatedAt };

function deps(channel: Partial<typeof base> | null, aliases: string[] = []) {
  const upserts: ChannelSearchDocumentInput[] = [];
  const removed: string[] = [];
  const d = {
    channels: { searchSource: vi.fn(async () => (channel ? { channel: { ...base, ...channel }, aliases } : null)) },
    index: {
      upsertChannel: vi.fn(async (doc: ChannelSearchDocumentInput) => (upserts.push(doc), 'indexed' as const)),
      removeChannel: vi.fn(async (id: string) => void removed.push(id)),
    },
  } as unknown as IndexDeps;
  return { d, upserts, removed };
}

describe('indexChannel', () => {
  it('indexes a visible channel with its previous usernames and source version', async () => {
    const { d, upserts } = deps({}, ['old_name']);
    expect(await indexChannel(d, 'c1')).toBe('indexed');
    expect(upserts).toEqual([{ channelId: 'c1', username: 'telegram', aliases: ['old_name'], title: 'Telegram News', description: 'News', sourceVersion: updatedAt }]);
  });

  it.each([
    ['missing', null],
    ['hidden', { hiddenAt: updatedAt }],
    ['not active', { status: 'inaccessible' }],
    ['no public username', { username: null as unknown as string }],
  ])('removes the document when the channel is %s', async (_label, channel) => {
    const { d, upserts, removed } = deps(channel);
    expect(await indexChannel(d, 'c1')).toBe('removed');
    expect(removed).toEqual(['c1']);
    expect(upserts).toEqual([]);
  });

  it('is safe to run twice (idempotent outcome)', async () => {
    const { d, upserts } = deps({});
    await indexChannel(d, 'c1');
    await indexChannel(d, 'c1');
    expect(upserts[0]).toEqual(upserts[1]);
  });
});

describe('search.index job contract', () => {
  // Regression (found in staging): the runtime rejects queues without a registered payload
  // schema, so every producer's payload must parse for the consumer.
  it('accepts the payload produced by discovery and metadata', () => {
    const channelId = '01a0edb6-3505-713b-bf9b-850e06d903f3';
    expect(parsePayload(QUEUES.search, 1, { channelId })).toEqual({ channelId });
  });

  it('rejects malformed payloads as invalid_input', () => {
    expect(() => parsePayload(QUEUES.search, 1, { channelId: 'nope' })).toThrow(PayloadError);
    expect(() => parsePayload(QUEUES.search, 1, { channelId: '01a0edb6-3505-713b-bf9b-850e06d903f3', extra: 1 })).toThrow(PayloadError);
  });
});
