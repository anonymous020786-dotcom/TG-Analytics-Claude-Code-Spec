import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// Placeholder shell. Nothing is indexable until PHASE-14 defines indexation rules.
export const metadata: Metadata = {
  title: 'TG Analytics',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
