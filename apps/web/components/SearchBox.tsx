'use client';

import { useRouter } from 'next/navigation';
import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';

interface Suggestion {
  id: string;
  username: string;
  title: string;
  type: string;
}

const DEBOUNCE_MS = 200;
const MIN_CHARS = 2;

/**
 * Search input with autocomplete (FR-SRCH-01). Progressive enhancement: it lives inside a
 * plain GET form, so search works without JavaScript. Suggestions come from the public API on
 * the same origin (the edge proxy routes /api/); if that is unavailable, none are shown.
 */
export function SearchBox({ defaultValue = '', name = 'q', label = 'Search channels and groups' }: { defaultValue?: string; name?: string; label?: string }) {
  const router = useRouter();
  const id = useId();
  const listId = `${id}-list`;
  const [value, setValue] = useState(defaultValue);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    const q = value.trim();
    if (q.length < MIN_CHARS) {
      setItems([]);
      return;
    }
    const timer = setTimeout(async () => {
      abort.current?.abort();
      const ctrl = new AbortController();
      abort.current = ctrl;
      try {
        const res = await fetch(`/api/v1/search/suggest?q=${encodeURIComponent(q)}&limit=8`, { signal: ctrl.signal, headers: { accept: 'application/json' } });
        if (!res.ok) return setItems([]);
        const body = (await res.json()) as { data?: Suggestion[] };
        setItems(Array.isArray(body.data) ? body.data : []);
        setActive(-1);
      } catch {
        if (!ctrl.signal.aborted) setItems([]);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value]);

  useEffect(() => () => abort.current?.abort(), []);

  const expanded = open && items.length > 0;

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!expanded) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % items.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i <= 0 ? items.length - 1 : i - 1));
    } else if (e.key === 'Escape') {
      setOpen(false);
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      const s = items[active];
      if (s) router.push(`/channel/${s.username}`);
    }
  }

  return (
    <div className="search-field">
      <label htmlFor={id} className="ui-visually-hidden">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type="search"
        value={value}
        placeholder="Name, @username or keyword"
        autoComplete="off"
        maxLength={64}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-activedescendant={expanded && active >= 0 ? `${listId}-${active}` : undefined}
        onChange={(e) => {
          setValue(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
      />
      <ul id={listId} role="listbox" className="suggest" hidden={!expanded}>
        {items.map((s, i) => (
          <li
            key={s.id}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === active}
            onMouseDown={(e) => {
              e.preventDefault();
              router.push(`/channel/${s.username}`);
            }}
          >
            {s.title} <span className="muted small">@{s.username}</span>
          </li>
        ))}
      </ul>
      {/* Announces result counts politely; the listbox itself is not a live region. */}
      <p className="ui-visually-hidden" role="status" aria-live="polite">
        {open && value.trim().length >= MIN_CHARS ? (items.length === 0 ? '' : `${items.length} suggestion${items.length === 1 ? '' : 's'} available; use the arrow keys to choose.`) : ''}
      </p>
    </div>
  );
}
