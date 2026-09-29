'use client';

export default function ChannelError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main>
      <h1>Something went wrong</h1>
      <p>We could not load this channel right now.</p>
      <button type="button" onClick={() => reset()}>
        Try again
      </button>
    </main>
  );
}
