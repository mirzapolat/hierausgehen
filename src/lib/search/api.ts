import type { CalendarEvent, SourceDefinition } from '../events/types.ts';
import type { Breakdown, Facet, SearchResult } from './engine.ts';
import type { ParsedQuery } from './parse.ts';

/**
 * Was `/api/search` und die Suchseite austauschen – nur Typen und eine
 * Umformung, nichts, was den Server braucht. Die Oberfläche importiert von
 * hier, nie aus `service.ts`.
 */

export interface SearchHitPayload {
  key: string;
  event: CalendarEvent;
  /** Passende kommende Termine derselben Reihe, dieser eingeschlossen. */
  matching: number;
  score: number;
  tier: number;
  breakdown?: Breakdown;
}

export interface SearchPayload {
  query: string;
  cityId: string;
  parsed: ParsedQuery;
  hits: SearchHitPayload[];
  total: number;
  relaxed: Facet[];
  mode: SearchResult['mode'];
  lambda: number;
  alpha: number;
  semantic: boolean;
  semanticCoverage: number;
  definitions: SourceDefinition[];
}

export function toPayload(
  response: { query: string; cityId: string; parsed: ParsedQuery; result: SearchResult; semanticCoverage: number },
  definitions: SourceDefinition[],
): SearchPayload {
  const { result } = response;
  return {
    query: response.query,
    cityId: response.cityId,
    parsed: response.parsed,
    // Ganze Termine: die Vorschau rechts zeigt Beschreibung und weitere
    // Aufführungen. Gekürzt wird in der Liste per CSS.
    hits: result.hits.map((hit) => ({
      key: hit.key,
      event: hit.event,
      matching: hit.matching,
      score: hit.score,
      tier: hit.tier,
      ...(hit.breakdown ? { breakdown: hit.breakdown } : {}),
    })),
    total: result.total,
    relaxed: result.relaxed,
    mode: result.mode,
    lambda: result.lambda,
    alpha: result.alpha,
    semantic: result.semantic,
    semanticCoverage: response.semanticCoverage,
    definitions,
  };
}

/** Adresse der Suche – auch für Links aus dem Kalender. */
export function searchUrl(query: string, cityId: string): string {
  const params = new URLSearchParams();
  if (query.trim()) params.set('q', query.trim());
  params.set('city', cityId);
  return `/search?${params}`;
}

