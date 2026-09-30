import Link from 'next/link';
import { ChannelList } from '../components/ChannelList';
import { SearchBox } from '../components/SearchBox';
import { fetchChannelList } from '../lib/api';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  // Browse is part of search (flag search.public). While it is off, the section is omitted.
  const top = await fetchChannelList({ sort: 'members' }, 10);

  return (
    <main id="main" className="wrap">
      <h1>Public Telegram channel and group analytics</h1>
      <p className="muted">Subscriber counts, growth and data freshness for public channels and groups, calculated from public Telegram data.</p>

      <form action="/search" method="get" className="form" role="search">
        <SearchBox />
        <button type="submit">Search</button>
      </form>

      {top.kind === 'ok' ? (
        <section aria-labelledby="largest">
          <h2 id="largest">Largest tracked channels and groups</h2>
          {top.data.items.length > 0 ? (
            <>
              <ChannelList label="Largest tracked channels and groups" rows={top.data.items.map((c) => ({ key: c.id, ...c }))} />
              <p>
                <Link href="/channels">Browse all channels and groups</Link>
              </p>
            </>
          ) : (
            <p className="muted">No channels have been collected yet.</p>
          )}
        </section>
      ) : null}

      <section aria-labelledby="how">
        <h2 id="how">How the numbers are made</h2>
        <p>
          Every value shows when it was observed. Missing data stays missing; it is never shown as zero. See the <Link href="/docs">methodology</Link>.
        </p>
      </section>
    </main>
  );
}
