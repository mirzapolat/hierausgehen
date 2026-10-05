'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { seriesKey, type SeriesRun } from './events/series';

/**
 * Die Reihen des geladenen Bestands (`seriesRuns`) für alle Listen und
 * Zellen darunter. Ohne Anbieter – etwa auf der Merkliste – ist nichts über
 * Reihen bekannt, und jeder Termin steht für sich.
 */
const SeriesContext = createContext<ReadonlyMap<string, SeriesRun>>(new Map());

export function SeriesProvider({ runs, children }: { runs: ReadonlyMap<string, SeriesRun>; children: ReactNode }) {
  return <SeriesContext.Provider value={runs}>{children}</SeriesContext.Provider>;
}

export function useSeriesRuns(): ReadonlyMap<string, SeriesRun> {
  return useContext(SeriesContext);
}

/** Die Reihe eines Termins – nur, wenn es ausser ihm noch Termine gibt. */
export function runOf(
  runs: ReadonlyMap<string, SeriesRun>,
  event: Parameters<typeof seriesKey>[0],
): SeriesRun | undefined {
  const run = runs.get(seriesKey(event));
  return run && run.count > 1 ? run : undefined;
}
