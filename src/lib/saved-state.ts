import { matchesText } from './events/filter.ts';
import { seriesKey } from './events/series.ts';
import type { CalendarEvent } from './events/types.ts';
import { isLocale, translateTerm, type Locale } from './i18n.ts';

/**
 * Die Merkliste: Termine, die sich jemand vormerkt. Sie liegt nur auf diesem
 * Gerät (`localStorage`) – kein Konto. Der Server sieht sie nur, um auf der
 * Merkliste die Termine dazu zu liefern, und behält nichts davon.
 *
 * Drei Arten von Einträgen:
 * - ein einzelner Termin – gemerkt wird die ID samt Beginn. Der Beginn
 *   erlaubt, Vergangenes von selbst aufzuräumen, ohne die Termine dafür laden
 *   zu müssen.
 * - eine ganze Reihe – gemerkt wird nicht jeder Termin, sondern der
 *   Schlüssel der Reihe (`events/series.ts`). Alles, was dazu passt, gilt als
 *   gemerkt, auch Termine, die erst später ins Programm kommen.
 * - eine Suche in einer Stadt – alles, was sie findet, gilt als gemerkt.
 *
 * Reihen und Suchen sind Regeln, keine Listen. Einzeln entfernte Termine
 * stehen deshalb als Ausnahme daneben.
 */

export const SAVED_STORAGE_KEY = 'hierausgehen.saved.v1';

export interface SavedEntry {
  id: string;
  /** Beginn des Termins, ISO-8601 wie am `CalendarEvent`. */
  start: string;
  /** Ende, falls bekannt – Mehrtägiges bleibt bis dahin gemerkt. */
  end?: string;
}

export interface SavedSeries {
  /** Schlüssel der Reihe, siehe `seriesKey`. */
  key: string;
  /** Titel zum Anzeigen. */
  title: string;
  /** Termine der Reihe, die ausdrücklich nicht gemerkt sein sollen. */
  except: SavedEntry[];
}

export interface SavedSearch {
  query: string;
  /** Gesucht wurde im Kalender dieser Stadt. */
  cityId: string;
  /** Sprache beim Merken – „Concert“ findet das Konzert nur auf Englisch. */
  locale: Locale;
  except: SavedEntry[];
}

export interface SavedState {
  events: SavedEntry[];
  series: SavedSeries[];
  searches: SavedSearch[];
}

/** Was ein Termin mitbringen muss, um gemerkt oder geprüft zu werden. */
export type SavableEvent = Pick<CalendarEvent, 'id' | 'start' | 'end' | 'sourceId' | 'title' | 'venue'> &
  Partial<Pick<CalendarEvent, 'subtitle' | 'description' | 'category' | 'categoryLabel' | 'relatedPerformances'>>;

/** Warum ein Termin auf der Liste steht – es können mehrere Gründe sein. */
export type SavedReason = { kind: 'event' } | { kind: 'series' } | { kind: 'search'; query: string };

/** Was gemerkt oder vergessen wird: der Termin, seine Reihe oder eine Suche. */
export type SaveScope = { kind: 'event' } | { kind: 'series' } | { kind: 'search'; query: string };

/** So lange bleibt ein vergangener Termin noch auf der Liste. */
const KEEP_AFTER_MS = 24 * 60 * 60 * 1000;

export const EMPTY_STATE: SavedState = { events: [], series: [], searches: [] };

/**
 * Unlesbares fällt weg, Vergangenes nach einem Tag, Doppeltes einmal. Die
 * erste Fassung war eine blosse Liste von Terminen – sie wird übernommen.
 */
export function normalizeSaved(value: unknown, now: Date = new Date()): SavedState {
  if (Array.isArray(value)) return { ...EMPTY_STATE, events: normalizeEntries(value, now) };
  if (!value || typeof value !== 'object') return EMPTY_STATE;
  const { events, series, searches } = value as Partial<Record<keyof SavedState, unknown>>;

  const seenSeries = new Set<string>();
  const outSeries: SavedSeries[] = [];
  for (const entry of records(series)) {
    const { key, title, except } = entry as Partial<Record<keyof SavedSeries, unknown>>;
    if (typeof key !== 'string' || !key || seenSeries.has(key)) continue;
    seenSeries.add(key);
    outSeries.push({ key, title: typeof title === 'string' ? title : '', except: normalizeEntries(except, now) });
  }

  const seenSearches = new Set<string>();
  const outSearches: SavedSearch[] = [];
  for (const entry of records(searches)) {
    const { query, cityId, locale, except } = entry as Partial<Record<keyof SavedSearch, unknown>>;
    if (typeof query !== 'string' || typeof cityId !== 'string') continue;
    const clean = query.trim();
    const id = searchId(clean, cityId);
    if (!clean || seenSearches.has(id)) continue;
    seenSearches.add(id);
    outSearches.push({
      query: clean,
      cityId,
      locale: typeof locale === 'string' && isLocale(locale) ? locale : 'de',
      except: normalizeEntries(except, now),
    });
  }

  return { events: normalizeEntries(events, now), series: outSeries, searches: outSearches };
}

function records(value: unknown): object[] {
  return Array.isArray(value) ? value.filter((entry) => entry && typeof entry === 'object') : [];
}

function normalizeEntries(value: unknown, now: Date): SavedEntry[] {
  const seen = new Set<string>();
  const out: SavedEntry[] = [];
  for (const entry of records(value)) {
    const { id, start, end } = entry as Partial<SavedEntry>;
    if (typeof id !== 'string' || typeof start !== 'string' || seen.has(id)) continue;
    const last = Date.parse(typeof end === 'string' ? end : start);
    if (Number.isFinite(last) && last + KEEP_AFTER_MS < now.getTime()) continue;
    seen.add(id);
    out.push(typeof end === 'string' ? { id, start, end } : { id, start });
  }
  return out;
}

