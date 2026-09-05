'use client';

import { useSettings } from '@/lib/settings/context';
import { Close, Search } from './icons';

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
 *
 * Gestaltet ist es als Pille aus Glas – bewusst das einzige Element dieser Art
 * ausserhalb der Karte. Eine laufende Suche verändert alles, was der Kalender
 * zeigt, und soll deshalb auch dann auffallen, wenn man gerade woanders
 * hinsieht: der Ring aus dem laufenden Farbverlauf samt seinem Schein steht
 * dafür. Das Aussehen selbst steht in `globals.css` (`.search-*`), damit die
 * Zustände – schweben, Fokus, gefüllt – an einer Stelle beieinander liegen.
 */
export function SearchField({ query, onQueryChange, className = '' }: Props) {
  const { t } = useSettings();

  return (
    <div className={`search-shell ${query ? 'rainbow-ring' : ''} ${className}`}>
      <div className="search-glass">
        {/* Die Masse stehen in `globals.css` – ein Icon ohne Grösse würde die
            Pille sprengen, wenn die Klasse einmal nicht ankommt. */}
        <Search className="search-icon" />
        <input
          type="search"
          data-search-input=""
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={t('search')}
          aria-label={t('searchAria')}
          className="search-input"
        />
        {query && (
          <button
            type="button"
            onClick={() => onQueryChange('')}
            aria-label={t('clearSearch')}
            title={t('clearSearch')}
            className="search-clear"
          >
            {/* Ohne Klasse: das Mass kommt aus `.search-clear svg`, die
                Grundgrösse des Icons bleibt als Rückfall. */}
            <Close />
          </button>
        )}
      </div>
    </div>
  );
}
