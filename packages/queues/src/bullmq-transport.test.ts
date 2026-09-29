import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { BullTransport } from './bullmq-transport';

const redisUrl = process.env.TEST_REDIS_URL;
if (!redisUrl) throw new Error('TEST_REDIS_URL is required for the BullMQ transport integration test');

// Unique prefix per run: never touches other keys; obliterated afterwards.
const transport = new BullTransport({ redisUrl, prefix: `tga-test-${randomUUID()}` });
const QUEUE = 'channel.metrics';

afterAll(async () => {
  await transport.obliterate(QUEUE);
  await transport.close();
});

describe('BullTransport (real Redis)', () => {
  it('delivers pushed ledger ids to a consumer, deduplicating by ledger id', async () => {
    const received: string[] = [];
    const ids = [randomUUID(), randomUUID()];
    const done = new Promise<void>((resolve) => {
      const consumer = transport.consume(QUEUE, 2, async (id) => {
        received.push(id);
        if (received.length >= 2) setTimeout(() => void consumer.close().then(resolve), 300);
      });
    });

    await transport.push(QUEUE, ids[0]!);
    await transport.push(QUEUE, ids[0]!); // duplicate push while waiting: no-op
    await transport.push(QUEUE, ids[1]!);
    await done;

    expect([...received].sort()).toEqual([...ids].sort());
  }, 20_000);
});
