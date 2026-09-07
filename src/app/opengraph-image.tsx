import { ImageResponse } from 'next/og';
import { GROUP_COLORS } from '@/lib/events/groups';
import { sources } from '@/lib/events/registry';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'HIERAUSGEHEN.de — Veranstaltungskalender für München und Glasgow';

/**
 * Vorschaubild für geteilte Links.
 *
 * Es zeigt, was die Seite ist: ein Monatsraster mit farbigen Balken. Dieselbe
 * Sprache wie die Oberfläche – feine Linien, gedeckte Töne, kein Marketing.
 * Die Farben sind die der Ordner, damit das Bild und der Kalender dasselbe
 * meinen, wenn sie dieselbe Farbe zeigen.
 */

const TEXT = '#1d1d1f';
const MUTED = '#6e6e73';
const FAINT = '#a1a1a6';
const LINE = '#ececea';

const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

const [OPER, THEATER, KONZERT, CLUB, KINO, LITERATUR, KULTUR] = [
  GROUP_COLORS['Oper & Ballett'],
  GROUP_COLORS.Theater,
  GROUP_COLORS.Konzert,
  GROUP_COLORS.Club,
  GROUP_COLORS.Kino,
  GROUP_COLORS.Literatur,
  GROUP_COLORS.Kultur,
];

/**
 * Vier Wochen als feste Belegung. Bewusst von Hand gesetzt statt zufällig:
 * das Bild soll bei jedem Aufruf dasselbe sein, und die Wochenenden sollen
 * voller wirken als die Wochenmitte – so sieht ein echter Spielplan aus.
 */
const WEEKS: string[][][] = [
  [[OPER], [THEATER], [], [KONZERT, KINO], [THEATER], [OPER, CLUB], [LITERATUR]],
  [[KONZERT], [], [KULTUR], [THEATER], [OPER, KONZERT], [CLUB, THEATER], [KINO]],
  [[THEATER, LITERATUR], [KINO], [KONZERT], [], [OPER], [KONZERT, CLUB], [OPER]],
  [[], [KULTUR], [THEATER], [KONZERT], [KINO, OPER], [THEATER], [CLUB]],
];

/** Der erste Tag im Raster – nur ein Platzhalter, kein echtes Datum. */
const FIRST_DAY = 2;

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          background: '#ffffff',
          fontFamily: 'sans-serif',
        }}
      >
        {/* Links: worum es geht. */}
        <div
          style={{
            width: 556,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            padding: '64px 52px',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
            <div
              style={{
                display: 'flex',
                fontSize: 52,
                fontWeight: 700,
                color: TEXT,
                letterSpacing: '-0.035em',
                lineHeight: 1,
              }}
            >
              HIERAUSGEHEN.de
            </div>
            <div style={{ display: 'flex', fontSize: 27, color: MUTED, lineHeight: 1.4 }}>
              Oper, Theater, Konzert, Club, Kino und Literatur. Alle Termine in einem Kalender.
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              marginTop: 36,
              borderTop: `1px solid ${LINE}`,
              paddingTop: 26,
              fontSize: 22,
              color: FAINT,
            }}
          >
            <div style={{ display: 'flex' }}>{sources.length} Häuser · täglich aktualisiert</div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              {[OPER, THEATER, KONZERT, CLUB, KINO, LITERATUR, KULTUR].map((color) => (
                <div
                  key={color}
                  style={{ width: 10, height: 10, borderRadius: 999, background: color }}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Rechts: der Kalender selbst, an den Rand gesetzt wie im Fenster. */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            flexGrow: 1,
            background: '#fafaf9',
            borderLeft: `1px solid ${LINE}`,
            padding: '60px 0 0 40px',
          }}
        >
          <div style={{ display: 'flex' }}>
            {WEEKDAYS.map((day) => (
              <div
                key={day}
                style={{
                  display: 'flex',
                  width: 84,
                  paddingBottom: 14,
                  fontSize: 19,
                  color: FAINT,
                }}
              >
                {day}
              </div>
            ))}
          </div>

          {WEEKS.map((week, weekIndex) => (
            <div key={weekIndex} style={{ display: 'flex' }}>
              {week.map((entries, dayIndex) => {
                const day = FIRST_DAY + weekIndex * 7 + dayIndex;
                return (
                  <div
                    key={dayIndex}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 7,
                      width: 84,
                      height: 118,
                      paddingTop: 10,
                      paddingRight: 12,
                      borderTop: `1px solid ${LINE}`,
                    }}
                  >
                    <div style={{ display: 'flex', fontSize: 20, color: MUTED }}>{day}</div>
                    {entries.map((color, entryIndex) => (
                      <div
                        key={entryIndex}
                        style={{
                          display: 'flex',
                          height: 8,
                          // Ungleiche Breiten – Titel sind nun einmal ungleich lang.
                          width: entryIndex === 0 ? 58 : 42,
                          borderRadius: 3,
                          background: color,
                        }}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
