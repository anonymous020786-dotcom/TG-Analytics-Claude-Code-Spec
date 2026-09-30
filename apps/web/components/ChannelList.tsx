import Link from 'next/link';
import { formatCount } from '../lib/format';

export interface ListRow {
  key: string;
  username: string;
  title: string;
  type: string;
  members: { value: string } | null;
  position?: number;
  /** Extra right-hand value (e.g. a ranking score), already formatted. */
  extra?: string;
}

/** Channel/group rows linking to entity pages. Telegram text is rendered as text (escaped). */
export function ChannelList({ rows, label }: { rows: ListRow[]; label: string }) {
  return (
    <ol className="list" aria-label={label}>
      {rows.map((r) => (
        <li key={r.key}>
          {r.position !== undefined ? <span className="pos">{r.position}</span> : null}
          <span className="name">
            <Link href={`/channel/${r.username}`}>{r.title}</Link>{' '}
            <span className="muted small">
              @{r.username} · {r.type === 'group' ? 'group' : 'channel'}
            </span>
          </span>
          {r.extra ? <span className="num muted small">{r.extra}</span> : null}
          <span className="num">{r.members ? formatCount(r.members.value) : <span className="muted small">not collected</span>}</span>
        </li>
      ))}
    </ol>
  );
}

