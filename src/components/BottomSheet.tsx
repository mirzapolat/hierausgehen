'use client';

import { useEffect, useRef } from 'react';

interface Props {
  /** Eingeblendet (für die Bewegung); das Einhängen regelt der Aufrufer. */
  shown: boolean;
  onClose: () => void;
  closeLabel: string;
  children: React.ReactNode;
}

/** Ab diesem Anteil der Höhe schliesst das Loslassen das Sheet … */
const CLOSE_FRACTION = 0.25;
/** … oder ab dieser Geschwindigkeit nach unten (px/ms), egal wie weit. */
const CLOSE_VELOCITY = 0.5;
/** So weit muss der Finger wandern, bevor entschieden wird, was er will. */
const SLOP = 6;
/** Dieselbe Kurve wie die übrigen Overlays (`CalendarApp`). */
const EASE = 'cubic-bezier(0.32,0.72,0,1)';

/**
 * Mobil: ein Sheet, das von unten aufsteigt und sich mit dem Finger wieder
 * hinunterziehen lässt.
 *
 * Gegriffen wird am Griff oben, an allem, was nicht scrollt (etwa der
 * Kopfzeile), und am Inhalt, solange dieser ganz oben steht: dann übernimmt
 * die Geste nach unten das Sheet statt den Bildlauf. Während des Ziehens
 * folgt es dem Finger ohne Verzögerung; losgelassen schliesst es oder federt
 * zurück.
 */
export function BottomSheet({ shown, onClose, closeLabel, children }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLButtonElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  // Öffnet es wieder, bevor es ganz weg war, gilt wieder die Klasse.
  useEffect(() => {
    if (!shown) return;
    for (const element of [panel.current, backdrop.current]) {
      element?.style.removeProperty('transform');
      element?.style.removeProperty('transition');
      element?.style.removeProperty('opacity');
    }
  }, [shown]);

  useEffect(() => {
    const element = panel.current;
    if (!element) return;

    let startX = 0;
    let startY = 0;
    /** `undefined`: noch offen; danach gehört die Geste dem Sheet oder dem Bildlauf. */
    let mode: 'drag' | 'scroll' | undefined;
    let scroller: HTMLElement | null = null;
    let offset = 0;
    let lastY = 0;
    let lastTime = 0;
    let velocity = 0;
    let settle: number | undefined;

    const scrollerOf = (target: EventTarget | null) => {
      for (let node = target as HTMLElement | null; node && node !== element; node = node.parentElement) {
        const { overflowY } = getComputedStyle(node);
        if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
          return node;
        }
      }
      return null;
    };

    const apply = (y: number, animate: boolean) => {
      const transition = animate ? `200ms ${EASE}` : '';
      element.style.transition = animate ? `transform ${transition}` : 'none';
      element.style.transform = `translateY(${y}px)`;
      const shade = backdrop.current;
      if (shade) {
        shade.style.transition = animate ? `opacity ${transition}` : 'none';
        shade.style.opacity = String(Math.max(0, 1 - y / element.offsetHeight));
      }
    };

    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        mode = 'scroll';
        return;
      }
      window.clearTimeout(settle);
      const touch = event.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      lastY = startY;
      lastTime = event.timeStamp;
      velocity = 0;
      offset = 0;
      mode = undefined;
      scroller = scrollerOf(event.target);
    };

    const onMove = (event: TouchEvent) => {
      if (mode === 'scroll') return;
      const touch = event.touches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;

      if (mode === undefined) {
        if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
        // Seitlich, nach oben oder mitten im gescrollten Inhalt: nicht unseres.
        const atTop = !scroller || scroller.scrollTop <= 0;
        if (Math.abs(dx) > Math.abs(dy) || dy < 0 || !atTop) {
          mode = 'scroll';
          return;
        }
        mode = 'drag';
        // Ab hier gemessen, damit das Sheet nicht um den Schwellwert springt.
        startY = touch.clientY;
      }

      event.preventDefault();
      offset = Math.max(0, touch.clientY - startY);
      const elapsed = event.timeStamp - lastTime;
      if (elapsed > 0) velocity = (touch.clientY - lastY) / elapsed;
      lastY = touch.clientY;
      lastTime = event.timeStamp;
      apply(offset, false);
    };

    const onEnd = () => {
      if (mode !== 'drag') return;
      mode = undefined;
      const height = element.offsetHeight;
      if (offset > height * CLOSE_FRACTION || velocity > CLOSE_VELOCITY) {
        // Von hier aus weiter hinunter; der Aufrufer hängt es danach aus.
        apply(height, true);
        closeRef.current();
        return;
      }
      apply(0, true);
      settle = window.setTimeout(() => {
        for (const target of [element, backdrop.current]) {
          target?.style.removeProperty('transform');
          target?.style.removeProperty('transition');
          target?.style.removeProperty('opacity');
        }
      }, 220);
    };

    // Nicht passiv: nur so lässt sich der Bildlauf während des Ziehens anhalten.
    element.addEventListener('touchstart', onStart, { passive: true });
    element.addEventListener('touchmove', onMove, { passive: false });
    element.addEventListener('touchend', onEnd);
    element.addEventListener('touchcancel', onEnd);
    return () => {
      window.clearTimeout(settle);
      element.removeEventListener('touchstart', onStart);
      element.removeEventListener('touchmove', onMove);
      element.removeEventListener('touchend', onEnd);
      element.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  const motion = 'duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]';

  return (
    <div className="fixed inset-0 z-40 lg:hidden">
      <button
        ref={backdrop}
        type="button"
        aria-label={closeLabel}
        onClick={onClose}
        className={`absolute inset-0 transition-opacity ${motion} ${shown ? 'opacity-100' : 'opacity-0'}`}
        style={{ background: 'var(--overlay)' }}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        className={`absolute inset-x-0 bottom-0 flex flex-col overflow-hidden
                    rounded-t-[var(--radius-sheet)] bg-[var(--chrome)]
                    transition-transform ${motion}
                    ${shown ? 'translate-y-0' : 'translate-y-full'}`}
        style={{
          boxShadow: 'var(--shadow-overlay)',
          height: 'min(88dvh, calc(100dvh - env(safe-area-inset-top) - 8px))',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        {/* Der Griff: eine breite, gut zu treffende Fläche über die ganze
            Breite, sichtbar nur als kurze Linie in der Mitte. */}
        <div aria-hidden="true" className="flex h-6 shrink-0 items-end justify-center pb-1">
          <span className="h-[5px] w-10 rounded-full bg-[var(--line-strong)]" />
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </div>
    </div>
  );
}
