'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from './icons';

export interface DropdownOption<T extends string | number> {
  value: T;
  label: string;
  /** Tooltip der Option, etwa mit dem Tastenkürzel. */
  title?: string;
  /** Nur ab `lg` wählbar – auf schmalen Geräten fehlt der Platz dafür. */
  wide?: boolean;
}

/**
 * Schlichte Auswahlliste in der Kopfzeile, gebaut wie die Stadtauswahl:
 * Knopf mit dem aktuellen Wert, darunter die Liste als Overlay.
 */
export function Dropdown<T extends string | number>({
  value,
  options,
  onChange,
  label,
  buttonLabel,
  className = '',
}: {
  /** Ohne passenden Wert zeigt der Knopf `buttonLabel` und kein Haken. */
  value: T | undefined;
  options: DropdownOption<T>[];
  onChange: (value: T) => void;
  /** Zugänglicher Name der Liste. */
  label: string;
  /** Inhalt des Knopfs, falls er vom Text der gewählten Option abweicht. */
  buttonLabel?: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!container.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={container} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        title={selected?.title ?? label}
        className="flex h-9 items-center gap-1 rounded-[var(--radius-sm)] border border-line px-2
                   text-[13px] text-text hover:bg-[var(--canvas)] lg:h-7 lg:text-[12px]"
      >
        {buttonLabel ?? selected?.label ?? label}
        <ChevronDown className="h-3.5 w-3.5 text-faint" />
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label={label}
          className="absolute right-0 top-[calc(100%+4px)] z-50 min-w-[160px] overflow-hidden rounded-[var(--radius-md)]
                     border border-line bg-[var(--raised)] py-1"
          style={{ boxShadow: 'var(--shadow-overlay)' }}
        >
          {options.map((option) => (
            <li key={option.value} className={option.wide ? 'hidden lg:block' : undefined}>
              <button
                type="button"
                role="option"
                aria-selected={option.value === value}
                title={option.title}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 px-2.5 py-2.5 text-left text-[14px]
                           hover:bg-[var(--chrome)] lg:py-1.5 lg:text-[13px]"
              >
                <Check
                  className={`h-3.5 w-3.5 ${option.value === value ? 'text-accent' : 'text-transparent'}`}
                />
                <span className="flex-1">{option.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
