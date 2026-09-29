import { type Observed, TelegramError, type TelegramEntity } from '@tga/adapter-telegram';
import type { ChannelRepository, UpsertResult } from '@tga/database';
import { JobError } from '@tga/queues';
import type { FailureClass } from '@tga/types';

export interface EntitySource {
  resolvePublicEntity(username: string): Promise<Observed<TelegramEntity>>;
}

export interface MetadataDeps {
  channels: ChannelRepository;
  telegram: EntitySource;
}

/**
 * channel.metadata collector: refresh title/description/username via the canonical-identity
 * upsert (aliases, stale-observation guard). If the stored username now belongs to a
 * different Telegram entity, the channel is marked inaccessible instead of being merged.
 */
export async function refreshMetadata(deps: MetadataDeps, channelId: string): Promise<UpsertResult> {
  const channel = await deps.channels.findById(channelId);
  if (!channel) throw new JobError('permanent', 'channel_not_found', 'Channel no longer exists');
  if (!channel.username) throw new JobError('permanent', 'no_public_username', 'Channel has no current public username');

  let observed: Observed<TelegramEntity>;
  try {
    observed = await deps.telegram.resolvePublicEntity(channel.username);
  } catch (error) {
    const rateLimited = (error as { failureClass?: unknown }).failureClass === 'rate_limited';
    const failureClass = (error as { failureClass?: FailureClass }).failureClass ?? 'unknown';
    if (!rateLimited) await deps.channels.recordCollectionFailure(channelId, failureClass);
    if (error instanceof TelegramError && (error.code === 'chat_not_found' || error.code === 'not_public')) {
      await deps.channels.markStatus(channelId, error.code === 'not_public' ? 'not_public' : 'inaccessible');
    }
    throw error;
  }

  const entity = observed.value;
  if (entity.telegramId !== channel.telegramId) {
    await deps.channels.markStatus(channelId, 'inaccessible');
    throw new JobError('permanent', 'username_reassigned', 'Stored username now belongs to a different Telegram entity');
  }

  return deps.channels.upsertFromTelegram({
    telegramId: entity.telegramId,
    type: entity.type,
    username: entity.username,
    title: entity.title,
    description: entity.description,
    ...(entity.isVerified === undefined ? {} : { isVerified: entity.isVerified }),
    ...(entity.isScam === undefined ? {} : { isScam: entity.isScam }),
    observedAt: observed.observedAt,
  });
}
