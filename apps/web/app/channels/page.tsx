import type { Metadata } from 'next';
import { assertListAvailable, FilterFields, ListResults } from '../../components/ListPage';
import { type ListQuery, parseListQuery, type SearchParams } from '../../lib/params';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<SearchParams> };

/** Browse only: text search lives on /search. */
function browseQuery(params: SearchParams): ListQuery {
  const { q: _q, sort: _sort, ...rest } = parseListQuery(params);
  return { ...rest, sort: 'members' };
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  await assertListAvailable(browseQuery(await searchParams));
  return { title: 'Channels and groups' };
}

export default async function ChannelsPage({ searchParams }: Props) {
  const query = browseQuery(await searchParams);
  return (
    <main id="main" className="wrap">
      <h1>Channels and groups</h1>
      <p className="muted">Tracked public channels and groups, by subscriber count. Only entries with a collected count are listed.</p>
      <form action="/channels" method="get" className="form">
        <FilterFields query={query} />
        <button type="submit">Apply</button>
      </form>
      <ListResults basePath="/channels" query={query} emptyText="No channels match these filters." />
    </main>
  );
}
