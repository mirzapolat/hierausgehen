'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

export interface MenuItem {
  key: string;
  label: string;
  icon?: React.ReactNode;
  disabled?: boolean;
  /** Bleibt das Menü nach der Wahl offen? Für Rückmeldungen wie „Link kopiert“. */
  keepOpen?: boolean;
  onSelect: () => void;
}

interface Props {
  /** Angeklickter Punkt in Viewport-Koordinaten. */
  x: number;
  y: number;
  items: MenuItem[];
  label: string;
  onClose: () => void;
}

const MARGIN = 8;

/**
 * Kontextmenü an der Zeigerposition. Übernimmt bewusst das Systemmenü: die
 * angebotenen Wege führen weiter als Zurück, Neu laden und Drucken.
 *
 * Es liegt fest im Viewport, klappt an den Rändern um und gehört, solange es
 * offen ist, der Tastatur allein.
 */
export function ContextMenu({ x, y, items, label, onClose }: Props) {
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const [position, setPosition] = useState({ left: x, top: y });
  const [active, setActive] = useState(() => items.findIndex((item) => !item.disabled));
  const [shown, setShown] = useState(false);

  // Erst messen, dann einblenden – sonst springt das Menü sichtbar an seinen Platz.
  useLayoutEffect(() => {
    const element = menu.current;
    if (!element) return;
    const { width, height } = element.getBoundingClientRect();
    setPosition({
      left: Math.max(MARGIN, Math.min(x, window.innerWidth - width - MARGIN)),
      top: Math.max(MARGIN, Math.min(y, window.innerHeight - height - MARGIN)),
    });
    element.focus({ preventScroll: true });
  }, [x, y]);

  // Ein Bild später: erst dann gibt es einen Anfangswert für den Übergang.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  // Alles, was das Menü aus dem Zusammenhang reisst, schliesst es.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('resize', onClose);
    window.addEventListener('scroll', onClose, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);

  const move = (direction: -1 | 1) => {
    setActive((current) => {
      for (let step = 1; step <= items.length; step++) {
        const next = (current + direction * step + items.length * step) % items.length;
        if (!items[next].disabled) return next;
      }
      return current;
    });
  };

  const choose = (item: MenuItem) => {
    if (item.disabled) return;
    item.onSelect();
    if (!item.keepOpen) onClose();
  };

  return (
    <div
      ref={menu}
      role="menu"
      aria-label={label}
      aria-activedescendant={items[active] ? `${id}-${items[active].key}` : undefined}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown') move(1);
        else if (e.key === 'ArrowUp') move(-1);
        else if (e.key === 'Home') setActive(items.findIndex((item) => !item.disabled));
        else if (e.key === 'Enter' || e.key === ' ') choose(items[active]);
        else if (e.key === 'Escape' || e.key === 'Tab') onClose();
        else return;
        e.preventDefault();
        e.stopPropagation();
      }}
      className={`fixed z-50 min-w-[200px] max-w-[280px] origin-top-left rounded-[var(--radius-lg)]
                  border border-line bg-[var(--raised)] p-1 outline-none
                  transition-[opacity,transform] duration-120 ease-out
                  ${shown ? 'scale-100 opacity-100' : 'scale-[0.97] opacity-0'}`}
      style={{ left: position.left, top: position.top, boxShadow: 'var(--shadow-overlay)' }}
    >
      {items.map((item, index) => (
        <button
          key={item.key}
          id={`${id}-${item.key}`}
          type="button"
          role="menuitem"
          tabIndex={-1}
          disabled={item.disabled}
          onMouseEnter={() => !item.disabled && setActive(index)}
          onClick={() => choose(item)}
          className={`flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-[5px] text-left
                      text-[13px] text-text outline-none disabled:opacity-35
                      ${index === active && !item.disabled ? 'bg-[var(--accent-soft)] text-accent' : ''}`}
        >
          <span className="grid h-3.5 w-3.5 shrink-0 place-items-center text-faint">{item.icon}</span>
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
        </button>
      ))}
    </div>
  );
}
