import type { Locale } from './i18n.ts';

/**
 * Ankündigungen beim Start: Neuerungen, Hinweise, Tipps.
 *
 * So kommt eine neue dazu: einen Eintrag oben in `ANNOUNCEMENTS` anlegen,
 * mit einer festen, nie wieder vergebenen `id` und dem Tag, ab dem sie gilt.
 * Mehr braucht es nicht; Auswahl, Anzeige und „schon gesehen“ erledigt der
 * Rest (`pickAnnouncement`, `AnnouncementDialog`).
 *
 * Die Regeln, nach denen eine erscheint:
 *
 * - Einmal je Gerät. Gesehen ist sie, sobald sie geschlossen wurde, egal wie.
 * - Je Start höchstens eine, und zwar die neueste. Ältere, die noch offen
 *   waren, gelten damit als erledigt: wer drei Wochen weg war, will nicht
 *   drei Fenster nacheinander wegklicken.
 * - Wer die Seite zum ersten Mal öffnet, bekommt kein „Was ist neu“: für
 *   ihn ist alles neu. Nur Einträge mit `forNewcomers` erreichen ihn.
 * - `audience` grenzt auf Telefon (schmal oder als App vom Startbildschirm)
 *   oder Schreibtisch ein; `until` lässt eine Ankündigung auslaufen.
 *
 * Texte stehen in beiden Sprachen direkt am Eintrag: sie gehören zu genau
 * dieser Ankündigung und nicht ins allgemeine Wörterbuch.
 */

export type AnnouncementKind = 'feature' | 'notice' | 'tip';
export type AnnouncementAudience = 'all' | 'mobile' | 'desktop';
/** Bewusst Namen statt Komponenten: diese Datei bleibt frei von React. */
export type AnnouncementIcon = 'calendar' | 'swipe' | 'pin' | 'refresh' | 'search' | 'bookmark' | 'ticket' | 'map';

type Localized = Record<Locale, string>;

export interface Announcement {
  /** Fest und einmalig, etwa `2026-11-mobil`. Wird gespeichert, nie umbenennen. */
  id: string;
  kind: AnnouncementKind;
  /** Ab diesem Tag (ISO) wird sie gezeigt; zugleich das Datum in der Kopfzeile. */
  date: string;
  /** Bis einschliesslich diesem Tag; danach nicht mehr. */
  until?: string;
  audience?: AnnouncementAudience;
  /** Auch beim allerersten Besuch zeigen (für echte Ankündigungen, nicht für Neuerungen). */
  forNewcomers?: boolean;
  title: Localized;
  lead: Localized;
  /** Einzelne Punkte, je mit Symbol, für eine Neuerung mit mehreren Teilen. */
  items?: { icon: AnnouncementIcon; title: Localized; text: Localized }[];
  /** Ein weiterführender Knopf, etwa zu einer Seite. Ohne ihn genügt „Verstanden“. */
  action?: { label: Localized; href: string };
}

export const ANNOUNCEMENTS: Announcement[] = [
  {
    id: '2026-11-mobil',
    kind: 'feature',
    date: '2026-11-03',
    audience: 'mobile',
    title: {
      de: 'Neu auf dem Handy',
      en: 'New on your phone',
    },
    lead: {
      de: 'Der Kalender fühlt sich jetzt an wie eine App. Ein paar Dinge haben sich verändert.',
      en: 'The calendar now feels like an app. A few things have changed.',
    },
    items: [
      {
        icon: 'calendar',
        title: { de: 'Quer halten für die Woche', en: 'Turn sideways for the week' },
        text: {
          de: 'Hochkant siehst du den Monat, quer gehalten die ganze Woche auf einen Blick.',
          en: 'Upright you see the month; turned sideways, the whole week at a glance.',
        },
      },
      {
        icon: 'swipe',
        title: { de: 'Wischen statt Tippen', en: 'Swipe instead of tap' },
        text: {
          de: 'Details schliesst du mit einem Wisch nach unten, den Monat klappst du am Griff auf die Woche ein.',
          en: 'Swipe details down to close them, and drag the handle to fold the month into a week.',
        },
      },
      {
        icon: 'pin',
        title: { de: 'Stadt im Menü', en: 'City in the menu' },
        text: {
          de: 'Die Stadtauswahl steht jetzt im Menü oben rechts.',
          en: 'Switch cities from the menu in the top right.',
        },
      },
      {
        icon: 'refresh',
        title: { de: 'Immer auf dem neuesten Stand', en: 'Always up to date' },
        text: {
          de: 'Vom Startbildschirm geöffnet meldet sich die App, sobald es eine neue Version gibt.',
          en: 'Opened from your home screen, the app lets you know when a new version is out.',
        },
      },
    ],
  },
];

/* ------------------------------ Auswahl ------------------------------- */

export interface PickContext {
  /** Gesehene IDs; `null` heisst: noch nie etwas gespeichert, also erster Besuch. */
  seen: ReadonlySet<string> | null;
  /** Heutiger Tag (ISO) in der Zeitzone der Stadt. */
  today: string;
  device: 'mobile' | 'desktop';
}

/** Was jetzt grundsätzlich gezeigt werden dürfte, unabhängig von „gesehen“. Neueste zuerst. */
export function currentAnnouncements(
  list: readonly Announcement[],
  context: Omit<PickContext, 'seen'>,
): Announcement[] {
  return list
    .filter((item) => item.date <= context.today)
    .filter((item) => !item.until || context.today <= item.until)
    .filter((item) => (item.audience ?? 'all') === 'all' || item.audience === context.device)
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}

/** Die eine Ankündigung, die beim Start erscheint, oder keine. */
export function pickAnnouncement(list: readonly Announcement[], context: PickContext): Announcement | undefined {
  const firstVisit = context.seen === null;
  // Nur die neueste zählt: ist sie gesehen, sind es die älteren auch.
  const newest = currentAnnouncements(list, context).filter((item) => !firstVisit || item.forNewcomers)[0];
  return newest && !context.seen?.has(newest.id) ? newest : undefined;
}

/* ------------------------------ Speicher ------------------------------ */

export const ANNOUNCEMENTS_STORAGE_KEY = 'hierausgehen.announcements.v1';

/** `null`, wenn auf diesem Gerät noch nie etwas gespeichert wurde. */
export function readSeen(): Set<string> | null {
  try {
    const raw = localStorage.getItem(ANNOUNCEMENTS_STORAGE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as { seen?: unknown };
    return new Set(
      Array.isArray(parsed.seen) ? parsed.seen.filter((id): id is string => typeof id === 'string') : [],
    );
  } catch {
    // Ohne Speicher (privates Fenster, gesperrt): lieber nichts zeigen als jedes Mal.
    return new Set(ANNOUNCEMENTS.map((item) => item.id));
  }
}

export function writeSeen(ids: Iterable<string>): void {
  try {
    localStorage.setItem(ANNOUNCEMENTS_STORAGE_KEY, JSON.stringify({ seen: [...new Set(ids)] }));
  } catch {
    // Nicht zu speichern ist kein Fehler; dann erscheint sie eben noch einmal.
  }
}
