import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { rankingsAvailable } from '../lib/api';
import './globals.css';

// Nothing is indexable until PHASE-14 defines indexation rules (OD-008).
export const metadata: Metadata = {
  title: { default: 'TG Analytics', template: '%s — TG Analytics' },
  description: 'Analytics for public Telegram channels and groups, calculated from public data.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const showRankings = await rankingsAvailable();
  return (
    <html lang="en">
      <body>
        <a className="skip" href="#main">
          Skip to content
        </a>
        <header className="site-header">
          <div className="wrap bar">
            <Link className="brand" href="/">
              TG Analytics
            </Link>
            <nav aria-label="Main">
              <ul className="nav">
                <li>
                  <Link href="/search">Search</Link>
                </li>
                <li>
                  <Link href="/channels">Channels</Link>
                </li>
                {showRankings ? (
                  <>
                    <li>
                      <Link href="/rankings">Rankings</Link>
                    </li>
                    <li>
                      <Link href="/trending">Trending</Link>
                    </li>
                  </>
                ) : null}
                <li>
                  <Link href="/docs">Methodology</Link>
                </li>
              </ul>
            </nav>
          </div>
        </header>
        {children}
        <footer className="site-footer">
          <div className="wrap">
            <p>Calculated by TG Analytics from public Telegram data. Not affiliated with Telegram; not official Telegram statistics.</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