function entryOf(event: Pick<CalendarEvent, 'id' | 'start' | 'end'>): SavedEntry {
  return event.end ? { id: event.id, start: event.start, end: event.end } : { id: event.id, start: event.start };
}

/** Gross/klein und Ränder zählen nicht: „Jazz “ ist dieselbe Suche wie „jazz“. */
function searchId(query: string, cityId: string): string {
  return `${cityId}\u0000${query.trim().toLocaleLowerCase()}`;
}

/** Findet die gemerkte Suche diesen Termin? `cityId` ist die Stadt des Termins. */
export function searchMatches(search: SavedSearch, event: SavableEvent, cityId: string | undefined): boolean {
  if (cityId !== search.cityId) return false;
  return matchesText(event as CalendarEvent, search.query, search.locale, (value) =>
    translateTerm(search.locale, value),
  );
}

const excepted = (except: SavedEntry[], id: string) => except.some((entry) => entry.id === id);

/**
 * Warum der Termin gemerkt ist – leer, wenn gar nicht. Suchen gelten nur in
 * ihrer Stadt; ohne `cityId` zählen sie nicht.
 */
export function savedReasons(state: SavedState, event: SavableEvent, cityId?: string): SavedReason[] {
  const reasons: SavedReason[] = [];
  if (state.events.some((entry) => entry.id === event.id)) reasons.push({ kind: 'event' });
  // Der Schlüssel kostet etwas – im Kalender wird jeder Termin geprüft.
  const key = state.series.length > 0 ? seriesKey(event) : undefined;
  if (state.series.some((entry) => entry.key === key && !excepted(entry.except, event.id))) {
    reasons.push({ kind: 'series' });
  }
  for (const search of state.searches) {
    if (!excepted(search.except, event.id) && searchMatches(search, event, cityId)) {
      reasons.push({ kind: 'search', query: search.query });
    }
  }
  return reasons;
}

/** Gehört der Termin zu einer Reihe, nach der sich fragen lohnt? */
export function inSeries(state: SavedState, event: SavableEvent): boolean {
  if (event.relatedPerformances?.length) return true;
  const key = seriesKey(event);
  return state.series.some((entry) => entry.key === key);
}

/** Einen Termin oder seine ganze Reihe merken. */
export function saveEvent(
  state: SavedState,
  event: SavableEvent,
  scope: 'event' | 'series',
  cityId?: string,
): SavedState {
  const key = seriesKey(event);
  if (scope === 'series') {
    // Einzelne Einträge der Reihe wären dann doppelt gemerkt – sie gehen in der Reihe auf.
    const members = seriesMembers(event);
    return {
      ...state,
      events: state.events.filter((entry) => !members.has(entry.id)),
      series: [...state.series.filter((entry) => entry.key !== key), { key, title: event.title, except: [] }],
    };
  }
  if (savedReasons(state, event, cityId).length > 0) return state;
  const unexcept = <T extends { except: SavedEntry[] }>(entry: T): T =>
    excepted(entry.except, event.id) ? { ...entry, except: entry.except.filter((e) => e.id !== event.id) } : entry;
  // Ausgenommen aus einer Reihe oder Suche: die Ausnahme fällt, die Regel greift wieder.
  const released: SavedState = {
    ...state,
    series: state.series.map((entry) => (entry.key === key ? unexcept(entry) : entry)),
    searches: state.searches.map((search) => (searchMatches(search, event, cityId) ? unexcept(search) : search)),
  };
  if (savedReasons(released, event, cityId).length > 0) return released;
  return { ...state, events: [...state.events, entryOf(event)] };
}

/** Einen Termin, seine ganze Reihe oder die Suche, die ihn fand, vergessen. */
export function unsaveEvent(state: SavedState, event: SavableEvent, scope: SaveScope, cityId?: string): SavedState {
  const key = seriesKey(event);
  if (scope.kind === 'series') {
    const members = seriesMembers(event);
    return {
      ...state,
      events: state.events.filter((entry) => !members.has(entry.id)),
      series: state.series.filter((entry) => entry.key !== key),
    };
  }
  if (scope.kind === 'search') {
    return unsaveSearch(state, scope.query, cityId ?? '');
  }
  // Über eine Regel gemerkt: dieser Termin wird zur Ausnahme, die Regel bleibt.
  const except = <T extends { except: SavedEntry[] }>(entry: T): T =>
    excepted(entry.except, event.id) ? entry : { ...entry, except: [...entry.except, entryOf(event)] };
  return {
    events: state.events.filter((entry) => entry.id !== event.id),
    series: state.series.map((entry) => (entry.key === key ? except(entry) : entry)),
    searches: state.searches.map((search) => (searchMatches(search, event, cityId) ? except(search) : search)),
  };
}

/** Ist diese Suche in dieser Stadt gemerkt? */
export function hasSearch(state: SavedState, query: string, cityId: string): boolean {
  const id = searchId(query, cityId);
  return state.searches.some((search) => searchId(search.query, search.cityId) === id);
}

export function saveSearch(state: SavedState, query: string, cityId: string, locale: Locale): SavedState {
  const clean = query.trim();
  if (!clean || hasSearch(state, clean, cityId)) return state;
  return { ...state, searches: [...state.searches, { query: clean, cityId, locale, except: [] }] };
}

export function unsaveSearch(state: SavedState, query: string, cityId: string): SavedState {
  const id = searchId(query, cityId);
  return { ...state, searches: state.searches.filter((search) => searchId(search.query, search.cityId) !== id) };
}

function seriesMembers(event: SavableEvent): Set<string> {
  return new Set([event.id, ...(event.relatedPerformances ?? []).map((performance) => performance.id)]);
}
