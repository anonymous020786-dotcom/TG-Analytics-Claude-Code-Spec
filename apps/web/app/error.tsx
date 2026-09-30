'use client';

export default function RouteError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main id="main" className="wrap">
      <h1>Something went wrong</h1>
      <p>This page could not be loaded right now. Please try again in a moment.</p>
      <button type="button" onClick={() => reset()}>
        Try again
      </button>
    </main>
  );
}
