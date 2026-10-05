import { useCallback, useMemo, useState } from 'react';
import { track } from '@/lib/analytics';
import type { CalendarEvent, SourceDefinition } from '@/lib/events/types';
import type { EventGroup } from '@/lib/events/groups';
import type { CitySpacePrefs } from '@/lib/layoutPrefs';
import { FALLBACK_CATEGORY } from '@/lib/events/categories';
import { isFreeEntry } from '@/lib/events/price';
import { toggleGroup, toggleSource, visibleSources } from '@/lib/events/source-selection';
import {
  hasTickets,
  matchesText,
  matchesTimeOfDay,
  type TimeOfDay,
  type TimeOfDayStarts,
} from '@/lib/events/filter';

/**
 * Lässt sich nach dieser Art filtern? „Sonstiges“ und „ohne Angabe“ sind
 * keine Art, nach der jemand sucht – die Termine bleiben im Kalender, nur
 * eine Pille bekommen sie nicht.
 */
function isChoosableCategory(name: string): boolean {
  return name !== '' && name !== FALLBACK_CATEGORY;
}

/**
 * Alle Filter des Kalenders und was aus ihnen folgt.
 *
 * Quellen und Veranstaltungsarten sind eine Auswahl: nichts gewählt heisst
 * alles zu sehen, jede Wahl grenzt ein, mehrere zusammen erweitern wieder.
 * Beide werden je Stadt gemerkt wie die übrigen Filter; nur „Gemerkt“ und
 * die Suche überleben kein Neuladen.
 */
