import type { EventSource } from './types.ts';
import { deutschesTheater } from './sources/deutsches-theater/index.ts';
import { gasteig } from './sources/gasteig/index.ts';
import { gaertnerplatz } from './sources/gaertnerplatz/index.ts';
import { residenztheater } from './sources/residenztheater/index.ts';
import { staatsoper } from './sources/staatsoper/index.ts';
import { theaterakademie } from './sources/theaterakademie/index.ts';
import { volkstheater } from './sources/volkstheater/index.ts';

/**
 * Alle bekannten Quellen. Eine neue Quelle wird ausschliesslich hier
 * registriert – Datenmodell, Aggregation, Kalender und UI bleiben unberührt.
 */
export const sources: EventSource[] = [
  staatsoper,
  gaertnerplatz,
  residenztheater,
  volkstheater,
  deutschesTheater,
  theaterakademie,
  gasteig,
];

export const sourceById = new Map(sources.map((s) => [s.definition.id, s]));

export const sourceDefinitions = sources.map((s) => s.definition);

/** Quellen einer Stadt. */
export function sourcesForCity(cityId: string): EventSource[] {
  return sources.filter((source) => source.definition.cityId === cityId);
}
