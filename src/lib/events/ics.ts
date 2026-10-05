import type { CalendarEvent } from './types.ts';

/**
 * `CalendarEvent` als iCalendar-Datei (RFC 5545).
 *
 * Reine Funktion auf dem Datenmodell – sie kennt keine Quelle und kein Netz.
 * Nur die Häuser, die selbst eine .ics anbieten, hätten sonst einen Weg in den
 * eigenen Kalender; so hat ihn jeder Termin.
 *
 * Was die Quelle nicht hergibt, steht auch nicht in der Datei: fehlt das Ende,
 * bleibt `DTEND` weg (RFC 5545: der Termin belegt dann seinen Anfangszeitpunkt)
 * statt eine Dauer zu erfinden.
 */

const CRLF = '\r\n';

export function toICalendar(event: CalendarEvent, options: { now?: Date; host?: string } = {}): string {
  return toICalendarFeed([event], options);
}

/**
 * Mehrere Termine als ein Kalender – die Grundlage für ein Abo. Mit `name`
 * zeigen Kalender-Apps den Kalender unter diesem Namen; `refreshHours` ist
 * die Bitte, wie oft sie nachsehen sollen (die meisten halten sich daran).
 */
export function toICalendarFeed(
  events: CalendarEvent[],
  options: { now?: Date; host?: string; name?: string; refreshHours?: number } = {},
): string {
  const host = options.host ?? 'hierausgehen.de';
  const stamp = utcStamp(options.now ?? new Date());
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${host}//Kalender//DE`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  if (options.name) lines.push(`X-WR-CALNAME:${escape(options.name)}`, `NAME:${escape(options.name)}`);
  if (options.refreshHours) {
    lines.push(
      `REFRESH-INTERVAL;VALUE=DURATION:PT${options.refreshHours}H`,
      `X-PUBLISHED-TTL:PT${options.refreshHours}H`,
    );
  }
  for (const event of events) lines.push(...vevent(event, host, stamp));
  lines.push('END:VCALENDAR');

  return lines.map(fold).join(CRLF) + CRLF;
}

function vevent(event: CalendarEvent, host: string, stamp: string): string[] {
  const lines: string[] = [
    'BEGIN:VEVENT',
    `UID:${escape(event.id)}@${host}`,
    `DTSTAMP:${stamp}`,
    ...startAndEnd(event),
    `SUMMARY:${escape(event.title)}`,
  ];

  const location = [event.venue.name, event.venue.city].filter(Boolean).join(', ');
  if (location) lines.push(`LOCATION:${escape(location)}`);

  const description = [event.subtitle, event.description, ...(event.notes ?? []), event.url]
    .filter(Boolean)
    .join('\n\n');
  if (description) lines.push(`DESCRIPTION:${escape(description)}`);

  if (event.url) lines.push(`URL:${escape(event.url)}`);
  if (event.category) lines.push(`CATEGORIES:${escape(event.category)}`);

  lines.push('END:VEVENT');
  return lines;
}

/** Dateiname für den Download – aus dem Titel, notfalls aus der ID. */
export function icsFileName(event: CalendarEvent): string {
  const slug = event.title
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return `${event.start.slice(0, 10)}-${slug || 'termin'}.ics`;
}

function startAndEnd(event: CalendarEvent): string[] {
  if (event.allDay) {
    const lines = [`DTSTART;VALUE=DATE:${event.start.slice(0, 10).replace(/-/g, '')}`];
    // Bei ganztägigen Terminen ist DTEND ausschliessend – ein Tag mehr.
    if (event.end) lines.push(`DTEND;VALUE=DATE:${nextDay(event.end.slice(0, 10))}`);
    return lines;
  }

  const lines = [`DTSTART:${utcStamp(new Date(event.start))}`];
  if (event.end) lines.push(`DTEND:${utcStamp(new Date(event.end))}`);
  return lines;
}

function nextDay(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

/** Zeitpunkte werden in UTC geschrieben; jeder Kalender rechnet selbst zurück. */
function utcStamp(date: Date): string {
  return `${date.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
}

/** Sonderzeichen nach RFC 5545 maskieren. */
function escape(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Zeilen dürfen 75 Oktette nicht überschreiten; der Rest wird mit einem
 * führenden Leerzeichen fortgesetzt. Gezählt werden Bytes, nicht Zeichen –
 * Umlaute belegen zwei.
 */
function fold(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;

  const parts: string[] = [];
  let current = '';
  let bytes = 0;
  // Über Codepoints laufen, damit kein Zeichen zerschnitten wird.
  for (const char of line) {
    const size = encoder.encode(char).length;
    // Fortsetzungszeilen beginnen mit einem Leerzeichen, das mitzählt.
    if (bytes + size > (parts.length === 0 ? 75 : 74)) {
      parts.push(current);
      current = '';
      bytes = 0;
    }
    current += char;
    bytes += size;
  }
  parts.push(current);

  return parts.map((part, index) => (index === 0 ? part : ` ${part}`)).join(CRLF);
}
