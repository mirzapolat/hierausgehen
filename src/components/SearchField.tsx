'use client';

import { useSavedEvents } from '@/lib/saved';
import { useSettings } from '@/lib/settings/context';
import { Bookmark, Close, Search } from './icons';

interface Props {
  query: string;
  onQueryChange: (value: string) => void;
  /** Zusätzliche Klassen für die Hülle – etwa um das Feld je Breite zu zeigen. */
  className?: string;
  /** Mobil: beim Öffnen gleich tippen können, und zuklappen, wenn leer verlassen. */
  autoFocus?: boolean;
  onBlur?: () => void;
}

/**
 * Das Suchfeld über den Terminen. Auf dem Desktop steht es oben in der
 * Filterspalte, auf schmalen Geräten über dem Kalender; beide Male dasselbe
 * Feld, damit „/“ es überall findet (`data-search-input`).
 *
 * Gestaltet ist es als Pille aus Glas – bewusst das einzige Element dieser Art
 * ausserhalb der Karte. Eine laufende Suche verändert alles, was der Kalender
 * zeigt, und soll deshalb auch dann noch zu sehen sein, wenn man längst
 * woanders hinsieht: dafür steht `is-searching`, das die Kante des Feldes
 * einfärbt. Das Aussehen selbst steht in `globals.css` (`.search-*`), damit
 * die Zustände – schweben, Fokus, gefüllt – an einer Stelle beieinander
 * liegen.
 */
export function SearchField({ query, onQueryChange, className = '', autoFocus, onBlur }: Props) {
  const { cityId, settings, t } = useSettings();
  const saved = useSavedEvents(cityId);
  // Gemerkt wird die Suche selbst: was sie künftig findet, steht auch auf der Merkliste.
  const searchSaved = query.trim() !== '' && saved.searchSaved(query, cityId);

  return (
    <div className={`search-shell ${query ? 'is-searching' : ''} ${className}`}>
      <div className="search-glass">
        {/* Die Masse stehen in `globals.css` – ein Icon ohne Grösse würde die
            Pille sprengen, wenn die Klasse einmal nicht ankommt. */}
        <Search className="search-icon" />
        <input
          type="search"
          data-search-input=""
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          autoFocus={autoFocus}
          onBlur={onBlur}
          placeholder={t('search')}
          aria-label={t('searchAria')}
          className="search-input"
        />
        {query.trim() && (
          <button
            type="button"
            onClick={() => saved.toggleSearch(query, cityId, settings.locale)}
            aria-pressed={searchSaved}
            aria-label={searchSaved ? t('unsaveSearch') : t('saveSearch')}
            title={searchSaved ? t('unsaveSearch') : t('saveSearch')}
            className={`search-clear ${searchSaved ? 'is-saved' : ''}`}
          >
            <Bookmark filled={searchSaved} />
          </button>
        )}
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
