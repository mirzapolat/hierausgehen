---
name: add-source
description: Add a new event source (venue, theatre, concert hall, club) to the hierausgehen calendar. Use when the user gives a website URL of a venue's programme/Spielplan and wants its events integrated, or says "add this source", "neue Quelle", "füge X hinzu". Reverse-engineers the site's data endpoint, writes an adapter with a tested parser, and registers it.
---

# Neue Veranstaltungsquelle hinzufügen

Ziel: aus einer Veranstalter-Website einen Adapter machen, der konsistente
`CalendarEvent[]` liefert. Kalender, Datenmodell und UI werden dabei **nicht**
angefasst — nur ein neuer Ordner unter `sources/` plus eine Zeile in der
Registry. Muss dafür am Datenmodell oder an der UI etwas geändert werden, ist
das ein Befund über den Entwurf: ansprechen, nicht still umbauen.

```bash
npm run probe -- <url> <url-anderer-monat>     # 1. Endpunkt und Zeitraum-Parameter
npm run probe -- --anatomie <url|.probe/datei> # 2. Terminblock, Felder, Signale
#  … Fixtures ablegen, parse.ts + index.ts + parse.test.ts schreiben …
npm test && npx tsc --noEmit && npx eslint src scripts && npm run build
npm run check -- <quellen-id>                  # live, mehrere Monate, kalter Cache
npm run categories -- <quellen-id>             # Veranstaltungsarten einordnen
```

Grenzen: nur öffentlich zugängliche Seiten, keine Logins, Paywalls, Captchas,
kein Umgehen von Sperren oder Ratenbegrenzungen. `robots.txt` der Quelle ansehen
und gesperrte Pfade respektieren. Dass `fetchText` sich wie ein Browser verhält,
ist kein Umgehen eines Zugangsschutzes — abgerufen wird genau die Seite, die
jeder Browser ohne Anmeldung bekommt. Was bleibt, ist Zurückhaltung: grosszügige
TTL, keine parallelen Massenabrufe.

## 0. Was der Nutzer mitgibt

