'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useSettings } from '@/lib/settings/context';

interface Props {
  width: number;
  onChange: (width: number) => void;
  /** Auf welcher Seite die Spalte liegt – bestimmt die Zugrichtung. */
  side: 'left' | 'right';
  min?: number;
  max?: number;
  className?: string;
}

/**
 * Zieh-Griff zwischen den Spalten. Bewusst ohne sichtbare Fläche: nur die
 * Trennlinie hebt sich beim Überfahren hervor.
 */
export function ResizeHandle({
  width,
  onChange,
  side,
  min = 180,
  max = 480,
  className = '',
}: Props) {
  const { t } = useSettings();
  const dragging = useRef<{ startX: number; startWidth: number } | null>(null);

  const clamp = useCallback((value: number) => Math.min(max, Math.max(min, value)), [min, max]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const drag = dragging.current;
      if (!drag) return;
      const delta = e.clientX - drag.startX;
      onChange(clamp(drag.startWidth + (side === 'left' ? delta : -delta)));
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [clamp, onChange, side]);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t('resize')}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={(e) => {
        dragging.current = { startX: e.clientX, startWidth: width };
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
      }}
      onDoubleClick={() => onChange(side === 'left' ? 228 : 336)}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 32 : 8;
        if (e.key === 'ArrowLeft') onChange(clamp(width + (side === 'left' ? -step : step)));
        else if (e.key === 'ArrowRight') onChange(clamp(width + (side === 'left' ? step : -step)));
        else return;
        e.preventDefault();
        e.stopPropagation();
      }}
      className={`group relative z-20 -mx-[3px] h-full w-[7px] shrink-0 cursor-col-resize
                  touch-none self-stretch ${className}`}
    >
      <span
        className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent
                   transition-colors group-hover:bg-accent group-focus-visible:bg-accent"
      />
    </div>
  );
}
