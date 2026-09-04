import type { Availability, CalendarEvent } from '../../types.ts';
import { zonedIso } from '../../time.ts';
import { clean, decodeEntities } from '../../text.ts';

/**
 * Parser für das Pavilion Theatre Glasgow bei Trafalgar Tickets
 * (`https://trafalgartickets.com/pavilion-theatre-glasgow/en-GB/whats-on`).
 *
 * Das Haus verkauft über die Plattform von Trafalgar Entertainment, eine
 * Next.js-Anwendung. Sie antwortet an zwei Stellen, und die trennen dasselbe
 * wie bei ATG: die Übersicht kennt **Stücke**, die Produktionsseite kennt
 * **Vorstellungen**.
 *
 *  1. **Die Übersicht** trägt ihre Daten als RSC-Nutzlast im HTML
 *     (`self.__next_f.push([1,"…"])`). Darin steht jedes Stück zweimal, beide
 *     Male als Objekt mit `eventGroupId`: einmal die Anzeigekarte (Adresse,
 *     Laufzeit als Text, Preis ab, Ticketsignale), einmal die Stammdaten
 *     (Gattungen, Veranstalter, Haus und Saal). Über die `eventGroupId` gehören
 *     sie zusammen. Gelesen werden die Daten, nicht das Markup – die
 *     Tailwind-Klassen wechseln mit jedem Build, `eventGroupId` nicht.
 *
 *     Der Knopf „Load more" täuscht: die Seite hat alle Stücke schon geladen
 *     und blendet nur nach und nach mehr ein. Ein Abruf genügt für den ganzen
 *     Spielplan; einen Zeitraumparameter gibt es nicht.
 *
 *  2. **Die Produktionsseite** trägt die Vorstellungen als `schema.org`-Event
 *     – ein `offers`-Eintrag je Abend, mit Ticketadresse,
 *     Preis, Ticketlage und dem Zeitpunkt in `validThrough`. Das ist die
 *     einzige Stelle, die alle Abende nennt: die Weihnachtspantomime führt so
 *     achtundsechzig, die Anzeigekarte nur „Thu 26 Nov 2026 - Sun 10 Jan
 *     2027". Denselben Abruf liefert auch der lange Ankündigungstext
 *     (`richTextDescription` in der RSC-Nutzlast).
 *
 * **Zeitzone:** die Zeitpunkte sind echtes UTC, kein als `Z` verkleideter
 * Wandkalender. Nachgeprüft an Dylan Moran am 16.5.2027 (Sommerzeit): die
 * Seite meldet `19:00Z`, die Kasse „08:00 PM". Umgerechnet wird deshalb über
 * die Zeitzone, nie durch Abschneiden des `Z`.
 *
 * Zur `robots.txt`: `Allow: /` – nichts gesperrt.
 */

export const SOURCE_ID = 'pavilion-glasgow';
export const BASE = 'https://trafalgartickets.com/pavilion-theatre-glasgow/en-GB';
export const HOMEPAGE = 'https://trafalgartickets.com/pavilion-theatre-glasgow';
export const LIST_URL = `${BASE}/whats-on`;
export const TIME_ZONE = 'Europe/London';

/** Ein Stück aus der Übersicht – noch kein Termin. */
export interface ShowCard {
  /** `eventGroupId`; Teil der Termin-ID nur ersatzweise. */
  id: string;
  title: string;
  /** Gattungen im Wortlaut der Quelle ("Play", "Music", "Pantomime"). */
  categories: string[];
  /** Produzent oder Tourneeveranstalter, falls die Quelle einen nennt. */
  promoter?: string;
  /** Haus, wie die Quelle es schreibt ("The Pavilion Theatre"). */
  venue?: string;
  /** Saal ("Main Auditorium"). */
  subVenue?: string;
  /** Günstigster Preis des Stücks in Pfund. */
  minPrice?: number;
  /** Produktionsseite. */
  url: string;
  /** Laufzeit im Wortlaut ("Thu 26 Nov 2026 - Sun 10 Jan 2027"). */
  runLabel: string;
  /** Erster Tag des Laufs, `YYYY-MM-DD` Ortszeit. */
  runFrom?: string;
  /** Letzter Tag des Laufs. */
  runTo?: string;
  /** Beginn des ersten Abends – die Rückfalladresse für „Vorverkauf folgt". */
  firstStart?: string;
  /** „Sold out" an der Karte: jeder Abend des Laufs ist weg. */
  allSoldOut: boolean;
  /** „Selling Fast" an der Karte. */
  fewLeft: boolean;
  /** „On sale soon": das Stück steht im Spielplan, der Verkauf läuft nicht. */
  onSaleSoon: boolean;
}

