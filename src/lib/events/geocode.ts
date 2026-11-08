import type { CalendarEvent, EventPlace, SourceDefinition } from './types.ts';
import { isFresh, readCache, writeCache } from './cache.ts';
import { cityById, distanceKm, type City, type GeoPoint } from '../cities.ts';

/**
 * Aus einem Ortsnamen einen Punkt auf der Karte machen.
 *
 * Die Quellen nennen nur Namen, und meistens sind es Raumnamen: "Silbersaal",
 * "Bühne 1", "Foyer", "Saal & Stream". Für die Kartenansicht braucht es
 * Koordinaten. Die kommen von **Nominatim** (OpenStreetMap), ohne Schlüssel
 * und ohne Anmeldung, und werden auf der Platte behalten – ein Name wird
 * genau einmal aufgelöst und danach ein halbes Jahr lang nicht mehr.
 *
 * Der Grundsatz "keine erfundenen Daten" gilt hier besonders: ein falscher
 * Pin ist schlimmer als gar keiner. Ein Treffer zählt deshalb nur, wenn drei
 * Dinge stimmen:
 *
 * 1. **Der Name passt.** "Bühne 1" findet in München eine "Kleine Bühne" in
 *    Pasing – acht Kilometer daneben. Der Vergleich der Namen wirft das weg.
 * 2. **Die Art passt.** "Nationaltheater" liefert zuerst drei Tramhaltestellen
 *    und erst danach das Theater. Verkehrswege, Grenzen und Ortsteile zählen
 *    nicht als Veranstaltungsort.
 * 3. **Die Entfernung passt.** Alles weiter als {@link MAX_DISTANCE_KM} vom
 *    Stadtzentrum ist nicht der gesuchte Ort – oder ein Gastspiel in einer
 *    anderen Stadt, das auf dieser Karte ohnehin nichts zu suchen hat.
 *
 * Findet sich der Raumname nicht, greift das **Haus der Quelle**: der
 * "Silbersaal" liegt im Deutschen Theater, und wo das steht, weiss
 * OpenStreetMap. Das ist der Unterschied zwischen `from: 'venue'` und
 * `from: 'house'`. Findet sich auch das Haus nicht – MünchenMusik etwa ist
 * ein Veranstalter ohne eigenes Haus –, bleibt der Termin ohne Ort und
 * erscheint in der Kartenansicht in der Liste darunter. Sichtbar fehlend
 * statt falsch gesetzt.
 *
 * `npm run venues` zeigt die ganze Tabelle: welcher Name zu welchem Punkt
 * wurde, woher er kommt und was offen blieb.
 */

const ENDPOINT = 'https://nominatim.openstreetmap.org/search';

/**
 * Nominatim verlangt eine benennbare Anwendung samt Kontakt – ohne die sperrt
 * der Dienst, und zu Recht. Hier steht deshalb, wer fragt und wofür.
 */
const USER_AGENT = 'hierausgehen.de (Veranstaltungskalender, Ortsauflösung; info@hierausgehen.de)';

/** Ein gefundener Ort zieht nicht um. */
const HIT_TTL_SECONDS = 180 * 24 * 60 * 60;
/**
 * Ein Fehlschlag dagegen kann sich beheben: OpenStreetMap wächst. Nach zwei
 * Wochen wird ein unbekannter Name noch einmal gefragt.
 */
const MISS_TTL_SECONDS = 14 * 24 * 60 * 60;

/** Nominatims Nutzungsregeln: höchstens eine Abfrage je Sekunde. */
const MIN_REQUEST_GAP_MS = 1_100;

/**
 * Höchstens so viele neue Namen je Lauf – der Rest kommt beim nächsten.
 *
 * Grosszügig, weil das nur den allerersten Lauf betrifft: ein Jahresprogramm
 * aller Häuser sind rund 150 verschiedene Ortsnamen, und die will man in einem
 * Zug hinter sich bringen. Danach steht jeder davon ein halbes Jahr im
 * Zwischenspeicher und kostet keine Abfrage mehr. Die Rücksicht auf den Dienst
 * steckt im Sekundenabstand, nicht in der Gesamtzahl.
 */
const MAX_LOOKUPS = 250;
/** Und höchstens so lange insgesamt; die Erhebung soll daran nicht hängen. */
const DEFAULT_BUDGET_MS = 6 * 60_000;

/** Weiter weg ist nicht mehr diese Stadt. */
export const MAX_DISTANCE_KM = 50;

/**
 * So nah muss ein Raum am Haus liegen, um als dessen Raum durchzugehen.
 *
 * Der Werkraum der Kammerspiele liegt 50 Meter vom Haupthaus, die Brasserie
 * des Literaturhauses 5 Meter. Was weiter weg liegt, ist ein anderer Ort mit
 * demselben Allerweltsnamen.
 */
