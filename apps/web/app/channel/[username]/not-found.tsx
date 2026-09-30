import Link from 'next/link';

export default function ChannelNotFound() {
  return (
    <main id="main" className="wrap">
      <h1>Channel not found</h1>
      <p>This public channel or group is not in TG Analytics yet, or is not publicly available.</p>
      <p>
        <Link href="/search">Search channels and groups</Link>
      </p>
    </main>
  );
}
