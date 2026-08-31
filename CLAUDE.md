# Hier ausgehen — Hinweise für Claude Code

Kalender für Münchner Veranstaltungen. Next.js (App Router), TypeScript,
Tailwind v4. Aufbau und Hintergründe stehen in `README.md`.

## Grundregeln

- **Quelle → Modell → UI.** Komponenten und Kalender kennen nur
  `CalendarEvent` aus `src/lib/events/types.ts`. Fremdformate leben
  ausschliesslich in `src/lib/events/sources/<quelle>/parse.ts`.
- **Eine neue Quelle heisst: eine Datei plus ein Eintrag in `registry.ts`.**
  Muss dafür etwas am Datenmodell oder an der UI geändert werden, ist das ein
  Hinweis auf ein Problem im Entwurf — kurz ansprechen statt still umbauen.
  Für den kompletten Ablauf gibt es die Skill `add-source`; zur Aufklärung
  einer neuen Seite `npm run probe -- <url>`.
- **Parser sind reine Funktionen** ohne Netzwerkzugriff und werden gegen eine
  gespeicherte Antwort in `__fixtures__/` getestet (`npm test`).
- **Keine erfundenen Daten.** Fehlt eine Angabe, bleibt das Feld leer bzw.
  `unknown`. Fixtures nie von Hand umdatieren.
- **Sichtbare Datums- und Zeitformate** laufen über den `Formatter` aus
  `src/lib/format.ts` (Sprache, Zeitzone, 12/24 h). In `calendar.ts` steht nur
  reine Datumsrechnung auf ISO-Tagen. Neue sichtbare Texte gehören ins
  Wörterbuch in `src/lib/i18n.ts` — beide Sprachen pflegen.

## Gestaltung

Ruhig, funktional, Nähe zu Notion Calendar: klare Typografie, viel Weissraum,
feine Linien statt Karten und Schatten, kleine Radien (3–10 px), gedeckte
Farben. Farbtöne kommen aus den Tokens in `src/app/globals.css` — nie feste
Hex-Werte in Komponenten, sonst bricht das dunkle Schema. Schatten nur für
echte Overlays.

Mobile ist eine eigene Gestaltung, keine verkleinerte Desktop-Ansicht:
Monatsraster kompakt mit Punkten plus Tagesliste, Filter als Overlay, Details
als Sheet.

## Prüfen

```bash
npm test && npx tsc --noEmit && npm run build
```
