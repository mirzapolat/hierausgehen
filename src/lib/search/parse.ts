import { addDays, endOfMonth, weekday } from '../calendar.ts';
import { cities } from '../cities.ts';
import { categoryKey, lookupCategory } from '../events/categories.ts';
import type { TimeOfDay } from '../events/filter.ts';
import { todayInZone } from '../events/schedule.ts';
import { translateTerm } from '../i18n.ts';
import { fold, stem, STOPWORDS, words } from './normalize.ts';

/**
 * Was eine Anfrage meint.
 *
 * „konzerte in münchen dieses wochenende unter 30 €" ist kein Suchtext,
 * sondern vier Angaben und kein einziges Wort zum Suchen. Der Parser zieht
 * heraus, was sich verlässlich deuten lässt – Zeitraum, Tageszeit, Art, Preis,
 * Ticketlage, Stadt, „für Kinder" –, und lässt den Rest als Text stehen.
 *
 * Jede erkannte Angabe merkt sich, wo sie in der Anfrage stand. Die
 * Oberfläche zeigt sie als Chip; wer einen Chip entfernt, entfernt genau
 * diese Stelle aus dem Suchtext. Rein und ohne Netz – „jetzt" kommt herein.
 */

export interface Span {
  start: number;
  end: number;
}

export interface DateFacet {
  /** Erster und letzter Tag, ISO, beide eingeschlossen. */
  from: string;
  to: string;
  kind: 'day' | 'weekend' | 'week' | 'month';
  /**
   * Wochenende: der Freitagabend gehört halb dazu. Wer am Donnerstag „dieses
   * Wochenende" sucht, nimmt das Konzert am Freitag um 20 Uhr gern mit.
   */
  fridayEvening?: boolean;
  spans: Span[];
}

export interface ParsedQuery {
  raw: string;
  /** Übrige Suchwörter, gefaltet, ohne Füllwörter. */
  words: string[];
  /** Text für das Embedding: die Anfrage ohne Zeitraum, Preis und Stadt. */
  semanticText: string;
  date?: DateFacet;
  times?: { values: TimeOfDay[]; spans: Span[] };
  /** Ausdrücklich genannte Arten („Konzerte", „Theater") – kanonisch. */
  categories?: { values: string[]; spans: Span[] };
  /**
   * Arten, auf die ein Suchwort deutet, ohne sie zu nennen („Jazz" → Konzert).
   * Das Wort bleibt Suchtext; die Art hilft nur beim Sortieren.
   */
  hints: string[];
  price?: { free?: boolean; max?: number; cheap?: boolean; spans: Span[] };
  tickets?: { spans: Span[] };
  city?: { id: string; spans: Span[] };
  kids?: { spans: Span[] };
  /** „Date", „zu zweit", „romantisch": der Abend passt besser als der Vormittag. */
  evening?: boolean;
  /**
   * Die Anfrage beschreibt eine Stimmung oder Lage („wenn es regnet", „für ein
   * Date"), die kein Feld abbildet – ein Fall für die Bedeutungssuche, auch
   * wenn keine Suchwörter übrig bleiben.
   */
  vague?: boolean;
  /**
   * „in English", „auf Englisch": eine Vorliebe, kein Ausschluss – ob ein
   * Abend englisch ist, steht nur manchmal im Text.
   */
  language?: { value: 'en'; spans: Span[] };
  /**
   * Stimmungswörter unter den Suchwörtern („gemütlich", „lustig"). Sie zählen
   * mit, wenn sie im Text stehen, sind aber keine Pflicht: „gemütlicher Jazz"
   * soll jeden Jazzabend finden, nicht nur die, die sich selbst gemütlich nennen.
   */
  moods: string[];
}

export interface ParseContext {
  now: Date;
  timeZone: string;
}

interface Token {
  raw: string;
  /** Gefaltet, ohne umgebende Satzzeichen. */
  w: string;
  start: number;
  end: number;
  used: boolean;
}

const DATE_LIKE = /^\d{1,2}\.(?:\d{1,2}\.?(?:\d{2,4})?)?$/;

