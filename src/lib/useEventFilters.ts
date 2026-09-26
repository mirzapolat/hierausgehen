import { useCallback, useMemo, useState } from 'react';
import { track } from '@/lib/analytics';
import type { CalendarEvent, SourceDefinition } from '@/lib/events/types';
import type { CitySpacePrefs } from '@/lib/layoutPrefs';

/**
 * Alle Filter des Kalenders und was aus ihnen folgt.
 *
 * Zwei Arten: die dauerhafte Auswahl (Quellen, Veranstaltungsarten, „nur mit
 * Karten“) wird je Stadt gemerkt, der Fokus auf einzelne Quellen oder Arten
 * ist bewusst flüchtig und überlebt kein Neuladen. Ein Fokus hat Vorrang vor
 * der Auswahl, verändert sie aber nicht.
 */
export function useEventFilters(options: {
  events: CalendarEvent[];
  definitions: SourceDefinition[];
  locale: string;
  /** Veranstaltungsart in der eingestellten Sprache. */
  term: (value: string) => string;
}) {
  const { locale, term } = options;

  const [disabled, setDisabled] = useState<Set<string>>(new Set());
  const [availableOnly, setAvailableOnly] = useState(false);
  const [solo, setSolo] = useState<Set<string>>(new Set());
  const [disabledCategories, setDisabledCategories] = useState<Set<string>>(new Set());
  const [categorySolo, setCategorySolo] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');

  const enabled = useMemo(
    () => new Set(options.definitions.filter((d) => !disabled.has(d.id)).map((d) => d.id)),
    [options.definitions, disabled],
  );
  const visibleSources = solo.size > 0 ? solo : enabled;

  /** Gattungen, die im geladenen Zeitraum vorkommen – ohne die Ticket- und Textfilter. */
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const event of options.events) {
      if (!visibleSources.has(event.sourceId)) continue;
      const name = event.category ?? '';
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      // Bei gleicher Anzahl alphabetisch nach dem angezeigten Namen.
      .sort((a, b) => b.count - a.count || term(a.name).localeCompare(term(b.name), locale));
  }, [options.events, visibleSources, locale, term]);

  const enabledCategories = useMemo(
    () =>
      categorySolo.size > 0
        ? new Set(categories.map((c) => c.name).filter((name) => categorySolo.has(name)))
        : new Set(categories.map((c) => c.name).filter((name) => !disabledCategories.has(name))),
    [categories, disabledCategories, categorySolo],
  );

  const events = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase(locale);
    return options.events.filter((event) => {
      if (!visibleSources.has(event.sourceId)) return false;
      const category = event.category ?? '';
      if (categorySolo.size > 0 ? !categorySolo.has(category) : disabledCategories.has(category))
        return false;
      if (availableOnly && !['available', 'limited'].includes(event.availability)) return false;
      if (!needle) return true;
      // Auch der Wortlaut der Quelle ist durchsuchbar: wer "Live Music" tippt,
      // soll das Konzert finden, das im Kalender "Konzert" heisst.
      return [
        event.title,
        event.subtitle,
        event.description,
        event.venue.name,
        event.category,
        // Auch in der eingestellten Sprache: wer "Concert" tippt, sucht nicht
        // nach dem deutschen Schlüssel, der am Termin steht.
        event.category ? term(event.category) : undefined,
        event.categoryLabel,
      ]
        .filter(Boolean)
        .some((field) => field!.toLocaleLowerCase(locale).includes(needle));
    });
  }, [options.events, visibleSources, disabledCategories, categorySolo, availableOnly, query, locale, term]);

  /** Was je Stadt gemerkt wird. */
  const space = useMemo<CitySpacePrefs>(
    () => ({
      disabledSources: [...disabled],
      availableOnly,
      disabledCategories: [...disabledCategories],
    }),
    [disabled, availableOnly, disabledCategories],
  );

  /** Gemerkte Auswahl einer Stadt übernehmen; ein Fokus gehört zur alten. */
  const restore = useCallback((stored: CitySpacePrefs) => {
    setDisabled(new Set(stored.disabledSources));
    setAvailableOnly(stored.availableOnly);
    setDisabledCategories(new Set(stored.disabledCategories));
    setSolo(new Set());
    setCategorySolo(new Set());
  }, []);

  const clearFocus = useCallback(() => {
    setSolo(new Set());
    setCategorySolo(new Set());
  }, []);

  /**
   * Fokus auf einzelne Quellen. Ein zweiter Klick auf dieselbe Auswahl hebt
   * ihn auf – gezählt wird nur das Einschalten, denn die Frage ist, wonach
   * jemand sucht, nicht wie oft er zurückgeht.
   */
  const focusSources = useCallback(
    (ids: string[], via: 'sidebar' | 'menu') => {
      const same = solo.size === ids.length && ids.every((id) => solo.has(id));
      if (same || ids.length === 0) {
        setSolo(new Set());
        return;
      }

      setSolo(new Set(ids));
      track('source-solo', ids.length === 1 ? { source: ids[0], via } : { count: ids.length, via });
    },
    [solo],
  );

  const toggleSource = useCallback((id: string) => {
    setDisabled((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleGroup = useCallback((ids: string[], on: boolean) => {
    setDisabled((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }, []);

  const toggleCategory = useCallback(
    (name: string) => {
      // Bei aktivem Fokus führt ein Klick zunächst dorthin zurück, wo man war.
      if (categorySolo.size > 0) {
        setCategorySolo(new Set());
        return;
      }
      setDisabledCategories((prev) => {
        const next = new Set(prev);
        if (next.has(name)) next.delete(name);
        else next.add(name);
        return next;
      });
    },
    [categorySolo],
  );

  const focusCategory = useCallback((name: string) => {
    setCategorySolo((current) => (current.size === 1 && current.has(name) ? new Set() : new Set([name])));
  }, []);

  const showAllCategories = useCallback(() => {
    setCategorySolo(new Set());
    setDisabledCategories(new Set());
  }, []);

  /** Wie viele Filter gerade greifen – Punkt am Knopf und „Zurücksetzen“. */
  const activeFilterCount =
    disabled.size +
    solo.size +
    categorySolo.size +
    disabledCategories.size +
    (availableOnly ? 1 : 0) +
    (query ? 1 : 0);

  const reset = useCallback(() => {
    setDisabled(new Set());
    setSolo(new Set());
    setCategorySolo(new Set());
    setDisabledCategories(new Set());
    setAvailableOnly(false);
    setQuery('');
  }, []);

  return {
    events,
    enabled,
    solo,
    categories,
    enabledCategories,
    categorySolo,
    availableOnly,
    setAvailableOnly,
    query,
    setQuery,
    space,
    restore,
    clearFocus,
    focusSources,
    toggleSource,
    toggleGroup,
    toggleCategory,
    focusCategory,
    showAllCategories,
    activeFilterCount,
    reset,
  };
}
