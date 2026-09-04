/**
 * Zeitzonen-Helfer.
 *
 * Die Termine einer Quelle stehen in der Lokalzeit ihrer Stadt – München
 * rechnet in Europe/Berlin, Glasgow in Europe/London. Die Parser bauen daraus
 * über {@link zonedIso} einen ISO-String mit dem Offset, der an *diesem* Tag
 * gilt; einen Offset von Hand zu schreiben geht spätestens an der
 * Sommerzeitumstellung schief.
 *
 * `berlinIso`/`berlinDay` bleiben als Kurzform für die Münchner Quellen.
 */

export const TZ = 'Europe/Berlin';

const offsetFormatters = new Map<string, Intl.DateTimeFormat>();

function offsetFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = offsetFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' });
    offsetFormatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Offset ("+02:00") der Zeitzone zum gegebenen Zeitpunkt. */
function offsetAt(timeZone: string, utc: Date): string {
  const part = offsetFormatter(timeZone)
    .formatToParts(utc)
    .find((p) => p.type === 'timeZoneName');
  const match = part?.value.match(/GMT([+-]\d{2}:\d{2})/);
  return match ? match[1] : '+00:00';
}

/**
 * Baut aus Datum und Uhrzeit in der Lokalzeit einer Zeitzone einen ISO-String
 * mit korrektem Offset – auch über die Sommerzeitumstellung hinweg.
 */
export function zonedIso(timeZone: string, date: string, hour = 0, minute = 0): string {
  const [y, m, d] = date.split('-').map(Number);
  // Erste Näherung über UTC, dann Offset einmal korrigieren.
  let guess = Date.UTC(y, m - 1, d, hour, minute);
  for (let i = 0; i < 2; i++) {
    const off = offsetAt(timeZone, new Date(guess));
    const sign = off.startsWith('-') ? -1 : 1;
    const [oh, om] = off.slice(1).split(':').map(Number);
    guess = Date.UTC(y, m - 1, d, hour, minute) - sign * (oh * 60 + om) * 60_000;
  }
  const off = offsetAt(timeZone, new Date(guess));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${y}-${pad(m)}-${pad(d)}T${pad(hour)}:${pad(minute)}:00${off}`;
}

/** Wie {@link zonedIso}, für die Münchner Quellen. */
export function berlinIso(date: string, hour = 0, minute = 0): string {
  return zonedIso(TZ, date, hour, minute);
}

/** "YYYY-MM" für jeden Monat im Bereich, inklusive Rändern. */
export function monthsInRange(from: string, to: string): string[] {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  const months: string[] = [];
  for (let y = fy, m = fm; y < ty || (y === ty && m <= tm); ) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) { m = 1; y++; }
    if (months.length > 36) break; // Sicherheitsnetz
  }
  return months;
}

const dayFormatters = new Map<string, Intl.DateTimeFormat>();

/** Lokales Datum "YYYY-MM-DD" eines ISO-Zeitpunkts in der Zeitzone. */
export function zonedDay(timeZone: string, iso: string): string {
  let formatter = dayFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    dayFormatters.set(timeZone, formatter);
  }
  return formatter.format(new Date(iso));
}

/** Wie {@link zonedDay}, für die Münchner Quellen. */
export function berlinDay(iso: string): string {
  return zonedDay(TZ, iso);
}
