import { createDatabase, type Database } from '../src';
import { testDatabaseUrl } from './global-setup';

export function testDb(): Database {
  return createDatabase({ url: testDatabaseUrl(), poolMax: 2 });
}

/** Clears mutable tables between tests. audit_logs is append-only and is never truncated. */
export async function resetTables(db: Database): Promise<void> {
  await db.$executeRawUnsafe(
    'TRUNCATE post_media, posts, channel_categories, categories, channel_aliases, channels, ' +
      'dead_letter_jobs, job_attempts, jobs, feature_flags, system_settings RESTART IDENTITY CASCADE',
  );
}

let telegramIdSeq = 1_000n;

export async function makeChannel(
  db: Database,
  overrides: Partial<{ username: string | null; title: string; type: string; hiddenAt: Date | null }> = {},
) {
  telegramIdSeq += 1n;
  return db.channel.create({
    data: {
      telegramId: telegramIdSeq,
      type: overrides.type ?? 'channel',
      username: overrides.username === undefined ? `chan_${telegramIdSeq}` : overrides.username,
      title: overrides.title ?? `Channel ${telegramIdSeq}`,
      hiddenAt: overrides.hiddenAt ?? null,
    },
  });
}
