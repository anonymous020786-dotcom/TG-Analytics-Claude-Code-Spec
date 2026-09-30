import Link from 'next/link';

export default function NotFound() {
  return (
    <main id="main" className="wrap">
      <h1>Page not found</h1>
      <p>This page does not exist or is not available.</p>
      <p>
        <Link href="/">Home</Link> · <Link href="/search">Search</Link>
      </p>
    </main>
  );
}