export interface ParsedList {
  shows: ShowCard[];
  /** Ist das überhaupt die Übersicht? Sonst: Aufbau geändert. */
  recognised: boolean;
}

// ------------------------------------------------------------- Übersicht

/**
 * Die Stücke der Übersicht.
 *
 * Anzeigekarte und Stammdaten werden über die `eventGroupId` zusammengelegt.
 * Ein Stück ohne Karte hat keine Laufzeit und käme nie in einen Zeitraum –
 * es fällt weg.
 */
export function parseListPage(html: string): ParsedList {
  const payload = flightPayload(html);
  const objects = eventGroupObjects(payload);
  if (objects.length === 0) return { shows: [], recognised: false };

  const meta = new Map<string, RawGroup>();
  const cards = new Map<string, RawGroup>();
  for (const object of objects) {
    const id = groupId(object);
    if (!id) continue;
    if (Array.isArray(object.categories)) meta.set(id, object);
    if (typeof object.dates === 'string') cards.set(id, object);
  }

  const shows: ShowCard[] = [];
  for (const [id, card] of cards) {
    const show = toShowCard(id, card, meta.get(id));
    if (show) shows.push(show);
  }
  return { shows, recognised: true };
}

/** Läuft das Stück irgendwann zwischen den beiden Tagen? */
export function overlapsRange(show: ShowCard, from: string, to: string): boolean {
  const first = show.runFrom ?? show.runTo;
  const last = show.runTo ?? show.runFrom;
  // Ohne lesbare Laufzeit lieber nachfragen als stillschweigend auslassen.
  if (!first || !last) return true;
  return last >= from && first <= to;
}

function toShowCard(id: string, card: RawGroup, meta: RawGroup | undefined): ShowCard | undefined {
  const title = text(card.title) ?? text(meta?.name);
  const href = text(card.href);
  if (!title || !href) return undefined;

  const runLabel = clean(decodeEntities(String(card.dates ?? '')));
  const firstStart = rscDate(card.startDate);
  const runFrom = firstStart ? zonedDayOf(firstStart) : undefined;
  const labelEnd = lastDayOf(runLabel);

  return {
    id,
    title: clean(decodeEntities(title)),
    categories: Array.isArray(meta?.categories)
      ? meta.categories.flatMap((value) => {
          const category = text(value);
          return category ? [clean(decodeEntities(category))] : [];
        })
      : [],
    promoter: text(meta?.promoter),
    venue: text(card.venue) ?? text(meta?.venue),
    subVenue: text(card.location) ?? text(meta?.subVenue),
    minPrice: typeof card.minPrice === 'number' ? card.minPrice : undefined,
    url: absolute(href),
    runLabel,
    runFrom,
    // Nur der rechte Rand der Beschriftung trägt zuverlässig Monat und Jahr
    // ("Fri 4 - Sat 5 Sep 2026" nennt links keinen Monat). Der linke Rand
    // kommt aus `startDate` und ist ohnehin genauer.
    runTo: labelEnd && (!runFrom || labelEnd >= runFrom) ? labelEnd : runFrom,
    firstStart,
    allSoldOut: card.hasAllDatesSoldOut === true,
    fewLeft: card.hasFewLeft === true,
    onSaleSoon: card.isOnSaleSoon === true,
  };
}

// ---------------------------------------------------- Produktionsseite

/**
 * Die Vorstellungen einer Produktionsseite.
 *
 * Der Blocktyp richtet sich nach der Gattung des Stücks – `TheaterEvent`,
 * `MusicEvent`, `ComedyEvent` –, deshalb wird auf die Endung „Event" geprüft
 * statt auf einen festen Namen. Sieben von zweiundzwanzig Septemberterminen
 * gingen verloren, solange nur `TheaterEvent` galt.
 *
 * Jedes `offers`-Element ist ein Abend: `url` trägt die Vorstellungsnummer,
 * `validThrough` den Zeitpunkt, `availability` die Ticketlage. Kein `offers`
 * heisst nicht „kaputt": ein Stück, dessen Vorverkauf noch nicht begonnen hat,
 * hat schlicht keine – darum kümmert sich `index.ts`.
 */
