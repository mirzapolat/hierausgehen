'use client';

import { useSyncExternalStore } from 'react';

/**
 * Ob eine Media Query gerade zutrifft, und folgt ihr, wenn sich Fenster oder
 * Haltung des Geräts ändern. Auf dem Server (und bis zur Hydration) `false`.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
