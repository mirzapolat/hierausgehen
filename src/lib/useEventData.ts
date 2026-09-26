import { useCallback, useEffect, useRef, useState } from 'react';
import type { AggregateResult } from '@/lib/events/types';

type Range = { from: string; to: string };

/** Solange die Daten einer anderen Stadt gehören, zeigt der Kalender nichts. */
const emptyResult: AggregateResult = { events: [], sources: [], definitions: [] };

/**
 * Der Datenstand zu Stadt und Zeitraum, mit Zwischenspeicher je Kombination.
 *
 * Der Stand trägt seine Stadt mit sich. Nur so zeigen Kopfzeile,
 * Quellenliste und Kalender zwangsläufig dieselbe Stadt: bis die Daten der
 * neuen Stadt da sind, gilt der Kalender als leer, statt kurz die Quellen der
 * alten Stadt unter dem neuen Namen zu zeigen.
 */
export function useEventData(options: {
  initialCityId: string;
  initialRange: Range;
  initialData: AggregateResult;
  cityId: string;
  range: Range;
}): AggregateResult {
  const { initialCityId, initialRange, initialData, cityId, range } = options;

  const [loaded, setLoaded] = useState({ cityId: initialCityId, result: initialData });
  const cache = useRef(new Map<string, AggregateResult>([[key(initialCityId, initialRange), initialData]]));
  /** Zuletzt angeforderter Datenstand – ältere Antworten laufen ins Leere. */
  const wanted = useRef(key(initialCityId, initialRange));

  const load = useCallback(async (target: Range, city: string) => {
    const cacheKey = key(city, target);
    wanted.current = cacheKey;
    if (cache.current.has(cacheKey)) {
      setLoaded({ cityId: city, result: cache.current.get(cacheKey)! });
      return;
    }
    try {
      const params = new URLSearchParams({ from: target.from, to: target.to, city });
      const res = await fetch(`/api/events?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const next = (await res.json()) as AggregateResult;
      cache.current.set(cacheKey, next);
      // Eine Antwort, die zu spät kommt, gehört nicht mehr auf den Schirm.
      if (wanted.current === cacheKey) setLoaded({ cityId: city, result: next });
    } catch (error) {
      console.error('[calendar] Laden fehlgeschlagen', error);
    }
  }, []);

  useEffect(() => {
    void load(range, cityId);
  }, [range, cityId, load]);

  return loaded.cityId === cityId ? loaded.result : emptyResult;
}

function key(cityId: string, range: Range): string {
  return `${cityId}_${range.from}_${range.to}`;
}
