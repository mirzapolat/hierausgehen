'use client';

import { useEffect, useRef, useState } from 'react';
import { cities, cityById } from '@/lib/cities';
import { useSettings } from '@/lib/settings/context';
import { Check, ChevronDown } from './icons';

/**
 * Stadtauswahl in der Kopfzeile. Die Liste kommt aus `src/lib/cities.ts`;
 * eine weitere Stadt erscheint hier automatisch, sobald sie dort steht.
 */
export function CityPicker({
  cityId,
  onChange,
  className = '',
}: {
  cityId: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  const { t } = useSettings();
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const city = cityById(cityId);

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
        aria-label={t('selectCity')}
        title={city.name}
        className="flex h-9 min-w-9 items-center justify-center rounded-[var(--radius-sm)] border border-line
                   px-1.5 text-[12px] font-medium text-muted hover:bg-[var(--canvas)] hover:text-text
                   lg:h-7 lg:min-w-0 lg:justify-start lg:gap-1 lg:border-transparent lg:font-normal"
      >
        <span className="lg:hidden">{city.shortName}</span>
        <span className="hidden lg:inline">{city.name}</span>
        <ChevronDown className="hidden h-3.5 w-3.5 text-faint lg:block" />
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute left-0 top-[calc(100%+4px)] z-50 min-w-[190px] overflow-hidden rounded-[var(--radius-md)]
                     border border-line bg-[var(--raised)] py-1"
          style={{ boxShadow: 'var(--shadow-overlay)' }}
        >
          {cities.map((city) => (
            <li key={city.id}>
              <button
                type="button"
                role="option"
                aria-selected={city.id === cityId}
                onClick={() => {
                  onChange(city.id);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 px-2.5 py-2.5 text-left text-[14px]
                           hover:bg-[var(--chrome)] lg:py-1.5 lg:text-[13px]"
              >
                <Check
                  className={`h-3.5 w-3.5 ${city.id === cityId ? 'text-accent' : 'text-transparent'}`}
                />
                <span className="flex-1">{city.name}</span>
                <span className="text-[11px] text-faint">{city.country}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
