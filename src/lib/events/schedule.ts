/**
 * Zeitrechnung für die tägliche Erhebung.
 *
 * Die Quellen werden einmal pro Tag um 5 Uhr Ortszeit der Stadt abgefragt –
 * früh genug, dass der Spielplan am Morgen aktuell ist, und spät genug, dass
 * die Häuser ihre Änderungen der Nacht eingepflegt haben. Alles hier ist reine
 * Rechnung ohne Netzwerk, damit es sich prüfen lässt.
 */

/** Stunde der täglichen Erhebung, in der Zeitzone der Stadt. */
export const REFRESH_HOUR = 5;

function partsInZone(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = new Map(
    formatter.formatToParts(date).map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: parts.get('year')!,
    month: parts.get('month')!,
    day: parts.get('day')!,
    hour: parts.get('hour')!,
    minute: parts.get('minute')!,
    second: parts.get('second')!,
  };
}

/** Verschiebung der Zone gegenüber UTC zu diesem Zeitpunkt, in Millisekunden. */
function zoneOffset(date: Date, timeZone: string): number {
  const p = partsInZone(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Sekundengenau: die Millisekunden des Ausgangswerts fallen dabei weg.
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Wandelt eine Ortszeit in den zugehörigen UTC-Zeitpunkt. */
function fromZone(
  wall: { year: number; month: number; day: number; hour: number },
  timeZone: string,
): Date {
  const naive = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour);
  // Zweimal nachrechnen: der erste Durchgang trifft die Verschiebung, der
  // zweite fängt den Sonderfall einer Zeitumstellung genau an dieser Grenze ab.
  let utc = naive;
  for (let i = 0; i < 2; i++) utc = naive - zoneOffset(new Date(utc), timeZone);
  return new Date(utc);
}

/** Heutiger Tag in dieser Zeitzone als ISO-Tag. */
export function todayInZone(timeZone: string, now: Date = new Date()): string {
  const p = partsInZone(now, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Nächster Erhebungszeitpunkt nach `now` – heute um 5 Uhr, sonst morgen. */
export function nextRefreshAt(now: Date, timeZone: string): Date {
  const p = partsInZone(now, timeZone);
  const today = fromZone({ year: p.year, month: p.month, day: p.day, hour: REFRESH_HOUR }, timeZone);
  if (today.getTime() > now.getTime()) return today;

  const tomorrow = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
  return fromZone(
    {
      year: tomorrow.getUTCFullYear(),
      month: tomorrow.getUTCMonth() + 1,
      day: tomorrow.getUTCDate(),
      hour: REFRESH_HOUR,
    },
    timeZone,
  );
}

/** Sekunden bis zur nächsten Erhebung – die Lebensdauer eines Datenstands. */
export function secondsUntilRefresh(now: Date, timeZone: string): number {
  return Math.max(60, Math.round((nextRefreshAt(now, timeZone).getTime() - now.getTime()) / 1000));
}