export function parsePerformances(html: string, show: ShowCard): CalendarEvent[] {
  const offers = eventOffers(html);
  const description = parseDescription(html);

  const events: CalendarEvent[] = [];
  const seen = new Set<string>();

  for (const offer of offers) {
    const id = performanceId(text(offer.url));
    const start = localIso(text(offer.validThrough));
    if (!id || !start || seen.has(id)) continue;
    seen.add(id);
    events.push(
      toEvent(show, {
        id,
        start,
        ticketUrl: text(offer.url),
        price: price(offer.price),
        availability: availabilityOf(text(offer.availability)),
        // "Selling Fast" hängt am Stück, nicht am Abend. Bei einem Lauf über
        // sechzig Abende sagt es nichts über den einzelnen; bei einem Stück
        // mit genau einem Abend kann es sich nur auf diesen beziehen.
        soleFewLeft: show.fewLeft && offers.length === 1,
        description,
      }),
    );
  }

  return events;
}

/**
 * Ein Stück, dessen Verkauf noch nicht läuft.
 *
 * Die Produktionsseite führt dann keine Vorstellungen; die Übersicht kennt
 * aber Tag und Uhrzeit des Abends. Den einen Termin daraus zu bauen ist keine
 * Erfindung – er steht so auf der Seite. Ein Lauf ohne Verkauf zeigt auf diesem
 * Weg nur seinen ersten Abend; mehr gibt die Quelle bis zum Vorverkauf nicht
 * her.
 *
 * Die Ticketlage bleibt den Merkmalen der Karte überlassen: „On sale soon"
 * heisst `not_on_sale`, eine Seite ohne Angebote aus anderem Grund `unknown`.
 */
export function announcedEvent(show: ShowCard, description?: string): CalendarEvent | undefined {
  const start = show.firstStart ? localIso(show.firstStart) : undefined;
  if (!start) return undefined;
  return toEvent(show, { id: `group-${show.id}`, start, description });
}

/**
 * Der lange Ankündigungstext.
 *
 * Er steht als Contentful-Rich-Text unter `richTextDescription` in der
 * RSC-Nutzlast; das gerenderte Markup hilft nicht, weil die Seite den Abschnitt
 * zugeklappt ausliefert. Ist er nicht lesbar, bleibt die Kurzzeile aus dem
 * `schema.org`-Block – besser eine Zeile als nichts.
 */
export function parseDescription(html: string): string | undefined {
  const payload = flightPayload(html);
  const rich = readJson<RawRichText>(payload, '"richTextDescription":');
  const long = rich ? clean(richTextToText(rich.json)) : '';
  if (long.length >= 40) return long;

  const short = clean(decodeEntities(String(schemaEvent(html)?.description ?? '')));
  return short.length >= 40 ? short : undefined;
}

// ------------------------------------------------------------- Termine

interface Performance {
  id: string;
  start: string;
  ticketUrl?: string;
  price?: number;
  availability?: Availability;
  availabilityLabel?: string;
  soleFewLeft?: boolean;
  description?: string;
}

function toEvent(show: ShowCard, performance: Performance): CalendarEvent {
  const { availability, availabilityLabel } = resolveAvailability(show, performance);

  const notes: string[] = [];
  if (performance.price) notes.push(`Tickets from £${performance.price.toFixed(2)}`);
  else if (show.minPrice) notes.push(`Tickets from £${show.minPrice.toFixed(2)}`);
  if (show.promoter) notes.push(`Presented by ${show.promoter}`);

  return {
    id: `${SOURCE_ID}:${performance.id}`,
    sourceId: SOURCE_ID,
    title: show.title,
    description: performance.description,
    category: show.categories.length > 0 ? show.categories.join(' / ') : undefined,
    start: performance.start,
    allDay: false,
    venue: { name: venueName(show) },
    availability,
    availabilityLabel,
    ticketUrl: performance.ticketUrl,
    url: show.url,
    notes: notes.length > 0 ? notes : undefined,
  };
}

/**
 * Ticketlage aus zwei unabhängigen Signalen: dem `schema.org`-Angebot des
 * Abends und den Merkmalen der Karte.
 *
 * Das Angebot gewinnt, weil es den einzelnen Abend meint. Nur wo es schweigt,
 * springen die Karten-Merkmale ein.
 */
