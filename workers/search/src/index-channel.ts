import type { ChannelRepository } from '@tga/database';
import type { SearchIndex } from '@tga/types';

export interface IndexDeps {
  channels: Pick<ChannelRepository, 'searchSource'>;
  index: Pick<SearchIndex, 'upsertChannel' | 'removeChannel'>;
}

export type IndexResult = 'indexed' | 'stale' | 'removed';

/**
 * search.index handler (QUEUE-ARCHITECTURE: entity_id + entity version). Public, active,
 * visible channels are (re)indexed; anything else is removed. Queries re-check visibility
 * against `channels`, so removal is housekeeping, not the only safeguard.
 */
export async function indexChannel(deps: IndexDeps, channelId: string): Promise<IndexResult> {
  const source = await deps.channels.searchSource(channelId);
  const channel = source?.channel;
  if (!source || !channel?.username || channel.hiddenAt || channel.status !== 'active') {
    await deps.index.removeChannel(channelId);
    return 'removed';
  }
  return deps.index.upsertChannel({
    channelId,
    username: channel.username,
    aliases: source.aliases,
    title: channel.title,
    description: channel.description,
    sourceVersion: channel.updatedAt,
  });
}