const ROOM_RADIUS_KM = 0.3;

/**
 * Kategorien, die nie ein Veranstaltungsort sind. Haltestellen tragen die
 * Namen der Häuser, vor denen sie stehen – genau deshalb steht `highway` hier.
 */
const REJECTED_CATEGORIES = new Set([
  'highway',
  'railway',
  'waterway',
  'boundary',
  'place',
  'natural',
  'landuse',
  'route',
  'barrier',
  'power',
  'man_made',
]);

/**
 * Namen, die gar keinen Ort meinen. Bewusst am Anfang verankert: "per Zoom"
 * ist ortlos, "Saal & Stream" ist ein Saal, der zusätzlich übertragen wird.
 * "nicht im zakk" und "ausser Haus" sagen nur, dass es woanders stattfindet –
 * fiele das aufs Haus zurück, stünde der Pin falsch.
 */
const PLACELESS =
  /^(stream|livestream|online|per\s+zoom|zoom|digital|gastspiel|tba|tbd|ort\s+folgt|nicht\s+im|au(?:ss|ß)er\s+haus)\b/i;

/**
 * Allerweltsnamen für Räume.
 *
 * Sie sind der gefährlichste Fall: München hat einen "Theatersaal" in Solln,
 * einen "Saal" bei den Zeugen Jehovas und eine "Bibliothek" im Deutschen
 * Museum – alle heissen exakt so, wie der Raum im Spielplan heisst, und alle
 * sind der falsche Ort. Ein Name, der **nur** aus solchen Wörtern besteht,
 * wird deshalb nur dann als eigener Ort genommen, wenn er direkt am Haus der
 * Quelle liegt ({@link ROOM_RADIUS_KM}). "Saal X" und "Halle E" enthalten mit
 * dem Buchstaben etwas Eigenes und fallen nicht darunter.
 */
const GENERIC_ROOM = new Set([
  'saal', 'foyer', 'buhne', 'halle', 'raum', 'zimmer', 'haus', 'hof', 'garten', 'keller',
  'bibliothek', 'galerie', 'studio', 'studiobuhne', 'probebuhne', 'probenbuhne', 'probensaal',
  'theatersaal', 'konzertsaal', 'ballsaal', 'kammersaal', 'grosser', 'grosses', 'kleiner',
  'kleines', 'forum', 'salon', 'lounge', 'bar', 'cafe', 'restaurant', 'buro', 'kasse',
  'werkstatt', 'kiosk', 'buhnen', 'sale', 'oben', 'unten', 'neu', 'alt', 'altes', 'neues',
]);

/** Füllwörter, die eine Suche eher stören als führen ("Seebühne im Westpark"). */
const FILLER = /\b(im|am|an|in|auf|bei|beim|zum|zur|der|die|das|den|dem|des)\b/gi;

/**
 * Ortsnamen, unter denen OpenStreetMap den Ort nicht findet – hier steht,
 * wonach stattdessen gesucht wird. Der Schlüssel ist der Name in der
 * Schreibweise von {@link nameMatches} (klein, ohne Sonderzeichen).
 *
 * Bewusst die Ausnahme und nicht die Regel: was hier steht, ist Handarbeit,
 * die bei der nächsten Umbenennung veraltet. `npm run venues` zeigt, ob ein
 * Eintrag nötig ist.
 */
const OVERRIDES: Record<string, string> = {
  // Die Theaterakademie ist als Einrichtung nicht kartiert; ihr Haus ist das
  // Prinzregententheater, und dort liegt auch das Akademietheater.
  'theaterakademie august everding': 'Prinzregententheater',
  // In OpenStreetMap heisst das Haus am Uhlhornsweg schlicht „unikum“.
  'theater unikum': 'Unikum',
};

export interface LocateOptions {
  cityId: string;
  signal?: AbortSignal;
  /** Zeitfenster für neue Abfragen; abgelaufen heisst: der Rest wartet. */
  budgetMs?: number;
  maxLookups?: number;
}

/**
 * Allen Terminen ihren Ort zuordnen.
 *
 * Aufgelöst wird je Quelle und Ortsname genau einmal, nicht je Termin: 2300
 * Termine sind rund hundert verschiedene Namen. Fehler bleiben folgenlos – ein
 * Termin ohne Punkt ist ein Termin ohne Punkt, kein kaputter Datenstand.
 */
