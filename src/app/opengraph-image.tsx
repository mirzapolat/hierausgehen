import { ImageResponse } from 'next/og';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'HIERAUSGEHEN.DE';

/**
 * Vorschaubild für geteilte Links. Bewusst typografisch und ruhig, in
 * derselben Sprache wie die Oberfläche – kein Marketing-Banner.
 */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: '#ffffff',
          padding: 72,
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, color: '#6e6e73', fontSize: 28 }}>
          <div style={{ width: 12, height: 12, borderRadius: 999, background: '#B4472E' }} />
          <div style={{ width: 12, height: 12, borderRadius: 999, background: '#7A4FA0' }} />
          <div style={{ width: 12, height: 12, borderRadius: 999, background: '#4A7C59' }} />
          <div style={{ marginLeft: 12 }}>München</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ fontSize: 84, fontWeight: 600, color: '#1d1d1f', letterSpacing: '-0.03em' }}>
            HIERAUSGEHEN.DE
          </div>
          <div style={{ fontSize: 36, color: '#6e6e73', lineHeight: 1.35, maxWidth: 900 }}>
            Oper, Ballett, Theater und Konzert — alle Termine an einem Ort, mit Spielstätte und
            Ticketverfügbarkeit.
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            borderTop: '1px solid #ececea',
            paddingTop: 28,
            fontSize: 26,
            color: '#a1a1a6',
          }}
        >
          HIERAUSGEHEN.DE
        </div>
      </div>
    ),
    size,
  );
}
