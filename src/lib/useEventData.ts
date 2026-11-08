import { useCallback, useEffect, useRef, useState } from 'react';
import type { AggregateResult } from '@/lib/events/types';

type Range = { from: string; to: string };

/**
 * Solange die Daten einer anderen Stadt gehören, zeigt der Kalender nichts.
 * Exportiert, damit sich „lädt noch“ von „Stadt ohne Quellen“ unterscheiden
 * lässt – beide haben keine Definitionen, nur dieser Stand ist es per Identität.
 */
export const pendingResult: AggregateResult = { events: [], sources: [], definitions: [] };

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
  /**
   * Zeiträume, die als Nächstes gebraucht werden könnten, etwa beim Blättern.
   * Sie werden leise in den Zwischenspeicher geholt, ohne die Anzeige zu
   * ändern; ein Wechsel dorthin kommt dann ohne Wartezeit aus.
   */
  prefetch?: Range[];
}): AggregateResult {
  const { initialCityId, initialRange, initialData, cityId, range, prefetch } = options;

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

  /** Laufende Vorabrufe, damit derselbe Zeitraum nicht doppelt angefragt wird. */
  const inFlight = useRef(new Set<string>());
  const prefetchKey = prefetch?.map((target) => key(cityId, target)).join('|') ?? '';
  useEffect(() => {
    if (!prefetch?.length) return;
    // Erst wenn der Browser Luft hat: der sichtbare Zeitraum geht vor.
    const timer = window.setTimeout(() => {
      for (const target of prefetch) {
        const cacheKey = key(cityId, target);
        if (cache.current.has(cacheKey) || inFlight.current.has(cacheKey)) continue;
        inFlight.current.add(cacheKey);
        const params = new URLSearchParams({ from: target.from, to: target.to, city: cityId });
        fetch(`/api/events?${params}`)
          .then((res) => (res.ok ? (res.json() as Promise<AggregateResult>) : undefined))
          .then((next) => {
            if (next) cache.current.set(cacheKey, next);
          })
          .catch(() => undefined)
          .finally(() => inFlight.current.delete(cacheKey));
      }
    }, 400);
    return () => window.clearTimeout(timer);
    // `prefetchKey` fasst die Zeiträume zusammen; das Array selbst ist jedes Mal neu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefetchKey]);

  return loaded.cityId === cityId ? loaded.result : pendingResult;
}

function key(cityId: string, range: Range): string {
  return `${cityId}_${range.from}_${range.to}`;
}