export async function locateEvents(
  events: CalendarEvent[],
  definitions: SourceDefinition[],
  options: LocateOptions,
): Promise<CalendarEvent[]> {
  const city = cityById(options.cityId);
  const budget = new Budget(options.budgetMs ?? DEFAULT_BUDGET_MS, options.maxLookups ?? MAX_LOOKUPS);
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));

  // Nach Quelle und Ortsname bündeln – das ist die Einheit, die aufgelöst wird.
  const groups = new Map<string, { sourceId: string; venue: string; events: CalendarEvent[] }>();
  for (const event of events) {
    const key = `${event.sourceId}|${event.venue.name}`;
    const group = groups.get(key);
    if (group) group.events.push(event);
    else groups.set(key, { sourceId: event.sourceId, venue: event.venue.name, events: [event] });
  }

  const located = new Map<string, EventPlace | undefined>();
  for (const group of groups.values()) {
    try {
      located.set(
        `${group.sourceId}|${group.venue}`,
        await resolveVenue(group.venue, byId.get(group.sourceId), city, budget, options.signal),
      );
    } catch (error) {
      console.warn(`[geocode] "${group.venue}" nicht aufgelöst`, error);
    }
  }

  return events.map((event) => {
    const place = located.get(`${event.sourceId}|${event.venue.name}`);
    if (!place) return event;
    return { ...event, venue: { ...event.venue, place } };
  });
}

/**
 * Einen einzelnen Ortsnamen auflösen: erst der Name selbst, dann das Haus der
 * Quelle.
 *
 * Wichtig ist der mittlere Schritt: **hat der Name irgendwo weit weg einen
 * guten Treffer, gibt es keinen Rückfall auf das Haus.** "Baden-Baden" und
 * "Ludwigsburg, Forum am Schloßpark" stehen so im Spielplan der Häuser; sie an
 * deren Adresse zu setzen wäre schlicht falsch. Lieber ohne Ort.
 */
export async function resolveVenue(
  venueName: string,
  definition: SourceDefinition | undefined,
  city: City,
  budget: Budget,
  signal?: AbortSignal,
): Promise<EventPlace | undefined> {
  const name = venueName.trim();
  if (PLACELESS.test(name)) return undefined;

  // Das Haus zuerst: es ist der Massstab, an dem sich ein Raumname messen
  // lassen muss, und nach dem ersten Mal kostet es nichts mehr.
  const house = definition ? await resolveHouse(definition, city, budget, signal) : undefined;

  const found = await lookupAll(queryVariants(OVERRIDES[comparable(name)] ?? name), city, budget, signal);

  if (found.near) {
    const room = isGenericRoom(name);
    // Ein Allerweltsname zählt nur direkt am Haus; ohne Haus zählt er gar nicht.
    if (!room) return { ...found.near, from: 'venue' };
    if (house && distanceKm(found.near.point, house.point) <= ROOM_RADIUS_KM) {
      return { ...found.near, from: 'venue' };
    }
  } else if (found.far) {
    // Ein Treffer ausserhalb der Stadt ist kein Raum im Haus der Quelle,
    // sondern ein Gastspiel anderswo. Dann lieber gar kein Punkt.
    return undefined;
  }

  return house ? { ...house, from: 'house' } : undefined;
}

/** Wo die Quelle selbst zu Hause ist. */
async function resolveHouse(
  definition: SourceDefinition,
  city: City,
  budget: Budget,
  signal?: AbortSignal,
): Promise<{ name: string; point: GeoPoint } | undefined> {
  const query = OVERRIDES[comparable(definition.name)] ?? definition.name;
  const found = await lookupAll(queryVariants(query), city, budget, signal, {
    // Der Quellenname wird nicht gegen den Fundnamen geprüft: die
    // Bayerische Staatsoper heisst bei OpenStreetMap "Bayerisches
    // Nationaltheater". Art und Entfernung sichern den Treffer.
    checkName: false,
  });
  return found.near;
}

/**
 * Besteht der Name nur aus Allerweltswörtern? Dann ist er ein Raum, kein Ort.
 * Zahlen und Buchstaben zählen als eigener Bestandteil ("Bühne 1", "Saal X").
 */
export function isGenericRoom(name: string): boolean {
  const tokens = comparable(name).split(' ').filter(Boolean);
  if (tokens.length === 0) return false;
  return tokens.every((token) => GENERIC_ROOM.has(token));
}

/* ---------------------------- reine Bausteine ---------------------------- */

/**
 * Die Schreibweisen, unter denen ein Name gesucht wird – in der Reihenfolge,
 * in der sie versucht werden.
 *
 * "Isarphilharmonie, Gasteig HP8" findet sich unter dem ersten Teil,
 * "Seebühne im Westpark" erst ohne das Füllwort.
 */
