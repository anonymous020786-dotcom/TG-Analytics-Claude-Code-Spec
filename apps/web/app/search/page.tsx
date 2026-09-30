import type { Metadata } from 'next';
import { assertListAvailable, FilterFields, ListResults } from '../../components/ListPage';
import { SearchBox } from '../../components/SearchBox';
import { pageMetadata } from '../../lib/seo';
import { type ListQuery, parseListQuery, type SearchParams } from '../../lib/params';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<SearchParams> };

/** Without q, a members browse probes availability (same cached call the page would not need). */
const probe = (query: ListQuery): ListQuery => (query.q ? query : { sort: 'members' });

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const query = parseListQuery(await searchParams);
  await assertListAvailable(probe(query));
  return pageMetadata({
    title: query.q ? `Search: ${query.q}` : 'Search',
    description: 'Search public Telegram channels and groups by name, @username or keyword.',
    path: '/search',
    indexable: false, // internal search results are never indexed (SEO.md: no thin pages)
  });
}

export default async function SearchPage({ searchParams }: Props) {
  const query = parseListQuery(await searchParams);
  // Page-level gate too (metadata is streamed): /search without q renders no ListResults.
  await assertListAvailable(probe(query));
  return (
    <main id="main" className="wrap">
      <h1>Search</h1>
      <form action="/search" method="get" className="form" role="search">
        <SearchBox defaultValue={query.q ?? ''} />
        <FilterFields query={query} />
        <label>
          Sort
          <select name="sort" defaultValue={query.sort ?? ''}>
            <option value="">Best match</option>
            <option value="members">Most subscribers</option>
          </select>
        </label>
        <button type="submit">Search</button>
      </form>
      {query.q ? (
        <ListResults basePath="/search" query={query} emptyText="No public channels or groups match. Try a shorter word or the @username." />
      ) : (
        <p className="muted">Search by channel or group name, @username or a keyword from its description (2 to 64 characters).</p>
      )}
    </main>
  );
}
