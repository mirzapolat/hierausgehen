import * as cheerio from 'cheerio';
import type { CalendarEvent } from '../../types.ts';
import { berlinIso } from '../../time.ts';
import { clean } from '../../text.ts';
import type { PageResult } from '../page.ts';

/**
 * Parser für den Spielplan des Theater Laboratorium Oldenburg
 * (`/index.php?r=site/calender&month_id=M`).
 *
 * Ein Monat ist eine Tabelle: je Spieltag eine Zeile, darin eine Spalte je
 * Spielort (Theater Laboratorium, Limonadenfabrik, „Weitere Spielorte“), und
 * in jeder Zelle ein `fieldset` je Vorstellung – Rubrik, Titel, Untertitel,
 * Uhrzeit, Ticketshop und, für eigene Stücke, ein Link zur Stückseite.
 *
 * Die Adresse nennt nur die Monatsnummer, die Seite selbst kein Jahr. Das
 * Jahr gibt deshalb das Adapter mit (`month` als "YYYY-MM").
 */

const SOURCE_ID = 'theater-laboratorium';
const BASE = 'https://www.theater-laboratorium.org';

/** Welche Monate die Seite anbietet – aus der Monatsleiste, als Nummern. */
export function parseOfferedMonths(html: string): number[] {
  const $ = cheerio.load(html);
  const months = new Set<number>();
  $('.subpage_navigation a[href*="month_id="]').each((_, element) => {
    const id = Number($(element).attr('href')?.match(/month_id=(\d{1,2})/)?.[1]);
    if (id >= 1 && id <= 12) months.add(id);
  });
  return [...months];
}

export function parseMonth(html: string, month: string): PageResult {
  const $ = cheerio.load(html);

  // Die Tabelle steht auch in einem Monat ohne Vorstellung da – dann leer.
  const table = $('table.calender_web');
  if (table.length === 0) return { events: [], skipped: 0, empty: false };

  const venues = table
    .find('thead td')
    .map((_, element) => clean($(element).text()))
    .get();

  const events: CalendarEvent[] = [];
  let skipped = 0;

  table.find('tbody tr').each((_, row) => {
    const cells = $(row).children('td');
    const dayCell = cells.filter('.date_col').first();
    if (dayCell.length === 0) return;

    const day = Number(clean(dayCell.find('p').first().text()).replace(/\.$/, ''));
    const valid = day >= 1 && day <= 31;

    cells.each((column, cell) => {
      $(cell)
        .children('fieldset')
        .each((_, element) => {
          const entry = $(element);
          const title = clean(entry.find('legend h6').first().text());
          const time = parseTime(clean(entry.children('p').first().text()));
          const shop = entry.find('a[href*="eventim-inhouse"]').first().attr('href');
          const shopId = shop?.match(/[?&]event=(\d+)/)?.[1];

          if (!valid || !title) {
            skipped++;
            return;
          }

          const date = `${month}-${String(day).padStart(2, '0')}`;
          const info = entry.find('a[href*="progtitle_id="]').first().attr('href');
          const venue = venues[column] || 'Theater Laboratorium';

          events.push({
            // Die Vorstellungsnummer des Ticketshops ist je Abend eindeutig.
            id: `${SOURCE_ID}:${shopId ?? `${date}-${slug(title)}`}`,
            sourceId: SOURCE_ID,
            title,
            subtitle: clean(entry.find('legend h8').first().text()) || undefined,
            category: clean(entry.find('legend > p').first().text()) || undefined,
            start: berlinIso(date, time?.hour ?? 0, time?.minute ?? 0),
            allDay: !time,
            venue: { name: venue },
            // Der Warenkorb ist der Kaufen-Knopf; einen Ausverkauft-Zustand
            // zeigt der Kalender nicht.
            availability: shop ? 'available' : 'unknown',
            ticketUrl: shop,
            url: info ? absolute(info) : `${BASE}/index.php?r=site%2Fcalender&month_id=${Number(month.slice(5))}`,
          });
        });
    });
  });

  return { events, skipped, empty: events.length === 0 };
}

/** Programmtext der Stückseite – ohne die Besetzungs- und Produktionslisten. */
export function parseDetailDescription(html: string): string | undefined {
  const $ = cheerio.load(html.replace(/<\s*br\s*\/?\s*>/gi, '\n'));
  const section = $('#repertoire_content_section').first();
  if (section.length === 0) return undefined;

  // Alles ab der ersten Zwischenüberschrift („Spiel“, „Produktion“) ist Abspann.
  section.find('h2').first().nextAll().remove();
  section.find('h2').remove();

  const paragraphs = section
    .text()
    .split(/\n\s*\n/)
    .map((block) => block.split('\n').map(clean).filter(Boolean).join('\n'))
    .filter(Boolean);

  return paragraphs.length ? paragraphs.join('\n\n') : undefined;
}

/* ------------------------------------------------------------------ */

function parseTime(label: string): { hour: number; minute: number } | undefined {
  const match = label.match(/(\d{1,2})[:.](\d{2})\s*Uhr/);
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return undefined;
  return { hour, minute };
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function absolute(href: string): string {
  return href.startsWith('http') ? href : `${BASE}${href.startsWith('/') ? '' : '/'}${href}`;
}
