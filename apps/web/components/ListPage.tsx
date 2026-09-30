import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { fetchChannelList } from '../lib/api';
import { type ListQuery, listQueryString } from '../lib/params';
import { ChannelList, EmptyState } from './ChannelList';

/**
 * One API call per request, shared by generateMetadata and the page (keyed by the serialized
 * query: React cache compares arguments by identity).
 */
export const loadList = cache((key: string) => fetchChannelList(JSON.parse(key) as ListQuery));

/**
 * Existence check for generateMetadata: a disabled search (flag off) is a real 404, decided
 * before the response starts streaming (UI-UX.md: no soft 404s).
 */
export async function assertListAvailable(query: ListQuery): Promise<void> {
  if ((await loadList(JSON.stringify(query))).kind === 'not_found') notFound();
}

/**
 * Shared results body for /search and /channels: filters are plain GET forms, pages follow
 * the API's opaque cursor ("Next page"; "Back to first page" restarts the walk).
 */
export async function ListResults({ basePath, query, emptyText }: { basePath: string; query: ListQuery; emptyText: string }) {
  const result = await loadList(JSON.stringify(query));
  if (result.kind === 'not_found') notFound(); // already handled in generateMetadata
  if (result.kind === 'invalid') {
    return (
      <div className="notice" role="alert">
        <p>That search could not be run: {result.message}.</p>
        <p>
          <Link href={basePath}>Start over</Link>
        </p>
      </div>
    );
  }

  const { items, nextCursor } = result.data;
  return (
    <>
      {items.length === 0 ? (
        <EmptyState>
          <p>{emptyText}</p>
        </EmptyState>
      ) : (
        <ChannelList label="Results" rows={items.map((c) => ({ key: c.id, ...c }))} />
      )}
      <nav className="pager" aria-label="Pagination">
        {query.cursor ? <Link href={`${basePath}${listQueryString(query, null)}`}>Back to first page</Link> : null}
        {nextCursor ? (
          <Link href={`${basePath}${listQueryString(query, nextCursor)}`} rel="next">
            Next page
          </Link>
        ) : null}
      </nav>
    </>
  );
}

export function FilterFields({ query }: { query: ListQuery }) {
  return (
    <>
      <label>
        Type
        <select name="type" defaultValue={query.type ?? ''}>
          <option value="">Channels and groups</option>
          <option value="channel">Channels</option>
          <option value="group">Groups</option>
        </select>
      </label>
      <label>
        Min subscribers
        <input name="minMembers" inputMode="numeric" pattern="[0-9]*" size={10} defaultValue={query.minMembers ?? ''} />
      </label>
      <label>
        Max subscribers
        <input name="maxMembers" inputMode="numeric" pattern="[0-9]*" size={10} defaultValue={query.maxMembers ?? ''} />
      </label>
    </>
  );
}
