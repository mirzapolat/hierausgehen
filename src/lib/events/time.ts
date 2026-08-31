/** Zeitzonen-Helfer. Alle Quellen liefern lokale Münchner Zeit. */

export const TZ = 'Europe/Berlin';

const offsetFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  timeZoneName: 'longOffset',
});

/** Offset ("+02:00") von Europe/Berlin zum gegebenen Zeitpunkt. */
function offsetAt(utc: Date): string {
  const part = offsetFormatter.formatToParts(utc).find((p) => p.type === 'timeZoneName');
  const match = part?.value.match(/GMT([+-]\d{2}:\d{2})/);
  return match ? match[1] : '+00:00';
}

/**
 * Baut aus Datum und Uhrzeit in Münchner Lokalzeit einen ISO-String mit
 * korrektem Offset – auch über die Sommerzeitumstellung hinweg.
 */
export function berlinIso(date: string, hour = 0, minute = 0): string {
  const [y, m, d] = date.split('-').map(Number);
  // Erste Näherung über UTC, dann Offset einmal korrigieren.
  let guess = Date.UTC(y, m - 1, d, hour, minute);
  for (let i = 0; i < 2; i++) {
    const off = offsetAt(new Date(guess));
    const sign = off.startsWith('-') ? -1 : 1;
    const [oh, om] = off.slice(1).split(':').map(Number);
    guess = Date.UTC(y, m - 1, d, hour, minute) - sign * (oh * 60 + om) * 60_000;
  }
  const off = offsetAt(new Date(guess));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${y}-${pad(m)}-${pad(d)}T${pad(hour)}:${pad(minute)}:00${off}`;
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

/** Lokales Datum "YYYY-MM-DD" eines ISO-Zeitpunkts in Münchner Zeit. */
const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
export function berlinDay(iso: string): string {
  return dayFormatter.format(new Date(iso));
}
