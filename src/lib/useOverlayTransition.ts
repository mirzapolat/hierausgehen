'use client';

import { useEffect, useState } from 'react';

/**
 * Overlays sollen sich auch beim Schliessen noch bewegen dürfen. Der Hook
 * hält das Element deshalb bis zum Ende der Bewegung im DOM (`mounted`) und
 * meldet getrennt davon den Zielzustand (`shown`), an dem die Klassen hängen.
 *
 * Bewusst ohne Bibliothek: ein Zustand, ein Timer, keine weitere Abhängigkeit.
 */
export function useOverlayTransition(open: boolean, durationMs = 200) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(open);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    setShown(false);
    const timer = setTimeout(() => setMounted(false), durationMs);
    return () => clearTimeout(timer);
  }, [open, durationMs]);

  // Der Zielzustand darf erst greifen, wenn das Element wirklich im Baum ist –
  // sonst gibt es keinen Anfangswert, von dem aus der Übergang laufen könnte.
  useEffect(() => {
    if (!open || !mounted) return;
    const frame = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(frame);
  }, [open, mounted]);
  /* eslint-enable react-hooks/set-state-in-effect */

  return { mounted, shown };
}
