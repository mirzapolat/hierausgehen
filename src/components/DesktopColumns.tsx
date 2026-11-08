'use client';

import type { ReactNode } from 'react';
import { MOTION } from './motion';
import { ResizeHandle } from './ResizeHandle';

interface Props {
  side: 'left' | 'right';
  open: boolean;
  width: number;
  onWidthChange: (width: number) => void;
  /** Während des Ziehens folgt die Spalte sofort statt animiert. */
  resizing: boolean;
  onResizingChange: (resizing: boolean) => void;
  min?: number;
  max?: number;
  className?: string;
  children: ReactNode;
}

/**
 * Eine Seitenspalte am Schreibtisch (ab `lg`) samt Zieh-Griff zur Fläche hin:
 * links die Filter, rechts die Details.
 *
 * Zum Einklappen läuft die Breite auf null; der Inhalt behält seine eigene und
 * wird beschnitten, statt sich dabei zu stauchen.
 */
export function DesktopColumn({
  side,
  open,
  width,
  onWidthChange,
  resizing,
  onResizingChange,
  min,
  max,
  className = '',
  children,
}: Props) {
  const handle = open && (
    <ResizeHandle
      side={side}
      className="hidden lg:block"
      width={width}
      min={min}
      max={max}
      onChange={onWidthChange}
      onDragChange={onResizingChange}
    />
  );

  return (
    <>
      {side === 'right' && handle}
      <aside
        className={`hidden min-h-0 shrink-0 overflow-hidden lg:block ${className}
                    ${resizing ? '' : `transition-[width] ${MOTION}`}`}
        style={{ width: open ? width : 0 }}
        inert={!open}
      >
        <div className="h-full" style={{ width }}>
          {children}
        </div>
      </aside>
      {side === 'left' && handle}
    </>
  );
}
