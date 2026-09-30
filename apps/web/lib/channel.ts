import 'server-only';
import { notFound, permanentRedirect } from 'next/navigation';
import { cache } from 'react';
import { type ChannelView, fetchChannel } from './api';

/** One API call per request, shared by generateMetadata and the page. */
export const loadChannel = cache(fetchChannel);

/**
 * Resolves a channel for an entity route. Called from generateMetadata so a missing entity is
 * a real 404 before streaming starts (UI-UX.md), and old usernames redirect permanently.
 */
export async function requireChannel(username: string, subpath = ''): Promise<ChannelView> {
  const result = await loadChannel(username);
  if (result.kind === 'not_found') notFound();
  if (result.view.requestedAlias) permanentRedirect(`/channel/${result.view.username}${subpath}`);
  return result.view;
}
