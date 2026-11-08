import { cities } from './cities.ts';

/**
 * Feste Angaben zur Seite – von Layout, Sitemap und strukturierten Daten genutzt.
 *
 * Bewusst ohne Registry: die Datei darf auch im Browser landen. Was die
 * Quellen braucht – auch Titel, Beschreibung und Suchbegriffe der Seite, die
 * nur Städte mit Quellen nennen –, steht in `site-metadata.ts`.
 */
export const SITE_URL = 'https://hierausgehen.de';
export const SITE_NAME = 'HIERAUSGEHEN.de';
/** Der Name unter dem Icon auf dem Startbildschirm (iOS und Android). */
export const APP_NAME = 'HIER AUSGEHEN';

/** Der Link auf eine Stadt – die Standardstadt liegt auf der Wurzel. */
export function cityPath(cityId: string): string {
  return cityId === cities[0].id ? '/' : `/?city=${cityId}`;
}

export function cityUrl(cityId: string): string {
  return new URL(cityPath(cityId), SITE_URL).toString();
}

/**
 * Jeder Titel im Browser hat dieselbe Form: vorn, was offen ist, dahinter
 * der Name der Seite. Der Mittelpunkt trennt, nie ein Gedankenstrich.
 */
export const TITLE_SEPARATOR = ' · ';

export function pageTitle(part: string): string {
  return `${part}${TITLE_SEPARATOR}${SITE_NAME}`;
}

/** Was im Tab vor dem Namen steht, solange der Kalender einer Stadt offen ist. */
export function cityTitle(cityName: string): string {
  return `Veranstaltungen in ${cityName}`;
}

/** Lesbare Programmübersicht, auch ohne JavaScript. */
export function programmePath(cityId: string): string {
  return `/veranstaltungen/${cityId}`;
}