export function useEventFilters(options: {
  events: CalendarEvent[];
  definitions: SourceDefinition[];
  locale: string;
  /** Veranstaltungsart in der eingestellten Sprache. */
  term: (value: string) => string;
  /** Steht der Termin auf der Merkliste (siehe `saved.ts`)? */
  isSaved: (event: CalendarEvent) => boolean;
  /** Minuten seit Mitternacht in der eingestellten Zeitzone – für die Tageszeit. */
  minutesOfDay: (iso: string) => number;
  /** Grenzen der Tageszeiten aus den Einstellungen. */
  timeOfDayStarts: TimeOfDayStarts;
}) {
  const { minutesOfDay, definitions, isSaved, timeOfDayStarts } = options;
  const { locale, term } = options;

  const [selectedSources, setSelectedSources] = useState<Set<string>>(new Set());
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [availableOnly, setAvailableOnly] = useState(false);
  const [freeOnly, setFreeOnly] = useState(false);
  /** Nur Gemerktes – flüchtig, sonst stünde nach dem Neuladen ein leerer Kalender da. */
  const [savedOnly, setSavedOnly] = useState(false);
  const [timesOfDay, setTimesOfDay] = useState<TimeOfDay[]>([]);
  const [query, setQuery] = useState('');

  const visible = useMemo(
    () => visibleSources(definitions.map((d) => d.id), selectedSources),
    [definitions, selectedSources],
  );
  /** Ob die Quellenwahl gerade greift – eine Auswahl ohne bekannte Quelle tut es nicht. */
  const sourcesFiltered = visible.size < definitions.length;

  /** Arten, die bei den gewählten Quellen vorkommen, die häufigsten zuerst. */
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const event of options.events) {
      if (!visible.has(event.sourceId)) continue;
      const name = event.category ?? '';
      if (!isChoosableCategory(name)) continue;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    // Eine gewählte Art bleibt stehen, auch wenn sie gerade nicht vorkommt –
    // sonst liesse sie sich nicht mehr abwählen.
    for (const name of selectedCategories) if (!counts.has(name)) counts.set(name, 0);
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      // Bei gleicher Anzahl alphabetisch nach dem angezeigten Namen.
      .sort((a, b) => b.count - a.count || term(a.name).localeCompare(term(b.name), locale));
  }, [options.events, visible, selectedCategories, locale, term]);

  const events = useMemo(
    () =>
      options.events.filter((event) => {
        if (!visible.has(event.sourceId)) return false;
        if (selectedCategories.size > 0 && !selectedCategories.has(event.category ?? '')) return false;
        if (availableOnly && !hasTickets(event)) return false;
        if (freeOnly && !isFreeEntry(event)) return false;
        if (savedOnly && !isSaved(event)) return false;
        if (!matchesTimeOfDay(event, timesOfDay, minutesOfDay, timeOfDayStarts)) return false;
        return matchesText(event, query, locale, term);
      }),
    [
      options.events,
      isSaved,
      visible,
      selectedCategories,
      availableOnly,
      freeOnly,
      savedOnly,
      timesOfDay,
      minutesOfDay,
      timeOfDayStarts,
      query,
      locale,
      term,
    ],
  );

  /** Wie viele gemerkte Termine im geladenen Zeitraum liegen – unabhängig von den übrigen Filtern. */
  const savedCount = useMemo(
    () => options.events.filter((event) => isSaved(event)).length,
    [options.events, isSaved],
  );

  /** Was je Stadt gemerkt wird. */
  const space = useMemo<CitySpacePrefs>(
    () => ({
      sources: [...selectedSources],
      availableOnly,
      freeOnly,
      categories: [...selectedCategories],
      timesOfDay,
    }),
    [selectedSources, availableOnly, freeOnly, selectedCategories, timesOfDay],
  );

  /** Gemerkte Auswahl einer Stadt übernehmen. */
  const restore = useCallback((stored: CitySpacePrefs) => {
    setSelectedSources(new Set(stored.sources));
    setAvailableOnly(stored.availableOnly);
    setFreeOnly(stored.freeOnly);
    setSelectedCategories(new Set(stored.categories.filter(isChoosableCategory)));
    setTimesOfDay(stored.timesOfDay);
    setSavedOnly(false);
  }, []);

  const groupIds = useCallback(
    (group: EventGroup) => definitions.filter((d) => d.group === group).map((d) => d.id),
    [definitions],
  );

  /** Ein Ordner als Ganzes – ganz gewählt wird er abgewählt, sonst ganz gewählt. */
  const toggleSourceGroup = useCallback(
    (group: EventGroup) => setSelectedSources((current) => toggleGroup(current, groupIds(group))),
    [groupIds],
  );

  /** Ein Haus innerhalb seines Ordners – siehe `toggleSource`. */
  const toggleSourceInGroup = useCallback(
    (id: string) => {
      const group = definitions.find((d) => d.id === id)?.group;
      if (!group) return;
      setSelectedSources((current) => toggleSource(current, id, groupIds(group)));
    },
    [definitions, groupIds],
  );

  /**
   * „Nur diese Quelle“ aus dem Kontextmenü. Steht genau sie schon allein da,
   * hebt der zweite Klick die Auswahl auf – gezählt wird nur das Einschalten.
   */
  const onlySource = useCallback(
    (id: string) => {
      const same = selectedSources.size === 1 && selectedSources.has(id);
      setSelectedSources(same ? new Set() : new Set([id]));
      if (!same) track('source-solo', { source: id, via: 'menu' });
    },
    [selectedSources],
  );

  /** Quellen abwählen – alle oder nur diese. */
  const clearSources = useCallback((ids?: string[]) => {
    setSelectedSources((current) => {
      if (!ids) return new Set();
      const next = new Set(current);
      for (const id of ids) next.delete(id);
      return next;
    });
  }, []);

  /** Eine Tageszeit an- oder abwählen; die Reihenfolge bleibt die des Tages. */
  const toggleTimeOfDay = useCallback((time: TimeOfDay) => {
    setTimesOfDay((current) =>
      current.includes(time) ? current.filter((entry) => entry !== time) : [...current, time],
    );
  }, []);

  const clearTimesOfDay = useCallback(() => setTimesOfDay([]), []);

  const toggleCategory = useCallback((name: string) => {
    setSelectedCategories((current) => {
      const next = new Set(current);
      if (!next.delete(name)) next.add(name);
      return next;
    });
  }, []);

  /** Arten abwählen – alle oder nur diese. */
  const clearCategories = useCallback((names?: string[]) => {
    setSelectedCategories((current) => {
      if (!names) return new Set();
      const next = new Set(current);
      for (const name of names) next.delete(name);
      return next;
    });
  }, []);

  /** Wie viele Filter gerade greifen – Punkt am Knopf und „Zurücksetzen“. */
  const activeFilterCount =
    (sourcesFiltered ? 1 : 0) +
    selectedCategories.size +
    (availableOnly ? 1 : 0) +
    (freeOnly ? 1 : 0) +
    (savedOnly ? 1 : 0) +
    (timesOfDay.length > 0 ? 1 : 0) +
    (query ? 1 : 0);

  const reset = useCallback(() => {
    setSelectedSources(new Set());
    setSelectedCategories(new Set());
    setAvailableOnly(false);
    setFreeOnly(false);
    setSavedOnly(false);
    setTimesOfDay([]);
    setQuery('');
  }, []);

  return {
    events,
    /** Gewählte Quellen; leer = alle. */
    selectedSources,
    /** Tatsächlich sichtbare Quellen. */
    visible,
    sourcesFiltered,
    categories,
    selectedCategories,
    availableOnly,
    setAvailableOnly,
    freeOnly,
    setFreeOnly,
    savedOnly,
    setSavedOnly,
    savedCount,
    timesOfDay,
    toggleTimeOfDay,
    clearTimesOfDay,
    query,
    setQuery,
    space,
    restore,
    toggleSourceGroup,
    toggleSourceInGroup,
    onlySource,
    clearSources,
    toggleCategory,
    clearCategories,
    activeFilterCount,
    reset,
  };
}