function resolveAvailability(
  show: ShowCard,
  performance: Performance,
): { availability: Availability; availabilityLabel?: string } {
  if (performance.availability === 'soldout') {
    return { availability: 'soldout', availabilityLabel: 'Sold out' };
  }
  if (show.allSoldOut) return { availability: 'soldout', availabilityLabel: 'Sold out' };
  if (performance.availability === 'not_on_sale' || show.onSaleSoon) {
    return {
      availability: 'not_on_sale',
      availabilityLabel: performance.availabilityLabel ?? 'On sale soon',
    };
  }
  if (performance.soleFewLeft || performance.availability === 'limited') {
    return { availability: 'limited', availabilityLabel: 'Selling fast' };
  }
  if (performance.availability === 'available') return { availability: 'available' };
  return { availability: 'unknown' };
}

/** Der Saal, mit dem Haus davor – die Ortsauflösung schneidet am Gedankenstrich. */
function venueName(show: ShowCard): string {
  const house = show.venue ?? 'Pavilion Theatre';
  if (!show.subVenue || show.subVenue === house) return house;
  return `${house} – ${show.subVenue}`;
}

/** `schema.org`-Ticketlage; die Plattform benutzt bisher nur die ersten beiden. */
function availabilityOf(value: string | undefined): Availability | undefined {
  if (!value) return undefined;
  const name = value.split('/').pop()?.toLowerCase();
  switch (name) {
    case 'soldout':
    case 'outofstock':
    case 'discontinued':
      return 'soldout';
    case 'limitedavailability':
      return 'limited';
    case 'preorder':
    case 'presale':
      return 'not_on_sale';
    case 'instock':
    case 'onlineonly':
    case 'instoreonly':
      return 'available';
    default:
      return undefined;
  }
}

/** ".../buyingflow/tickets/32486/65405/" -> "65405". */
function performanceId(url: string | undefined): string | undefined {
  return url ? /\/tickets\/\d+\/(\d+)\/?/.exec(url)?.[1] : undefined;
}

// -------------------------------------------------- schema.org im Markup

interface RawOffer {
  url?: unknown;
  price?: unknown;
  validThrough?: unknown;
  availability?: unknown;
}

interface RawEvent {
  '@type'?: unknown;
  description?: unknown;
  offers?: unknown;
}

function eventOffers(html: string): RawOffer[] {
  const offers = schemaEvent(html)?.offers;
  return Array.isArray(offers) ? (offers as RawOffer[]) : [];
}

/**
 * Der Veranstaltungsblock der Seite.
 *
 * Der Typ folgt der Gattung („TheaterEvent", „MusicEvent", „ComedyEvent");
 * gemeinsam ist ihnen die Endung. `PerformingArtsTheater`, `Organization` und
 * `BreadcrumbList` stehen auf derselben Seite und fallen darüber weg.
 */
function schemaEvent(html: string): RawEvent | undefined {
  for (const match of html.matchAll(
    /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[1]);
    } catch {
      continue;
    }
    for (const entry of Array.isArray(parsed) ? parsed : [parsed]) {
      const node = entry as RawEvent;
      if (node && typeof node['@type'] === 'string' && /Event$/.test(node['@type'])) return node;
    }
  }
  return undefined;
}

// ----------------------------------------------------- Daten im Markup

/**
 * Die Nutzlast der Next.js-Seite.
 *
 * Sie kommt in Stücken (`self.__next_f.push([1,"…"])`), die der Browser
 * aneinanderhängt. Wir tun dasselbe, denn ein Feld kann über zwei Stücke
 * hinweg brechen.
 */
function flightPayload(html: string): string {
  const pushes = html.matchAll(/self\.__next_f\.push\((\[[\s\S]*?\])\)\s*(?:<\/script>|;)/g);
  let payload = '';
  for (const push of pushes) {
    let chunk: unknown;
    try {
      chunk = JSON.parse(push[1]);
    } catch {
      continue;
    }
    if (Array.isArray(chunk) && typeof chunk[1] === 'string') payload += chunk[1];
  }
  return payload;
}

type RawGroup = Record<string, unknown>;

/** Jedes Objekt der Nutzlast, das mit `eventGroupId` beginnt. */
function eventGroupObjects(payload: string): RawGroup[] {
  const objects: RawGroup[] = [];
  const marker = '{"eventGroupId":';
  for (let at = payload.indexOf(marker); at >= 0; at = payload.indexOf(marker, at + 1)) {
    const json = balancedJson(payload, at);
    if (!json) continue;
    try {
      objects.push(JSON.parse(json) as RawGroup);
    } catch {
      // Ein Objekt, das über eine Referenz hinweg bricht, ist kein Stück.
    }
  }
  return objects;
}

function groupId(object: RawGroup): string | undefined {
  const value = object.eventGroupId;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return text(value);
}