export function queryVariants(name: string): string[] {
  const full = name.replace(/\s+/g, ' ').trim();
  const head = full.split(/\s*[–—/,(|]\s*/)[0].trim();
  const withoutFiller = head.replace(FILLER, ' ').replace(/\s+/g, ' ').trim();
  return [...new Set([full, head, withoutFiller])].filter((variant) => variant.length >= 3);
}

/**
 * Taugt der Fund als Veranstaltungsort? Art und – sofern verlangt – Name
 * müssen passen; die Entfernung entscheidet der Aufrufer, weil ein weiter
 * Treffer eine eigene Bedeutung hat.
 */
export function plausible(
  result: NominatimResult,
  query: string,
  options: { checkName?: boolean } = {},
): boolean {
  if (REJECTED_CATEGORIES.has(result.category ?? '')) return false;
  if (options.checkName === false) return true;
  return nameMatches(query, result.name || result.display_name);
}

/**
 * Heisst der Fund so, wie gesucht wurde?
 *
 * Zwei Richtungen sind erlaubt: der Fund darf ausführlicher sein ("Milla" →
 * "Milla Club"), und der gesuchte Name darf mit dem Fund beginnen
 * ("Prinzregententheater – Großes Haus" → "Prinzregententheater"). Alles
 * andere ist ein anderer Ort, mag er noch so ähnlich klingen.
 */
export function nameMatches(query: string, found: string): boolean {
  const q = comparable(query);
  const f = comparable(found);
  if (!q || !f) return false;
  return f.includes(q) || q === f || q.startsWith(`${f} `);
}

function comparable(text: string): string {
  return text
    .toLocaleLowerCase('de-DE')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/* ------------------------------- Abfragen -------------------------------- */

export interface NominatimResult {
  lat: string;
  lon: string;
  name?: string;
  display_name: string;
  category?: string;
  type?: string;
}

interface Found {
  /** Passender Treffer in der Stadt. */
  near?: { name: string; point: GeoPoint };
  /** Passender Treffer, aber zu weit weg – ein anderer Ort gleichen Namens. */
  far?: boolean;
}

/** Hält Zeit- und Abfragebudget eines Laufs zusammen. */
export class Budget {
  private readonly until: number;
  private left: number;

  constructor(ms: number, lookups: number) {
    this.until = Date.now() + ms;
    this.left = lookups;
  }

  /** Ist noch Luft für eine Abfrage, die wirklich ins Netz geht? */
  allows(): boolean {
    return this.left > 0 && Date.now() < this.until;
  }

  spend(): void {
    this.left--;
  }
}

async function lookupAll(
  variants: string[],
  city: City,
  budget: Budget,
  signal?: AbortSignal,
  options: { checkName?: boolean } = {},
): Promise<Found> {
  let far = false;
  for (const variant of variants) {
    const results = await lookup(variant, city, budget, signal);
    for (const result of results) {
      if (!plausible(result, variant, options)) continue;
      const point = { latitude: Number(result.lat), longitude: Number(result.lon) };
      if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) continue;
      if (distanceKm(point, city.coordinates) <= MAX_DISTANCE_KM) {
        return { near: { name: result.name || variant, point } };
      }
      far = true;
    }
  }
  return { far };
}

/** Eine Abfrage – aus dem Zwischenspeicher, sonst aus dem Netz. */
async function lookup(
  query: string,
  city: City,
  budget: Budget,
  signal?: AbortSignal,
): Promise<NominatimResult[]> {
  const key = cacheKey(query, city.id);
  const cached = await readCache<NominatimResult[]>(key);
  if (isFresh(cached)) return cached!.value;

  if (!budget.allows()) return cached?.value ?? [];
  budget.spend();

  const results = await request(`${query} ${city.name}`, city.country, signal);
  await writeCache(key, results, results.length > 0 ? HIT_TTL_SECONDS : MISS_TTL_SECONDS);
  return results;
}

function cacheKey(query: string, cityId: string): string {
  return `place_${cityId}_${comparable(query).replace(/\s+/g, '-')}`;
}

let nextRequestAt = 0;

async function request(
  query: string,
  country: string,
  signal?: AbortSignal,
): Promise<NominatimResult[]> {
  // Die Regeln des Dienstes gelten für den ganzen Prozess, nicht je Aufruf.
  const wait = nextRequestAt - Date.now();
  nextRequestAt = Math.max(Date.now(), nextRequestAt) + MIN_REQUEST_GAP_MS;
  if (wait > 0) await sleep(wait, signal);

  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    limit: '5',
    // Das Land kommt aus der Stadt, nicht aus dem Code: sonst findet Glasgow
    // nichts und München fände irgendwas.
    countrycodes: country.toLowerCase(),
  });

  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort);
  const timer = setTimeout(abort, 10_000);

  try {
    const response = await fetch(`${ENDPOINT}?${params}`, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'de', Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Nominatim: HTTP ${response.status}`);
    const body = (await response.json()) as NominatimResult[];
    return Array.isArray(body) ? body : [];
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error('abgebrochen'));
    });
  });
}
