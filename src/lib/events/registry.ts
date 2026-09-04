import type { EventSource } from './types.ts';
import { atgGlasgow } from './sources/atg-glasgow/index.ts';
import { citizens } from './sources/citizens/index.ts';
import { bahnwaerterthiel } from './sources/bahnwaerterthiel/index.ts';
import { deutschesTheater } from './sources/deutsches-theater/index.ts';
import { gasteig } from './sources/gasteig/index.ts';
import { gaertnerplatz } from './sources/gaertnerplatz/index.ts';
import { glasgowlife } from './sources/glasgowlife/index.ts';
import { kammerspiele } from './sources/kammerspiele/index.ts';
import { hmtm } from './sources/hmtm/index.ts';
import { importExport } from './sources/import-export/index.ts';
import { kinoamolympiasee } from './sources/kinoamolympiasee/index.ts';
import { kinomondsterne } from './sources/kinomondsterne/index.ts';
import { literaturhaus } from './sources/literaturhaus/index.ts';
import { lostweekend } from './sources/lostweekend/index.ts';
import { milla } from './sources/milla/index.ts';
import { muenchenmusik } from './sources/muenchenmusik/index.ts';
import { residenztheater } from './sources/residenztheater/index.ts';
import { staatsoper } from './sources/staatsoper/index.ts';
import { tron } from './sources/tron/index.ts';
import { theaterakademie } from './sources/theaterakademie/index.ts';
import { unterfahrt } from './sources/unterfahrt/index.ts';
import { volkstheater } from './sources/volkstheater/index.ts';
import { werkstattkino } from './sources/werkstattkino/index.ts';

/**
 * Alle bekannten Quellen. Eine neue Quelle wird ausschliesslich hier
 * registriert – Datenmodell, Aggregation, Kalender und UI bleiben unberührt.
 */
export const sources: EventSource[] = [
  staatsoper,
  gaertnerplatz,
  residenztheater,
  volkstheater,
  kammerspiele,
  deutschesTheater,
  theaterakademie,
  gasteig,
  muenchenmusik,
  hmtm,
  unterfahrt,
  lostweekend,
  milla,
  bahnwaerterthiel,
  importExport,
  literaturhaus,
  kinoamolympiasee,
  kinomondsterne,
  werkstattkino,
  glasgowlife,
  atgGlasgow,
  citizens,
  tron,
];

export const sourceById = new Map(sources.map((s) => [s.definition.id, s]));

export const sourceDefinitions = sources.map((s) => s.definition);

/** Quellen einer Stadt. */
export function sourcesForCity(cityId: string): EventSource[] {
  return sources.filter((source) => source.definition.cityId === cityId);
}