function tokenize(raw: string): Token[] {
  const tokens: Token[] = [];
  for (const match of raw.matchAll(/\S+/g)) {
    const leading = /^[("'„“‚‘«»[]+/.exec(match[0])?.[0].length ?? 0;
    const trimmed = match[0].slice(leading).replace(/[)"'“”‘’«»\],;!?]+$/, '');
    if (!trimmed) continue;
    let w = fold(trimmed);
    if (!DATE_LIKE.test(w)) w = w.replace(/\.+$/, '');
    if (!w) continue;
    const start = match.index + leading;
    const parts = splitCompound(trimmed, w);
    if (parts) {
      const cut = start + parts.cut;
      tokens.push({ raw: trimmed.slice(0, parts.cut), w: parts.day, start, end: cut, used: false });
      tokens.push({ raw: trimmed.slice(parts.cut), w: parts.time, start: cut, end: start + trimmed.length, used: false });
      continue;
    }
    tokens.push({ raw: trimmed, w, start, end: start + trimmed.length, used: false });
  }
  return tokens;
}

const COMPOUND = new RegExp(
  '^(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonnabend|sonntag|heute|morgen|uebermorgen)' +
    '(abends?|nachts?|nachmittags?|vormittags?|morgens?|mittags?|frueh)$',
);

/**
 * „Samstagabend", „freitagnachts", „sonntagmorgen": Tag und Tageszeit in
 * einem Wort. Zwei Tokens daraus, jedes mit seinem Stück der Anfrage – so
 * entfernt der Chip „Samstag" nur „Samstag" und lässt „abend" stehen.
 * „-morgen" und „-früh" am Ende sind der Vormittag, nicht der nächste Tag.
 */
function splitCompound(raw: string, w: string): { day: string; time: string; cut: number } | undefined {
  const match = COMPOUND.exec(w);
  if (!match) return undefined;
  let cut = 1;
  while (cut < raw.length && fold(raw.slice(0, cut)) !== match[1]) cut++;
  if (cut >= raw.length) return undefined;
  const time = match[2] === 'morgen' || match[2] === 'frueh' ? 'morgens' : match[2];
  return { day: match[1], time, cut };
}

/* --------------------------------- Wörter --------------------------------- */

const WEEKDAYS: Record<string, number> = {
  montag: 1, monday: 1, dienstag: 2, tuesday: 2, mittwoch: 3, wednesday: 3, donnerstag: 4,
  thursday: 4, freitag: 5, friday: 5, samstag: 6, sonnabend: 6, saturday: 6, sonntag: 7, sunday: 7,
};

const MONTHS: Record<string, number> = {
  januar: 1, january: 1, jaenner: 1, februar: 2, february: 2, maerz: 3, march: 3, april: 4,
  mai: 5, juni: 6, june: 6, juli: 7, july: 7, august: 8, september: 9, oktober: 10,
  october: 10, november: 11, dezember: 12, december: 12,
};

/** Abkürzungen nur neben einer Tageszahl – allein sind „mar" oder „jun" zu oft etwas anderes. */
const MONTH_ABBREVIATIONS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, mrz: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9,
  okt: 10, oct: 10, nov: 11, dez: 12, dec: 12,
};

const THIS = new Set(['dieses', 'diesem', 'diesen', 'diese', 'this', 'am', 'an', 'zum', 'kommendes', 'kommenden', 'coming']);
const NEXT = new Set(['naechstes', 'naechsten', 'naechste', 'naechster', 'next']);

const TIMES: Record<string, TimeOfDay> = {
  abend: 'evening', abends: 'evening', evening: 'evening', evenings: 'evening',
  nacht: 'night', nachts: 'night', night: 'night', late: 'night', spaet: 'night', spaetabends: 'night',
  nachmittag: 'day', nachmittags: 'day', afternoon: 'day', vormittag: 'day', vormittags: 'day',
  morgens: 'day', morning: 'day', tagsueber: 'day', daytime: 'day', mittag: 'day', mittags: 'day',
};

const FREE = new Set(['kostenlos', 'kostenlose', 'kostenlosen', 'gratis', 'umsonst', 'free', 'kostenfrei', 'kostenfreie']);
const CHEAP = new Set(['guenstig', 'guenstige', 'guenstiges', 'guenstigen', 'billig', 'billige', 'cheap', 'preiswert', 'budget']);
const MAX_LEAD = new Set(['unter', 'bis', 'max', 'maximal', 'hoechstens', 'under', 'below', 'fuer', 'for']);
const PRICE_ONLY_LEAD = new Set(['unter', 'max', 'maximal', 'hoechstens', 'under', 'below', 'less', 'up']);
const CURRENCY = new Set(['eur', 'euro', 'euros', '€', '£', 'pfund', 'pounds', 'gbp']);

const KIDS = new Set([
  'kinder', 'kind', 'kids', 'kid', 'children', 'child', 'familie', 'familien', 'family', 'families',
  'kinderfreundlich', 'familienfreundlich', 'kindgerecht',
]);

/** Wetter sagt nichts, was im Bestand steht – fürs Embedding bleibt es im Text. */
const WEATHER = new Set([
  'regen', 'regnet', 'regnerisch', 'verregnet', 'verregnete', 'verregneten', 'verregneter',
  'rain', 'raining', 'rainy', 'drinnen', 'indoor', 'indoors', 'schlechtwetter', 'wetter', 'weather',
]);

/**
 * Stimmungen. Sie bleiben Suchwort – „lustig" steht durchaus in Texten –,
 * machen die Anfrage aber zu einer, bei der die Bedeutung mehr zu sagen hat
 * als das Wort.
 */
const MOODS = new Set([
  'lustig', 'lustige', 'lustiges', 'lustigen', 'witzig', 'witzige', 'witziges', 'entspannt',
  'entspannte', 'entspannter', 'entspanntes', 'entspannten', 'gemuetlich', 'gemuetliche',
  'gemuetliches', 'chillig', 'chilliges', 'ruhig', 'ruhige', 'ruhiges', 'spannend', 'spannende',
  'spannendes', 'besonderes', 'besondere', 'aussergewoehnlich', 'aussergewoehnliches', 'ausgefallen',
  'ausgefallenes', 'unterhaltsam', 'unterhaltsames', 'festlich', 'festliches', 'magisch', 'magisches',
  'inspirierend', 'bewegend', 'traurig', 'nachdenklich', 'laut', 'wild', 'funny', 'fun', 'relaxed',
  'relaxing', 'chill', 'chilled', 'cozy', 'cosy', 'quiet', 'exciting', 'unusual', 'quirky', 'festive',
  'magical', 'inspiring', 'moving', 'uplifting', 'lively', 'intimate', 'intim', 'intime', 'gruselig',
  'spooky', 'scary',
]);
const MOOD_STEMS = new Set([...MOODS].map(stem));

/** Auch gebeugt: „gemütlicher", „entspannteren". */
function isMood(word: string): boolean {
  return MOODS.has(word) || MOOD_STEMS.has(stem(word)) || MOOD_STEMS.has(stem(word.replace(/(?:er|en|es|e)$/, '')));
}

/** Arten, die als blosses Wort gemeint sind, ohne dass der Wortschatz sie kanonisch führt. */
const GENERIC_CATEGORY_WORDS = new Set([
  'gig', 'gigs', 'konzerte', 'concerts', 'musik', 'music', 'livemusik', 'live music', 'play', 'plays',
  'schauspiel', 'movie', 'movies', 'film', 'filme', 'films', 'kabarett', 'lesung', 'lesungen', 'reading',
  'readings', 'talk', 'talks', 'lecture', 'lectures', 'stand-up', 'stand-up comedy', 'standup',
  'standup comedy', 'stand up comedy', 'stand up', 'opern', 'theatre', 'theater', 'shows',
  'partys', 'parties', 'clubnacht', 'disco', 'festivals', 'ausstellungen', 'exhibitions', 'fuehrungen',
  'vortraege', 'diskussion', 'workshop', 'workshops',
]);

const CITY_ALIASES = new Map<string, string>();
for (const city of cities) {
  CITY_ALIASES.set(fold(city.name), city.id);
  CITY_ALIASES.set(city.id, city.id);
  // „Munchen", „Dusseldorf" – ohne Umlaut-e, wie es auf englischen Tastaturen landet.
  CITY_ALIASES.set(
    city.name.toLocaleLowerCase('de-DE').normalize('NFKD').replace(/[̀-ͯ]/g, ''),
    city.id,
  );
}
CITY_ALIASES.set('munich', 'muenchen');

/* --------------------------------- Parser --------------------------------- */

export function parseQuery(raw: string, context: ParseContext): ParsedQuery {
  const tokens = tokenize(raw);
  const today = todayInZone(context.timeZone, context.now);
  const parsed: ParsedQuery = { raw, words: [], semanticText: raw, hints: [], moods: [] };
  /** Stellen, die fürs Embedding nichts bedeuten (Zeitraum, Preis, Stadt …). */
  const structural: Span[] = [];

  const at = (i: number) => (i < tokens.length && !tokens[i].used ? tokens[i].w : undefined);
  const take = (from: number, count: number): Span[] => {
    const spans: Span[] = [];
    for (let i = from; i < from + count; i++) {
      tokens[i].used = true;
      spans.push({ start: tokens[i].start, end: tokens[i].end });
    }
    return mergeSpans(spans);
  };

  const setDate = (facet: Omit<DateFacet, 'spans'>, spans: Span[]) => {
    if (!parsed.date) parsed.date = { ...facet, spans };
    else parsed.date.spans.push(...spans);
    structural.push(...spans);
  };
  const addTime = (value: TimeOfDay, spans: Span[]) => {
    parsed.times ??= { values: [], spans: [] };
    if (!parsed.times.values.includes(value)) parsed.times.values.push(value);
    parsed.times.spans.push(...spans);
    structural.push(...spans);
  };
  const addPrice = (patch: { free?: boolean; max?: number; cheap?: boolean }, spans: Span[]) => {
    parsed.price = { ...(parsed.price ?? { spans: [] }), ...patch };
    parsed.price.spans.push(...spans);
    structural.push(...spans);
  };

  /** „Sonntag morgen", „heute früh": hinter einem Tag ist „morgen" der Vormittag. */
  const morningAfter = (j: number) => {
    const word = at(j);
    if (word === 'morgen' || word === 'frueh') addTime('day', take(j, 1));
  };

  for (let i = 0; i < tokens.length; i++) {
    const w = at(i);
    if (w === undefined) continue;
    const next = at(i + 1);
    const prefixed = THIS.has(w) || NEXT.has(w) ? next : undefined;
    const isNext = NEXT.has(w);

    // „show me …" ist keine Show.
    if ((w === 'show' || w === 'zeig') && (next === 'me' || next === 'mir')) {
      take(i, 2);
      continue;
    }

    /* ---- Zeitraum ---- */
    if (w === 'heute' || w === 'today') {
      setDate({ from: today, to: today, kind: 'day' }, take(i, 1));
      morningAfter(i + 1);
      continue;
    }
    if (w === 'tonight') {
      const spans = take(i, 1);
      setDate({ from: today, to: today, kind: 'day' }, spans);
      addTime('evening', spans);
      continue;
    }
    if (w === 'morgen' || w === 'tomorrow') {
      const day = addDays(today, 1);
      setDate({ from: day, to: day, kind: 'day' }, take(i, 1));
      // „morgen früh"; „morgen morgen" sagt niemand.
      if (next === 'frueh') addTime('day', take(i + 1, 1));
      continue;
    }
    if (w === 'uebermorgen' || (w === 'day' && next === 'after' && at(i + 2) === 'tomorrow')) {
      const day = addDays(today, 2);
      setDate({ from: day, to: day, kind: 'day' }, take(i, w === 'day' ? 3 : 1));
      continue;
    }
    if (w === 'wochenende' || w === 'weekend' || prefixed === 'wochenende' || prefixed === 'weekend') {
      const count = w === 'wochenende' || w === 'weekend' ? 1 : 2;
      setDate(weekend(today, isNext), take(i, count));
      continue;
    }
    if (prefixed === 'woche' || prefixed === 'week') {
      setDate(isNext ? nextWeek(today) : thisWeek(today), take(i, 2));
      continue;
    }
    const weekdayWord =
      prefixed && WEEKDAYS[prefixed]
        ? prefixed
        : WEEKDAYS[w]
          ? w
          : WEEKDAYS[w.replace(/s$/, '')]
            ? w.replace(/s$/, '')
            : undefined;
    if (weekdayWord) {
      const withPrefix = prefixed === weekdayWord;
      const day = upcomingWeekday(today, WEEKDAYS[weekdayWord], withPrefix && isNext);
      setDate({ from: day, to: day, kind: 'day' }, take(i, withPrefix ? 2 : 1));
      morningAfter(i + (withPrefix ? 2 : 1));
      continue;
    }
    const explicit = explicitDay(tokens, i, today);
    if (explicit) {
      setDate({ from: explicit.day, to: explicit.day, kind: 'day' }, take(i, explicit.count));
      continue;
    }
    const monthWord = MONTHS[w] ? w : (w === 'im' || w === 'in') && next && MONTHS[next] ? next : undefined;
    if (monthWord) {
      setDate(month(today, MONTHS[monthWord]), take(i, monthWord === w ? 1 : 2));
      continue;
    }
    if (
      ['ueber', 'an', 'zu', 'over', 'at'].includes(w) &&
      (next === 'weihnachten' || next === 'christmas' || next === 'xmas')
    ) {
      const year = christmasYear(today);
      setDate({ from: `${year}-12-24`, to: `${year}-12-26`, kind: 'week' }, take(i, 2));
      continue;
    }
    if (w === 'silvester' || (w === 'new' && next === 'years' && at(i + 2) === 'eve')) {
      const year = today.slice(0, 4);
      setDate({ from: `${year}-12-31`, to: `${year}-12-31`, kind: 'day' }, take(i, w === 'silvester' ? 1 : 3));
      continue;
    }

    /* ---- Tageszeit ---- */
    const time = TIMES[w];
    if (time) {
      // „am Abend", „in der Nacht": das Wort davor gehört dazu.
      const before = i > 0 && !tokens[i - 1].used && ['am', 'in', 'der', 'at', 'the'].includes(tokens[i - 1].w);
      addTime(time, take(before ? i - 1 : i, before ? 2 : 1));
      continue;
    }

    /* ---- Preis ---- */
    if (FREE.has(w)) {
      addPrice({ free: true }, take(i, 1));
      continue;
    }
    if ((w === 'eintritt' && next === 'frei') || (w === 'freier' && next === 'eintritt') || (w === 'ohne' && next === 'eintritt')) {
      addPrice({ free: true }, take(i, 2));
      continue;
    }
    if (CHEAP.has(w)) {
      addPrice({ cheap: true }, take(i, 1));
      continue;
    }
    const lead = (w === 'less' && next === 'than') || (w === 'up' && next === 'to') ? 2 : MAX_LEAD.has(w) ? 1 : 0;
    if (lead) {
      const amount = amountAt(tokens, i + lead);
      // Ohne Währung nur nach eindeutigen Wörtern: „unter 30" ist ein Preis,
      // „bis 20 Uhr" und „für 2 Personen" sind keiner.
      if (amount && (amount.currency || PRICE_ONLY_LEAD.has(w))) {
        addPrice({ max: amount.value }, take(i, lead + amount.count));
        continue;
      }
    }
    const bare = amountAt(tokens, i);
    if (bare?.currency) {
      addPrice({ max: bare.value }, take(i, bare.count));
      continue;
    }

    /* ---- Tickets ---- */
    const ticketCount = ticketPhrase(tokens, i);
    if (ticketCount) {
      const spans = take(i, ticketCount);
      parsed.tickets = { spans: [...(parsed.tickets?.spans ?? []), ...spans] };
      structural.push(...spans);
      continue;
    }

    /* ---- Stadt ---- */
    const cityLead = ['in', 'im', 'near', 'around', 'aus'].includes(w) && !!next && CITY_ALIASES.has(next);
    if (CITY_ALIASES.has(w) || cityLead) {
      const id = CITY_ALIASES.get(cityLead ? next! : w)!;
      const spans = take(i, cityLead ? 2 : 1);
      parsed.city = { id, spans: [...(parsed.city?.spans ?? []), ...spans] };
      structural.push(...spans);
      continue;
    }

    /* ---- Sprache ---- */
    const english = englishPhrase(tokens, i);
    if (english) {
      const spans = take(i, english);
      parsed.language = { value: 'en', spans: [...(parsed.language?.spans ?? []), ...spans] };
      structural.push(...spans);
      continue;
    }

    /* ---- Kinder ---- */
    const kidsLead = (w === 'fuer' || w === 'for' || w === 'mit' || w === 'with') && !!next && KIDS.has(next);
    if (KIDS.has(w) || kidsLead) {
      const spans = take(i, kidsLead ? 2 : 1);
      parsed.kids = { spans: [...(parsed.kids?.spans ?? []), ...spans] };
      continue;
    }
    // „Kinderkonzert" sagt beides: für Kinder, und worum es geht. Das Wort
    // bleibt Suchtext.
    if (/^(?:kinder|familien)\w{3,}/.test(w)) parsed.kids ??= { spans: [] };

    /* ---- Anlass, Wetter ---- */
    if (w === 'date' || (w === 'zu' && next === 'zweit') || (w === 'for' && next === 'two')) {
      take(i, w === 'date' ? (next === 'night' ? 2 : 1) : 2);
      parsed.evening = true;
      parsed.vague = true;
      continue;
    }
    if (w === 'romantisch' || w === 'romantic' || w === 'romantik') {
      parsed.evening = true;
      parsed.vague = true;
    }
    if (WEATHER.has(w)) {
      take(i, 1);
      parsed.vague = true;
      continue;
    }
    if (isMood(w)) {
      parsed.vague = true;
      parsed.moods.push(w);
    }

    /* ---- Art ---- */
    const category = categoryAt(tokens, i);
    if (category?.generic) {
      const spans = take(i, category.count);
      parsed.categories ??= { values: [], spans: [] };
      if (!parsed.categories.values.includes(category.value)) parsed.categories.values.push(category.value);
      parsed.categories.spans.push(...spans);
    } else if (category && !parsed.hints.includes(category.value)) {
      parsed.hints.push(category.value);
    } else if (!category) {
      for (const value of conceptHints(w)) if (!parsed.hints.includes(value)) parsed.hints.push(value);
    }
  }

  parsed.words = tokens
    .filter((token) => !token.used)
    .flatMap((token) => words(token.raw))
    .filter((word) => !STOPWORDS.has(word) && (word.length > 1 || /\d/.test(word)));

  parsed.semanticText = removeSpans(raw, structural);
  return parsed;
}

/* ------------------------------ Zeiträume ------------------------------ */

function weekend(today: string, next: boolean): Omit<DateFacet, 'spans'> {
  const day = weekday(today);
  const sunday = addDays(today, 7 - day);
  if (next) return { from: addDays(sunday, 5), to: addDays(sunday, 7), kind: 'weekend', fridayEvening: true };
  // Am Samstag und Sonntag ist „dieses Wochenende" der Rest davon.
  if (day >= 6) return { from: today, to: sunday, kind: 'weekend', fridayEvening: false };
  return { from: addDays(today, 5 - day), to: sunday, kind: 'weekend', fridayEvening: true };
}

function thisWeek(today: string): Omit<DateFacet, 'spans'> {
  return { from: today, to: addDays(today, 7 - weekday(today)), kind: 'week' };
}

function nextWeek(today: string): Omit<DateFacet, 'spans'> {
  const monday = addDays(today, 8 - weekday(today));
  return { from: monday, to: addDays(monday, 6), kind: 'week' };
}

function upcomingWeekday(today: string, target: number, strictlyNext: boolean): string {
  let delta = (target - weekday(today) + 7) % 7;
  if (delta === 0 && strictlyNext) delta = 7;
  return addDays(today, delta);
}

function month(today: string, value: number): Omit<DateFacet, 'spans'> {
  const year = Number(today.slice(0, 4));
  const current = Number(today.slice(5, 7));
  const targetYear = value < current ? year + 1 : year;
  const first = `${targetYear}-${String(value).padStart(2, '0')}-01`;
  const from = value === current && targetYear === year ? today : first;
  return { from, to: endOfMonth(first), kind: 'month' };
}

function christmasYear(today: string): number {
  const year = Number(today.slice(0, 4));
  return today > `${year}-12-26` ? year + 1 : year;
}

/** „14.11.", „14.11.2026", „14. November", „14 nov", „November 14", ISO. */
function explicitDay(tokens: Token[], i: number, today: string): { day: string; count: number } | undefined {
  const w = tokens[i].w;
  const next = tokens[i + 1] && !tokens[i + 1].used ? tokens[i + 1].w : undefined;
  const monthOf = (word?: string) => (word ? (MONTHS[word] ?? MONTH_ABBREVIATIONS[word]) : undefined);

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(w);
  if (iso) return valid(Number(iso[1]), Number(iso[2]), Number(iso[3]), 1);

  const numeric = /^(\d{1,2})\.(\d{1,2})\.?(\d{2,4})?$/.exec(w);
  if (numeric) {
    const year = numeric[3] ? normalizeYear(Number(numeric[3])) : undefined;
    return valid(year, Number(numeric[2]), Number(numeric[1]), 1);
  }

  const dayNumber = /^(\d{1,2})(?:\.|st|nd|rd|th)?$/.exec(w);
  if (dayNumber && monthOf(next)) return valid(undefined, monthOf(next)!, Number(dayNumber[1]), 2);

  const monthFirst = monthOf(w);
  const trailing = next ? /^(\d{1,2})(?:\.|st|nd|rd|th)?$/.exec(next) : null;
  if (monthFirst && trailing) return valid(undefined, monthFirst, Number(trailing[1]), 2);
  return undefined;

  function valid(year: number | undefined, monthValue: number, dayValue: number, count: number) {
    if (monthValue < 1 || monthValue > 12 || dayValue < 1 || dayValue > 31) return undefined;
    const thisYear = Number(today.slice(0, 4));
    const build = (y: number) =>
      `${y}-${String(monthValue).padStart(2, '0')}-${String(dayValue).padStart(2, '0')}`;
    let day = build(year ?? thisYear);
    // Ohne Jahr ist der nächste solche Tag gemeint, nicht der vergangene.
    if (year === undefined && day < today) day = build(thisYear + 1);
    // Den 31. Februar gibt es nicht.
    if (new Date(`${day}T12:00:00Z`).toISOString().slice(0, 10) !== day) return undefined;
    return { day, count };
  }
}

function normalizeYear(year: number): number {
  return year < 100 ? 2000 + year : year;
}

/* ------------------------------ Preise, Karten ------------------------------ */

function amountAt(tokens: Token[], i: number): { value: number; count: number; currency: boolean } | undefined {
  const token = tokens[i];
  if (!token || token.used) return undefined;
  const match = /^[€£]?(\d+(?:[.,]\d{1,2})?)(€|£|eur|euro)?$/.exec(token.w);
  if (!match) return undefined;
  const value = Number(match[1].replace(',', '.'));
  const inline = /^[€£]/.test(token.w) || !!match[2];
  const following = !!tokens[i + 1] && !tokens[i + 1].used && CURRENCY.has(tokens[i + 1].w);
  if (!following && tokens[i + 1] && /^(?:uhr|h|jahre|jahren|years|personen|people|min|minuten)$/.test(tokens[i + 1].w)) {
    return undefined;
  }
  return { value, count: following ? 2 : 1, currency: inline || following };
}

function englishPhrase(tokens: Token[], i: number): number {
  const w = (k: number) => (tokens[i + k] && !tokens[i + k].used ? tokens[i + k].w : undefined);
  if ((w(0) === 'in' || w(0) === 'auf') && (w(1) === 'english' || w(1) === 'englisch')) return 2;
  if (w(0) === 'in' && w(1) === 'englischer' && w(2) === 'sprache') return 3;
  if (w(0) && /^(?:english|englisch|englischsprachige?[nrs]?|english-speaking|english-language)$/.test(w(0)!)) return 1;
  return 0;
}

function ticketPhrase(tokens: Token[], i: number): number {
  const seq = (...expected: string[]) =>
    expected.every((word, k) => tokens[i + k] && !tokens[i + k].used && tokens[i + k].w === word);
  if (seq('not', 'sold', 'out')) return 3;
  if (seq('noch', 'karten') || seq('noch', 'tickets') || seq('nicht', 'ausverkauft')) return 2;
  if (seq('tickets', 'verfuegbar') || seq('karten', 'verfuegbar') || seq('tickets', 'available')) return 2;
  if (seq('buchbar') || seq('bookable') || seq('verfuegbar') || seq('available')) return 1;
  return 0;
}

/* ---------------------------------- Arten ---------------------------------- */

function categoryAt(
  tokens: Token[],
  i: number,
): { value: string; count: number; generic: boolean } | undefined {
  for (let count = 3; count >= 1; count--) {
    const slice = tokens.slice(i, i + count);
    if (slice.length < count || slice.some((token) => token.used)) continue;
    const phrase = slice.map((token) => token.raw).join(' ');
    const value = lookupCategory(phrase);
    if (!value || value === 'Sonstiges') continue;
    const key = categoryKey(phrase);
    const generic =
      key === categoryKey(value) ||
      key === categoryKey(translateTerm('en', value)) ||
      GENERIC_CATEGORY_WORDS.has(fold(phrase));
    return { value, count, generic };
  }
  return undefined;
}

/**
 * Wörter, die auf eine Art deuten, ohne sie zu nennen: „was zum Lachen" ist
 * Comedy, „Techno" eine Party, „moderne Kunst" eine Ausstellung. Das Wort
 * bleibt Suchtext; die Art ordnet nur (`hintFit`). Das Embedding-Modell
 * kann das allein nicht verlässlich – für Big Band und Techno liegt es
 * gleich nah.
 */
const CONCEPTS: [RegExp, string[]][] = [
  [/^(?:lustig|witzig|lach|lacher|humor|humour|humorvoll|funny|komisch|komoedie|spassig|heiter|satire|satirisch|kabarett|parodie)/, ['Comedy']],
  [/^(?:feiern|feier|clubbing|club|clubnacht|techno|house|rave|dj|djs|elektro|electro|electronic|elektronisch|disco|tanzbar)$/, ['Party']],
  [/^(?:kunst|art|malerei|maler|gemaelde|fotografie|photography|galerie|gallery|museum|skulptur|skulpturen|installation|vernissage)$/, ['Ausstellung']],
  [/^(?:autor|autorin|roman|buch|buecher|books?|poesie|poetry|gedicht|gedichte|lyrik|poetry-slam|slam)$/, ['Literatur']],
  [/^(?:sinfoni|symphon|orchester|orchestra|kammermusik|streichquartett|klaviertrio|liederabend|mozart|beethoven|bach|brahms|chopin|schubert|haydn|mahler|bruckner|tschaikowsky|vivaldi)/, ['Klassik']],
  [/^(?:jazz|rock|pop|band|bands|hiphop|hip-hop|rap|indie|punk|metal|blues|soul|funk|reggae|singer-songwriter|songwriter|livemusik|unplugged|akustik|acoustic)$/, ['Konzert']],
  [/^(?:zauber|zauberer|magie|magic|magier|akrobatik|akrobaten|zirkus|circus|variete|varieté|artistik)$/, ['Show']],
  [/^(?:diskussion|podium|podiumsdiskussion|debatte|wissenschaft|science|vortrag)$/, ['Vortrag']],
];

function conceptHints(word: string): string[] {
  for (const [pattern, values] of CONCEPTS) if (pattern.test(word)) return values;
  return [];
}

/* ---------------------------------- Spans ---------------------------------- */

function mergeSpans(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const out: Span[] = [];
  for (const span of sorted) {
    const last = out[out.length - 1];
    if (last && span.start <= last.end + 1) last.end = Math.max(last.end, span.end);
    else out.push({ ...span });
  }
  return out;
}

/** Der Text ohne diese Stellen – zum Entfernen eines Chips aus der Anfrage. */
export function removeSpans(raw: string, spans: Span[]): string {
  let out = raw;
  for (const span of mergeSpans(spans).reverse()) {
    out = out.slice(0, span.start) + out.slice(span.end);
  }
  return out.replace(/\s{2,}/g, ' ').trim();
}
