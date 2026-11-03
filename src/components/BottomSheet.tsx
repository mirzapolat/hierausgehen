'use client';

import { useEffect, useRef } from 'react';

interface Props {
  /** Eingeblendet (für die Bewegung); das Einhängen regelt der Aufrufer. */
  shown: boolean;
  onClose: () => void;
  closeLabel: string;
  /**
   * So hoch wie der Inhalt statt fast bildschirmhoch – für kurze Inhalte wie
   * eine Ankündigung. Wird es zu viel, scrollt der Inhalt.
   */
  fit?: boolean;
  /** Beschriftung des Dialogs für Screenreader (`aria-labelledby`). */
  labelledBy?: string;
  children: React.ReactNode;
}

/** Ab diesem Anteil der Höhe schliesst das Loslassen das Sheet … */
const CLOSE_FRACTION = 0.25;
/** … oder ab dieser Geschwindigkeit nach unten (px/ms), egal wie weit. */
const CLOSE_VELOCITY = 0.5;
/** So weit muss der Finger wandern, bevor entschieden wird, was er will. */
const SLOP = 6;
/** Hält der Finger vor dem Loslassen so lange still (ms), zählt kein Schwung mehr. */
const STILL_AFTER = 80;
/** Dieselbe Kurve wie die übrigen Overlays (`CalendarApp`). */
const EASE = 'cubic-bezier(0.32,0.72,0,1)';
/** Anfangssteigung dieser Kurve: so viel schneller als im Schnitt startet sie. */
const EASE_SLOPE = 0.72 / 0.32;
/** Grenzen für die Dauer des Auslaufens (ms). */
const MIN_MS = 140;
const MAX_MS = 300;
const RETURN_MS = 260;

/**
 * Mobil: ein Sheet, das von unten aufsteigt und sich mit dem Finger wieder
 * hinunterziehen lässt.
 *
 * Gegriffen wird am Griff oben, an allem, was nicht scrollt (etwa der
 * Kopfzeile), und am Inhalt, solange dieser ganz oben steht: dann übernimmt
 * die Geste nach unten das Sheet statt den Bildlauf. Während des Ziehens
 * folgt es dem Finger ohne Verzögerung. Losgelassen läuft es mit dem Schwung
 * des Fingers aus, die Dauer richtet sich nach Tempo und Reststrecke, und
 * erst danach gilt es als geschlossen. Sonst federt es zurück.
 *
 * Quer gehalten ist es schmaler als der Bildschirm und steht mittig: über die
 * ganze Breite wäre eine Zeile Text dort kaum noch zu lesen.
 */
export function BottomSheet({ shown, onClose, closeLabel, fit = false, labelledBy, children }: Props) {
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
      for (const property of ['transform', 'transition', 'opacity', 'pointer-events', 'will-change']) {
        element?.style.removeProperty(property);
      }
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
    let timer: number | undefined;

    const scrollerOf = (target: EventTarget | null) => {
      for (let node = target as HTMLElement | null; node && node !== element; node = node.parentElement) {
        const { overflowY } = getComputedStyle(node);
        if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
          return node;
        }
      }
      return null;
    };

    const apply = (y: number, duration: number) => {
      const shade = backdrop.current;
      element.style.transition = duration ? `transform ${duration}ms ${EASE}` : 'none';
      element.style.transform = `translate3d(0, ${y}px, 0)`;
      if (shade) {
        shade.style.transition = duration ? `opacity ${duration}ms ${EASE}` : 'none';
        shade.style.opacity = String(Math.max(0, 1 - y / element.offsetHeight));
      }
    };

    const reset = () => {
      for (const target of [element, backdrop.current]) {
        for (const property of ['transform', 'transition', 'opacity', 'will-change']) {
          target?.style.removeProperty(property);
        }
      }
    };

    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        mode = 'scroll';
        return;
      }
      window.clearTimeout(timer);
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
        lastY = touch.clientY;
        element.style.willChange = 'transform';
      }

      event.preventDefault();
      offset = Math.max(0, touch.clientY - startY);
      const elapsed = event.timeStamp - lastTime;
      if (elapsed > 0) {
        // Geglättet: ein einzelner unruhiger Messpunkt soll das Tempo nicht bestimmen.
        velocity = 0.7 * ((touch.clientY - lastY) / elapsed) + 0.3 * velocity;
      }
      lastY = touch.clientY;
      lastTime = event.timeStamp;
      apply(offset, 0);
    };

    const onEnd = (event: TouchEvent) => {
      if (mode !== 'drag') return;
      mode = undefined;
      if (event.timeStamp - lastTime > STILL_AFTER) velocity = 0;
      const height = element.offsetHeight;

      if (offset > height * CLOSE_FRACTION || velocity > CLOSE_VELOCITY) {
        // So lange, dass die Kurve mit dem Tempo des Fingers beginnt.
        const remaining = height - offset;
        const duration = Math.round(
          Math.min(MAX_MS, Math.max(MIN_MS, (EASE_SLOPE * remaining) / Math.max(velocity, 0.001))),
        );
        if (backdrop.current) backdrop.current.style.pointerEvents = 'none';
        apply(height, duration);
        // Erst wenn es unten ist, gilt es als zu – sonst überlagert sich die
        // eigene Bewegung des Aufrufers mit dieser hier.
        timer = window.setTimeout(() => closeRef.current(), duration);
        return;
      }

      apply(0, RETURN_MS);
      timer = window.setTimeout(reset, RETURN_MS + 20);
    };

    // Nicht passiv: nur so lässt sich der Bildlauf während des Ziehens anhalten.
    element.addEventListener('touchstart', onStart, { passive: true });
    element.addEventListener('touchmove', onMove, { passive: false });
    element.addEventListener('touchend', onEnd);
    element.addEventListener('touchcancel', onEnd);
    return () => {
      window.clearTimeout(timer);
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
        aria-labelledby={labelledBy}
        className={`absolute inset-x-0 bottom-0 flex flex-col overflow-hidden
                    rounded-t-[var(--radius-sheet)] bg-[var(--chrome)]
                    landscape:mx-auto landscape:w-[min(36rem,calc(100%-2rem))]
                    transition-transform ${motion}
                    ${shown ? 'translate-y-0' : 'translate-y-full'}`}
        style={{
          boxShadow: 'var(--shadow-overlay)',
          // Kein Rand unten: der Inhalt läuft bis an die Kante und hält selbst
          // Abstand zum Home-Indikator (`pb-safe` in `DetailPanel`).
          [fit ? 'maxHeight' : 'height']: 'min(88dvh, calc(100dvh - env(safe-area-inset-top) - 8px))',
        }}
      >
        {/* Der Griff: eine breite, gut zu treffende Fläche über die ganze
            Breite, sichtbar nur als kurze Linie in der Mitte. Ziehen
            schliesst, ein Tipp auch: er ersetzt den Schliessen-Knopf. */}
        <button
          type="button"
          onClick={onClose}
          aria-label={closeLabel}
          className="flex h-7 w-full shrink-0 items-center justify-center"
        >
          <span className="h-[5px] w-10 rounded-full bg-[var(--line-strong)]" />
        </button>
        {fit ? (
          <div className="min-h-0 overflow-y-auto scroll-quiet pb-safe">{children}</div>
        ) : (
          <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
        )}
      </div>
    </div>
  );
}