function readJson<T>(payload: string, key: string): T | undefined {
  const at = payload.indexOf(key);
  if (at < 0) return undefined;
  const json = balancedJson(payload, at + key.length);
  if (!json) return undefined;
  try {
    return JSON.parse(json) as T;
  } catch {
    return undefined;
  }
}

/**
 * Den Wert ab `from` ausschneiden – bis die Klammern wieder aufgehen.
 *
 * Zeichenketten werden dabei übersprungen, sonst zählt eine Klammer in einem
 * Stücktitel („Ed Byrne (Tour)") mit und der Ausschnitt bricht mitten im Feld ab.
 */
function balancedJson(text: string, from: number): string | undefined {
  let start = from;
  while (start < text.length && /\s/.test(text[start])) start++;
  const open = text[start];
  if (open !== '{' && open !== '[') return undefined;
  const close = open === '{' ? '}' : ']';

  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (char === '\\') i++;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === open) depth++;
    else if (char === close && --depth === 0) return text.slice(start, i + 1);
  }
  return undefined;
}

// ------------------------------------------------------------ Rich Text

interface RawRichText {
  json?: unknown;
}

interface RichNode {
  nodeType?: unknown;
  value?: unknown;
  content?: unknown;
}

/** Contentful-Rich-Text als Fliesstext; Absätze werden zu Leerzeichen. */
function richTextToText(node: unknown): string {
  if (Array.isArray(node)) return node.map(richTextToText).join('');
  if (!node || typeof node !== 'object') return '';
  const rich = node as RichNode;
  const own = rich.nodeType === 'text' && typeof rich.value === 'string' ? rich.value : '';
  const children = rich.content ? richTextToText(rich.content) : '';
  const separator = typeof rich.nodeType === 'string' && rich.nodeType !== 'text' ? ' ' : '';
  return `${own}${children}${separator}`;
}

// ------------------------------------------------------------- Kleinkram

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Der letzte Tag einer Laufzeit-Beschriftung.
 *
 * "Mon 12 Oct 2026", "Fri 4 - Sat 5 Sep 2026", "Thu 26 Nov 2026 - Sun 10 Jan
 * 2027" – gesucht wird das letzte vollständige Datum, denn nur der rechte Rand
 * nennt immer Monat und Jahr.
 */
export function lastDayOf(label: string): string | undefined {
  const matches = [...clean(label).matchAll(/(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/g)];
  const last = matches.at(-1);
  if (!last) return undefined;
  const month = MONTHS[last[2].slice(0, 3).toLowerCase()];
  if (!month) return undefined;
  return `${last[3]}-${String(month).padStart(2, '0')}-${last[1].padStart(2, '0')}`;
}

/** RSC schreibt Zeitpunkte als `$D2026-09-04T18:30:00.000Z`. */
function rscDate(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const iso = value.startsWith('$D') ? value.slice(2) : value;
  return /^\d{4}-\d{2}-\d{2}T/.test(iso) ? iso : undefined;
}

const LOCAL_TIME = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** "2026-11-26T19:00:00.000Z" (UTC) -> "2026-11-26T19:00:00+00:00" (Ortszeit). */
function localIso(utc: string | undefined): string | undefined {
  if (!utc) return undefined;
  const instant = new Date(utc);
  if (Number.isNaN(instant.getTime())) return undefined;
  const parts: Record<string, string> = {};
  for (const part of LOCAL_TIME.formatToParts(instant)) parts[part.type] = part.value;
  return zonedIso(
    TIME_ZONE,
    `${parts.year}-${parts.month}-${parts.day}`,
    Number(parts.hour),
    Number(parts.minute),
  );
}

/** Ortstag eines UTC-Zeitpunkts. */
function zonedDayOf(utc: string): string | undefined {
  const instant = new Date(utc);
  if (Number.isNaN(instant.getTime())) return undefined;
  const parts: Record<string, string> = {};
  for (const part of LOCAL_TIME.formatToParts(instant)) parts[part.type] = part.value;
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function price(value: unknown): number | undefined {
  const amount = typeof value === 'number' ? value : Number(text(value));
  return Number.isFinite(amount) && amount > 0 ? amount : undefined;
}

/** Ein Feld, das wirklich etwas sagt – RSC schreibt `"$undefined"` hinein. */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = clean(value);
  if (!trimmed || trimmed.startsWith('$')) return undefined;
  return trimmed;
}

function absolute(url: string): string {
  return url.startsWith('http') ? url : `${BASE}${url}`;
}
