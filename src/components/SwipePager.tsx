'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

interface Props {
  /** Anker der mittleren Seite. Ändert er sich, steht sie wieder in der Mitte. */
  anchor: string;
  /** Anker einer Nachbarseite – wohin ein Wischen in diese Richtung führt. */
  pageAnchor: (offset: -1 | 1) => string;
  onStep: (direction: -1 | 1) => void;
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
    navigating.current = false;
  }, [anchor, centerPage, resetKey, pageSpan]);

  useEffect(
    () => () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
    },
    [],
  );

  const onScroll = () => {
    const element = scroller.current;
    if (!element || pageSpan === 0 || navigating.current) return;
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      const page = Math.round(element.scrollLeft / pageSpan);
      if (page === centerPage) return;
      navigating.current = true;
      onStep(page < centerPage ? -1 : 1);
    }, 90);
  };

  return (
    <div
      ref={scroller}
      onScroll={onScroll}
      // Ohne Rolle bleibt die Beschriftung an einem blossen `div` wirkungslos.
      role="group"
      aria-label={label}
      className={`snap-x snap-mandatory overflow-x-auto overflow-y-hidden scroll-quiet ${className}`}
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
