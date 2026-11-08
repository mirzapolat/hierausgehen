'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** Wartezeit nur für Browser ohne das native `scrollend`-Ereignis. */
const SCROLL_END_FALLBACK_MS = 180;

function supportsScrollEnd(element: HTMLDivElement): boolean {
  return 'onscrollend' in element;
}

interface Props {
  /** Anker der mittleren Seite. Ändert er sich, steht sie wieder in der Mitte. */
  anchor: string;
  /** Anker einer Nachbarseite – wohin ein Wischen in diese Richtung führt. */
  pageAnchor: (offset: -1 | 1) => string;
  onStep: (direction: -1 | 1) => void;
  /**
   * Meldet schon während des Wischens, wohin es geht: sobald eine
   * Nachbarseite mehr als zur Hälfte im Bild ist (0 = zurück zur Mitte).
   * `onStep` folgt erst, wenn die Seite eingerastet ist; so kann der Titel
   * schon vorher umspringen.
   */
  onPreview?: (direction: -1 | 0 | 1) => void;
  /** Ob es in diese Richtung überhaupt noch einen Zeitraum gibt. */
  canStep: (direction: -1 | 1) => boolean;
  /**
   * Weiterer Grund, die Mitte neu anzufahren – etwa ein Wechsel der Ansicht,
   * bei dem der Anker gleich bleiben kann.
   */
  resetKey?: string;
  label?: string;
  className?: string;
  pageClassName?: string;
  children: (pageAnchor: string) => ReactNode;
}

/**
 * Horizontaler, endlos wirkender Seitenstreifen.
 *
 * Es stehen immer Seiten vor und nach dem aktuellen Zeitraum bereit. Nach
 * einem Wischen wird der Anker verschoben und der Streifen unsichtbar auf die
 * mittlere Seite zurückgesetzt. So bleibt der DOM klein, egal wie weit man
 * blättert.
 *
 * Was auf einer Seite steht, ist der Komponente gleich: Tages- und
 * Wochenstreifen nutzen sie ebenso wie das Monatsraster auf dem Telefon.
 */
export function SwipePager({
  anchor,
  pageAnchor,
  onStep,
  onPreview,
  canStep,
  resetKey = '',
  label,
  className = '',
  pageClassName = '',
  children,
}: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const navigating = useRef(false);
  const [pageSpan, setPageSpan] = useState(0);

  // Am Rand des erhobenen Zeitraums entfällt die Seite – dann lässt sich dort
  // auch nicht hinwischen.
  const back = canStep(-1);
  const offsets: (-1 | 0 | 1)[] = [...(back ? [-1 as const] : []), 0, ...(canStep(1) ? [1 as const] : [])];
  const centerPage = back ? 1 : 0;

  /**
   * Aktuelle Lage für Rückrufe, die ausserhalb eines Renderings feuern
   * (`scrollend`, Rückfall-Timer). Ändert sich die Zahl der Seiten – etwa
   * beim Ein- und Ausklappen des Monats, das die Nachbarn entfernt und
   * zurückbringt –, wandert die Mitte von Seite 0 auf 1. Ein Rückruf mit der
   * alten Mitte hielte die neu angefahrene Mitte für einen Schritt nach vorn
   * und blätterte weiter.
   */
  const live = useRef({ centerPage, pageSpan, onStep });
  useLayoutEffect(() => {
    live.current = { centerPage, pageSpan, onStep };
  });

  const settle = useCallback(() => {
    const element = scroller.current;
    const { centerPage, pageSpan, onStep } = live.current;
    if (!element || pageSpan === 0 || navigating.current) return;
    const page = Math.round(element.scrollLeft / pageSpan);
    if (page === centerPage) return;
    navigating.current = true;
    onStep(page < centerPage ? -1 : 1);
  }, []);

  /**
   * Alte Browser erkennen das Ende einer Geste nur über eine kurze Pause.
   * Solange nach einem Schritt noch Trägheit ankommt, bleibt der Pager
   * gesperrt und wird wieder auf die neue mittlere Seite gezogen.
   */
  const releaseFallbackNavigation = useCallback((element: HTMLDivElement) => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      element.scrollLeft = live.current.pageSpan * live.current.centerPage;
      navigating.current = false;
    }, SCROLL_END_FALLBACK_MS);
  }, []);

  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const measure = () => setPageSpan(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Der aktuelle Zeitraum liegt stets auf der mittleren Seite.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element || pageSpan === 0) return;
    element.scrollLeft = pageSpan * centerPage;
    if (navigating.current && !supportsScrollEnd(element)) {
      releaseFallbackNavigation(element);
    } else {
      navigating.current = false;
    }
  }, [anchor, centerPage, resetKey, pageSpan, releaseFallbackNavigation]);

  // `scrollend` wartet auf Trägheit und Scroll-Snap. Der bisherige reine
  // 90-ms-Timer konnte mitten in einer Trackpad-Geste auslösen; deren restliche
  // Bewegung traf dann schon die nächste Woche und übersprang sie.
  useEffect(() => {
    const element = scroller.current;
    if (!element || !supportsScrollEnd(element)) return;
    const onScrollEnd = () => settle();
    element.addEventListener('scrollend', onScrollEnd);
    return () => element.removeEventListener('scrollend', onScrollEnd);
  }, [settle]);

  useEffect(
    () => () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
    },
    [],
  );

  /** Zuletzt gemeldete Richtung – gemeldet wird nur ein Wechsel. */
  const previewed = useRef<-1 | 0 | 1>(0);
  const preview = (direction: -1 | 0 | 1) => {
    if (previewed.current === direction) return;
    previewed.current = direction;
    onPreview?.(direction);
  };

  // Mit dem neuen Anker steht wieder die Mitte im Bild.
  useEffect(() => {
    previewed.current = 0;
  }, [anchor, resetKey]);

  const onScroll = () => {
    const element = scroller.current;
    if (!element || pageSpan === 0) return;
    if (!navigating.current) {
      const page = Math.round(element.scrollLeft / pageSpan);
      preview(page < centerPage ? -1 : page > centerPage ? 1 : 0);
    }
    if (navigating.current) {
      if (!supportsScrollEnd(element)) {
        element.scrollLeft = pageSpan * centerPage;
        releaseFallbackNavigation(element);
      }
      return;
    }
    // Moderne Browser melden das tatsächliche Ende einschließlich Momentum
    // und Snap selbst. Der Timer bleibt nur als kompatibler Rückfall erhalten.
    if (supportsScrollEnd(element)) return;
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(settle, SCROLL_END_FALLBACK_MS);
  };

  return (
    <div
      ref={scroller}
      onScroll={onScroll}
      // Ohne Rolle bleibt die Beschriftung an einem blossen `div` wirkungslos.
      role="group"
      aria-label={label}
      className={`snap-x snap-mandatory overflow-x-auto overflow-y-hidden ${className}`}
    >
      {offsets.map((offset) => {
        const day = offset === 0 ? anchor : pageAnchor(offset);
        return (
          <div
            key={day}
            className={`h-full w-full max-w-full flex-none snap-start snap-always overflow-hidden ${pageClassName}`}
          >
            {children(day)}
          </div>
        );
      })}
    </div>
  );
}
