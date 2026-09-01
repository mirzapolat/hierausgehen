'use client';

import { useSettings } from '@/lib/settings/context';
import { Close } from './icons';

interface Props {
  query: string;
  onQueryChange: (value: string) => void;
  /** Zusätzliche Klassen für die Hülle – etwa um das Feld je Breite zu zeigen. */
  className?: string;
}

/**
 * Das Suchfeld über den Terminen. Auf dem Desktop steht es oben in der
 * Filterspalte, auf schmalen Geräten über dem Kalender; beide Male dasselbe
 * Feld, damit „/“ es überall findet (`data-search-input`).
 */
export function SearchField({ query, onQueryChange, className = '' }: Props) {
  const { t } = useSettings();

  return (
    <div className={`rounded-[5px] p-[1.5px] ${query ? 'rainbow-ring' : 'bg-transparent'} ${className}`}>
      <div className="relative">
        <input
          type="search"
          data-search-input=""
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={t('search')}
          aria-label={t('searchAria')}
          className={`w-full rounded-[var(--radius-sm)] bg-[var(--canvas)] py-1.5 pl-2.5 text-[13px]
                      text-text placeholder:text-faint focus:outline-none
                      ${query ? 'border border-transparent pr-7' : 'border border-line pr-2.5 focus:border-accent'}`}
        />
        {query && (
          <button
            type="button"
            onClick={() => onQueryChange('')}
            aria-label={t('clearSearch')}
            title={t('clearSearch')}
            className="absolute right-1 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center
                       rounded-full text-muted hover:bg-[var(--chrome)] hover:text-text"
          >
            <Close className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