Meistens ein Link, manchmal ein Hinweis auf das Muster („die Monate hängen
hinten dran"). Solche Hinweise sparen die halbe Suche — trotzdem selbst
gegenprüfen. Fehlt etwas Entscheidendes, das nicht auf der Seite steht (welche
Spielstätten dazugehören, ob Nebenreihen mit sollen), einmal nachfragen. Alles
andere selbst herausfinden.

## 1. Endpunkt finden

Nicht die gerenderte Seite parsen, solange es etwas Besseres gibt:

1. **JSON-API** — `/api/…`, `/graphql`, `?format=json`.
2. **HTML-Fragment zum Nachladen** — Staatsoper:
   `/spielplan/{YYYY-MM}/calendar.ajax`. Oft der ganze Monat ohne JavaScript
   und ohne Paging, bei einem Fünftel der Übertragung.
3. **ICS-Feed** — `/calendar.ics`, `/termine.ics`. Selten, aber am stabilsten.
4. **`<script type="application/ld+json">`** mit `@type: Event`.
5. **Gerendertes HTML** — letzte Wahl.

`npm run probe` benutzt denselben HTTP-Client wie die Adapter, legt die Antwort
unter `.probe/` ab und zeigt Endpunkte, strukturierte Daten, wiederkehrende
Container sowie Datums- und Ticketmuster. **Zwei URLs mit verschiedenen Monaten
nebeneinander** beantworten die wichtigste Frage: gibt es einen Parameter für
den Zeitraum? Ohne den muss der Adapter blättern oder alles auf einmal holen.

Wenn das Skript keine Datumsmuster findet, 403 kommt oder ein Token nötig ist:
**`referenzen/endpunkt-finden.md`** (XHR aufzeichnen, TLS-Fingerabdruck,
Web-Archiv, Spielzeit-am-Stück-Seiten).

## 2. Struktur lesen

```bash
npm run probe -- --anatomie .probe/<datei>.html [--auswahl "li.termin"]
```

Das nennt die Kandidaten für den Terminblock, druckt zwei Blöcke vollständig
aus und listet die Felder darin mit ihrem Anteil sowie die Ticketsignale. Damit
ist die Handarbeit erledigt — von Hand nachzählen nur noch dort, wo die Anteile
stutzig machen. Und die machen stutzig:

- **100 %** — Pflichtfeld, taugt als Anker.
- **um 50 %** — entweder ein Sonderfall (Premiere, Führung) oder zwei Bauarten
  desselben Feldes. Beide ansehen, nicht die häufigere nehmen.
- **Blockzahl = Termine × 2 oder 3** — die Seite rendert je Breakpoint eine
  Variante. Eine wählen, über die Termin-ID entdoppeln.

Die Zahl der Blöcke immer gegen die Website prüfen, bevor sie in einen Test
wandert.

## 3. Fixtures ablegen

Echte Antworten unverändert speichern:

```
src/lib/events/sources/<quelle>/__fixtures__/<beschreibung>-<YYYY-MM>.html
```

Mindestens zwei: **ein voller Monat** und **ein leerer** (Sommerpause oder
Vergangenheit). Der leere Fall ist der, der später Fehlalarme auslöst. Eine
Seite ganz ohne Terminliste ist kein leerer Monat, sondern ein Layoutbruch —
Fixture entsprechend benennen. Nie umdatieren, nie von Hand nachbessern.

## 4. Felder zuordnen

Pflicht: Titel, Beginn, Spielstätte, Veranstaltungsart, Ticketlage, Link zur
Veranstaltung. Kurzinfo- oder Programmtext aus der Liste gehört nach
`description`, nicht in `notes`.

Nichts erfinden: fehlt eine Einzelangabe, bleibt das Feld leer bzw. `unknown`;
nur die Veranstaltungsart bekommt über `defaultCategory` einen Quellen-Fallback.

Die Veranstaltungsart wird **im Wortlaut der Quelle** übernommen — „Live Music",
„Musik", „Kinder & Familie". Das Zusammenführen erledigt `categories.ts`
danach; der Originalwortlaut bleibt am Termin erhalten. Schritt 7 entscheidet,
ob eine Formulierung ein Synonym oder eine neue Art ist.

Alles Weitere — Ticketlage-Tabelle, Untertitel gegen Hinweise, IDs, Zeitzone,
Detailseiten-Texte und die Fallen, die schon einmal zugeschlagen haben — steht
in **`referenzen/felder-und-fallen.md`**. Vor dem Schreiben des Parsers lesen.

## 5. Adapter schreiben

Vorlage `src/lib/events/sources/_template.ts`, bestes Vorbild
`src/lib/events/sources/staatsoper/`.

```
src/lib/events/sources/<quelle>/
  index.ts        # EventSource: Definition, Laden, Zeitraum, Fehlerfälle
  parse.ts        # reine Funktion Fremdformat -> CalendarEvent[]
  parse.test.ts   # Test gegen die Fixtures
  __fixtures__/
```

`parse.ts` macht **kein** Netzwerk, `index.ts` **kein** Parsen. Nur so bleibt
der Parser testbar.

In `index.ts`:

- `definition.cityId` muss in `src/lib/cities.ts` existieren.
- `definition.group` ist der Ordner in der Sidebar und bestimmt zugleich die
  Farbe. Die möglichen Ordner stehen in `src/lib/events/groups.ts`; die Quelle
  wählt einen davon (der Typ lässt nichts anderes zu). Ein wirklich neuer
  Ordner wird dort samt Farbe angelegt — eine eigene Farbe je Quelle gibt es
  nicht.
- `definition.defaultCategory` setzen, wenn nicht jeder Termin eine eigene
  Gattung liefert.
- `iconUrl` nur setzen, wenn die Favicon-Erkennung über die Startseite nichts
  findet; die Erkennung hat Vorrang, damit ein Icon-Wechsel sich selbst heilt.
- `ttlSeconds` so, dass die Quelle höchstens ein paar Mal pro Stunde angefasst
  wird (30 Minuten sind der übliche Wert).
- Mehrere Monate (oder Sparten, Seiten) über `settleParts` aus
  `sources/collect.ts`: einzelne Lücken werden protokolliert, ein Totalausfall
  wirft. Dort liegen auch `withinRange`, `dedupeById` und `today` — nicht neu
  schreiben.
- Der Parser liefert ein `PageResult` (`sources/page.ts`): `events`,
  `skipped` und `empty`. Das Adapter ruft `assertRecognised(events.length,
  empty, '<Ort>')` — eine Antwort ohne erkennbaren Termin **muss werfen**. Die
  Aggregation liefert dann den Cache aus und meldet die Quelle als veraltet —
  ein stilles „keine Termine" wäre die schlechtere Antwort.
- **Ausnahme:** ein leerer Monat ist kein Fehler, der Parser meldet ihn als
  `empty: true`. Drei Bauarten sind uns
  begegnet: eine ausdrückliche Leermeldung im Markup (Staatsoper
  `.activity-list__col--empty`), ein vorhandener, aber leerer Container
  (Residenztheater `div.schedule`) und eine leere Antwort plus Endesignal
  (Gärtnerplatz: leerer Body bzw. `ende erreicht.`). Immer am **Markup oder am
  Signal** festmachen, nie an der Antwortlänge — Sommerpause, noch nicht
  begonnener Vorverkauf und vergangene Monate sehen genau so aus.
- **Kennt die Quelle keine Vergangenheit**, Monate vor dem laufenden gar nicht
  erst anfragen und leer zurückgeben.

## 6. Registrieren

In `src/lib/events/registry.ts` importieren und in `sources` eintragen. Mehr ist
nicht nötig — Sidebar, Ordner, Filter, Farbe und Favicon ergeben sich daraus.

## 7. Prüfen

```bash
npm test && npx tsc --noEmit && npx eslint src scripts && npm run build
npm run check -- <quellen-id>
```

Der Parser-Test deckt mindestens ab: Gesamtzahl der Termine, ein vollständig
normalisierter Termin mit allen Feldern, die Verteilung der
Verfügbarkeitszustände, Eindeutigkeit der IDs, den ausdrücklich leeren Monat
sowie leeres und kaputtes HTML. Liefert die Liste Programmtext, muss ein Test
`description` abdecken; gibt es Detailseiten, einer `parseDetailDescription`.

`npm run check` ruft den Adapter live auf — über Vergangenheit, laufenden
Monat, die nächsten Monate und die Spielzeitpause, mit abgeschaltetem
Platten-Cache. Es prüft, was die API garantieren muss: Pflichtfelder nach der
Normalisierung, eindeutige IDs, keine Dopplungen, keine Termine ausserhalb des
angefragten Zeitraums. Ohne Argument laufen alle Quellen, mit `2026-11` o. ä.
ein bestimmter Monat.

Warum mehrere Monate: ein Adapter, der nur einen Monat kann, fällt sonst nicht
auf. Genau das ist hier schon passiert.

Danach die Veranstaltungsarten einordnen:

```bash
npm run categories -- <quellen-id>
```

Die Ausgabe stellt jeder Formulierung der Quelle die Art gegenüber, die daraus
wird, und markiert mit `*`, was der Wortschatz in `src/lib/events/categories.ts`
noch nicht kennt. Jede Markierung braucht eine Entscheidung: Synonym einer
bestehenden Art (dann in `SYNONYMS` eintragen) oder wirklich eine neue Art (dann
in `CATEGORIES` aufnehmen). Neue Arten sind ausdrücklich erlaubt — die Liste
soll die Breite des Programms abbilden. Vermieden werden soll nur, dass
dieselbe Sache zweimal unter verschiedenen Namen als Filter steht. Die Regeln
dazu stehen in `referenzen/felder-und-fallen.md`.

Die ausgegebenen Zahlen mit der Website vergleichen, nicht nur „es kommt etwas".
Dann ein Ereignis vollständig ansehen: stimmen Uhrzeit, Spielstätte,
Ticketlink? Für die Oberfläche zusätzlich `npm run dev` — dabei zwei Fallen:
ein gelöschtes `.cache` merkt der laufende Server nicht (dann neu starten;
Schreibvorgänge von aussen übernimmt er von selbst), und `npm run seed` legt
Fixture-Daten in den Cache, die danach wieder raus müssen.

## 8. Berichten

Kurz und konkret: welcher Endpunkt, wie die Ticketlage erkannt wird, welche
Veranstaltungsart-Felder direkt aus der Quelle kommen, welcher `defaultCategory`
greift, welche Arten dabei neu in den Wortschatz kamen und welche als Synonym
eingeordnet wurden, was der Adapter **nicht** liefert (z. B. keine
Endzeiten, kein langer Programmtext), wie viele Termine je Monat im Vergleich
zur Website, ob Dopplungen auffallen, und woran auffällt, dass die Quelle sich
geändert hat.

## Referenzen

- `referenzen/endpunkt-finden.md` — kein Termin im HTML, 403, Token,
  Web-Archiv, Seiten ohne Monatsparameter.
- `referenzen/felder-und-fallen.md` — Ticketlage-Tabelle, Zuordnung der Felder,
  Detailseiten-Texte, und die Fallen, die schon einmal zugeschlagen haben.
