'use client';

import { useEffect, useState } from 'react';

/**
 * The light/dark choice, in one place.
 *
 * Two controls now drive it — the floating toggle in the root layout and the
 * light/dark switch on the printable report — and a third reader, the link
 * graph, repaints its canvas when it changes. They agree because they all go
 * through here: `apply` is the only writer, and every component subscribes to
 * the same `themechange` event rather than holding its own copy.
 *
 * The attribute on <html> is the source of truth, not React state. It is set by
 * the inline script in <head> before React exists (see app/layout.tsx), so a
 * component that trusted its own initial state would disagree with the DOM on
 * the very first paint.
 */

export type Theme = 'light' | 'dark';

export const THEME_EVENT = 'themechange';

/** What the document is showing right now, falling back to the OS preference. */
export function currentTheme(): Theme {
  if (typeof document === 'undefined') return 'light';
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'dark' || attr === 'light') return attr;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Switch the whole document, persist the choice, and tell every listener. */
export function applyTheme(next: Theme): void {
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('theme', next); } catch { /* storage may be blocked */ }
  window.dispatchEvent(new Event(THEME_EVENT));
}

/**
 * The current theme, kept in sync with whatever else changes it.
 *
 * `mounted` is reported alongside because the server cannot know the answer:
 * the theme lives in localStorage. Rendering a moon on the server and a sun on
 * the client is a hydration mismatch, so callers render a stable placeholder
 * until this turns true.
 */
export function useTheme(): { theme: Theme; mounted: boolean; setTheme: (t: Theme) => void } {
  const [theme, setThemeState] = useState<Theme>('light');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setThemeState(currentTheme());
    setMounted(true);
    const sync = () => setThemeState(currentTheme());
    window.addEventListener(THEME_EVENT, sync);
    return () => window.removeEventListener(THEME_EVENT, sync);
  }, []);

  return {
    theme,
    mounted,
    setTheme: (t: Theme) => {
      applyTheme(t);
      setThemeState(t);
    },
  };
}
