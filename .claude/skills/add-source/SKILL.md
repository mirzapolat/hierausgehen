---
name: add-source
description: Add a new event source (venue, theatre, concert hall, club) to the hierausgehen calendar. Use when the user gives a website URL of a venue's programme/Spielplan and wants its events integrated, or says "add this source", "neue Quelle", "füge X hinzu". Reverse-engineers the site's data endpoint, writes an adapter with a tested parser, and registers it.
---

# Neue Veranstaltungsquelle hinzufügen

Ziel: aus einer Veranstalter-Website einen Adapter machen, der konsistente
`CalendarEvent[]` liefert — ein neuer Ordner unter `sources/` plus eine Zeile in
`registry.ts`. Muss am Datenmodell oder an der UI etwas geändert werden, ist das
ein Befund über den Entwurf: ansprechen, nicht still umbauen.

Grenzen: nur öffentlich zugängliche Seiten, keine Logins, Paywalls, Captchas,
kein Umgehen von Sperren. `robots.txt` respektieren. `fetchText` verhält sich wie
ein Browser — das ist kein Umgehen. Grosszügige TTL, keine Massenabrufe.

## Sparsam arbeiten

Die Kosten entstehen durch einen wachsenden Verlauf, nicht durch einzelne
Befehle. Jede Runde liest den ganzen bisherigen Kontext neu. Deshalb:

- **Mehrere Quellen → je Quelle ein Subagent**, parallel gestartet
  (`general-purpose`, Auftrag: „Skill add-source für <URL>, Stadt <id>; nicht
  registrieren, `categories.ts`/`geocode.ts` nicht anfassen, am Ende Bericht nach
  Schritt 8 plus vorgeschlagene Synonyme/neue Arten“). Der Hauptagent trägt danach
  alles in `registry.ts` ein, entscheidet die Arten und führt die Prüfkette einmal
  aus. Bei einer einzelnen Quelle selbst arbeiten.
- **Wenige, gebündelte Runden.** Unabhängige Abrufe in einen Befehl oder parallel.
  Ziel: Erkundung in ≤ 10 Runden, Parser + Test in ≤ 5.
- **Ausgaben klein halten.** Nie rohes HTML oder ganze Fixtures ausgeben. Immer
  `| head -N` bzw. Ausschnitte (`grep -oE '.{0,200}muster.{0,200}'`). Grosse
  Ausgaben in eine Datei im Scratchpad schreiben und gezielt daraus lesen.
- **Nicht den Code durchlesen.** Der Werkzeugkasten unten reicht. Vorlage
  `sources/_template.ts` und ein Vorbild nur öffnen, wenn etwas unklar bleibt.
  Dann gezielt (`sed -n`), nicht ganze Dateien.
- **Ein Werkzeug statt Ad-hoc-Skripte.** Struktur über
  `npm run probe -- --anatomie`, nicht über selbstgeschriebene Python-Zähler.
  Den Parser über seinen Test prüfen (Schritt 5), nicht über Wegwerf-Skripte.
- **Datei einmal richtig schreiben**, danach kleine `Edit`s. Kein
  komplettes Neuschreiben nach jedem Befund.
- **Volle Prüfkette nur einmal am Ende**, Ausgabe gefiltert (Schritt 7).

## Werkzeugkasten (Signaturen, nicht nachlesen)

```ts
// ../types.ts
CalendarEvent { id, sourceId, title, subtitle?, description?, category?, start, end?,
  allDay, venue: { name, city? }, availability, availabilityLabel?, ticketUrl?, url, notes? }
EventSource { definition: { id, name, cityId, group, defaultCategory?, homepage,
  enabledByDefault?, iconUrl? }, ttlSeconds?, fetchEvents(range, signal?, options?) }
FetchRange { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }   EventFetchOptions { requestTimeoutMs?, … }
// availability: 'available' | 'limited' | 'soldout' | 'not_on_sale' | 'unknown'
//   (abgesagt → 'not_on_sale' mit availabilityLabel 'Abgesagt')

// ../http.ts — Adapter benutzen nie direkt fetch
fetchText(url, { signal, timeoutMs: options?.requestTimeoutMs, headers?, body?, jar?, retries? })
createCookieJar()

// ../time.ts
berlinIso(date, h, m)  zonedIso(tz, date, h, m)  berlinDay(iso)  zonedDay(tz, iso)
monthsInRange(from, to) → ['YYYY-MM', …]

// ../text.ts
clean(text)  softenShouted(text)  decodeEntities(text)

// ./page.ts
PageResult { events, skipped, empty }   assertRecognised(found, empty, '<Ort>')  // wirft

// ./collect.ts
settleParts({ sourceId, parts, load, label?, sequential? })  withinRange(start, range)
dedupeById(events)  today()

// ./detail.ts
enrichEventDescriptions({ sourceId, events, signal, fetchOptions, parseDescription(html, url),
  cacheKey?, fetchUrl?, concurrency? })
enrichEventDetails({ …, parse(html, url): EventDetail, timeZone? })
EventDetail { description?, category?, startTime?, availability?, availabilityLabel?, ticketUrl?, notes? }

// ../groups.ts — definition.group
'Oper & Ballett' | 'Theater' | 'Konzert' | 'Club' | 'Kino' | 'Literatur' | 'Kultur'
```

HTML-Parser benutzen `cheerio`, Knotentypen `AnyNode` aus `domhandler`. Weicht
eine Signatur ab (Typfehler), gezielt in der Datei nachsehen und diese Liste
korrigieren.

## Ablauf

```bash
npm run probe -- <url> <url-anderer-monat> [<detailseite>] 2>&1 | head -150
npm run probe -- --anatomie .probe/<datei> [--auswahl "li.termin"] 2>&1 | head -150
#  Fixtures ablegen, parse.ts + parse.test.ts + index.ts schreiben
node --test --experimental-strip-types src/lib/events/sources/<id>/parse.test.ts
#  Prüfkette (Schritt 7)
```

### 0. Vorab, in einem Befehl

Stadt in `src/lib/cities.ts` vorhanden? Gibt es die Quelle schon
(`ls src/lib/events/sources`)? Fehlt etwas Entscheidendes, das nicht auf der
Seite steht (welche Spielstätten, ob Nebenreihen mit sollen), einmal nachfragen.
Hinweise des Nutzers zum URL-Muster nutzen, aber gegenprüfen.

### 1. Endpunkt finden

Reihenfolge: **JSON-API** (`/api/…`, `/graphql`) → **HTML-Fragment zum Nachladen**
(Staatsoper `/spielplan/{YYYY-MM}/calendar.ajax`) → **ICS** →
**ld+json `@type: Event`** → gerendertes HTML.

Liste, zweiter Monat und eine Detailseite **in einem `probe`-Aufruf**. Zwei
Monate nebeneinander zeigen, ob es einen Zeitraum-Parameter gibt (gleiche Länge
heisst: eine Seite für alles, lokal filtern). Keine Datumsmuster, 403, Token,
JS-gerenderte Seite → `referenzen/endpunkt-finden.md`.

### 2. Struktur lesen

`--anatomie` nennt Terminblock, Felder mit Anteil, Ticketsignale. Stutzig machen:
**100 %** taugt als Anker. **Um 50 %** ist ein Sonderfall oder zwei Bauarten,
beide ansehen. **Blockzahl = Termine × 2/3** heisst Breakpoint-Varianten, eine
wählen und über die ID entdoppeln. Blockzahl gegen die Website prüfen.

Liste und Detailseite **gleichzeitig** auf Tabellenangaben durchsehen: Preis,
Dauer, Einlass, Sprache, Übertitel, Alter, Regie, Pause.

### 3. Fixtures ablegen

`src/lib/events/sources/<id>/__fixtures__/<beschreibung>-<YYYY-MM>.<ext>`, echte
Antworten unverändert (aus `.probe/` kopieren). Mindestens **ein voller** und
**ein leerer Monat**, falls die Quelle Monate kennt. Eine Seite ganz ohne
Terminliste ist ein Layoutbruch, kein leerer Monat — so benennen. Detailseite
als Fixture, wenn sie geparst wird. Nie umdatieren oder nachbessern.

### 4. Felder zuordnen

Vorher **einmal** `referenzen/felder-und-fallen.md` lesen (Ticketlage-Tabelle,
IDs, Zeitzone, bekannte Fallen). Kernregeln:

- Pflicht: Titel, Beginn, Spielstätte, Art, Ticketlage, Link. Nichts erfinden:
  fehlende Angaben bleiben leer bzw. `unknown`. `venue.city` nicht hart setzen.
- `id` = `` `${sourceId}:${stabile ID}` ``. `start` immer über `berlinIso`/`zonedIso`.
- Art **im Wortlaut der Quelle** in `category`. Fallback über
  `definition.defaultCategory`. Vereinheitlicht wird in `categories.ts`.
- Programmtext → `description`. Kurze Angaben → `notes` als
  **„Beschriftung: Wert“** im Wortlaut der Quelle (≤ 120 Zeichen). Nichts
  doppeln, was schon in `start`/`end` steckt.

### 5. Parser + Test zuerst, dann Adapter

```
src/lib/events/sources/<id>/
  parse.ts        # reine Funktion → PageResult, kein Netzwerk
  parse.test.ts   # gegen die Fixtures
  index.ts        # EventSource: Laden, Zeitraum, Fehlerfälle, kein Parsen
```

`parse.test.ts` gleich mit `parse.ts` schreiben und als Schleife benutzen.
Der Test deckt ab: Gesamtzahl (gegen die Website gezählt), ein vollständiger
Termin mit allen Feldern (`deepEqual`), Verteilung der Ticketlagen, eindeutige
IDs, leerer Monat → `empty: true`, leeres/kaputtes HTML → nichts erkannt, ggf.
`description`, `parseDetailDescription` und `notes` im Wortlaut. Ein
fehlschlagender `deepEqual` zeigt genau, was der Parser liefert, ohne
Wegwerf-Skript.

`index.ts`:
- `cityId` aus `cities.ts`, `group` aus der Liste oben, `ttlSeconds: 30 * 60`.
- Monate/Seiten über `settleParts`. Antwort ohne erkennbaren Termin →
  `assertRecognised` wirft. Leerer Monat ist kein Fehler, er wird am **Markup
  oder Signal** erkannt (Leermeldung, leerer Container, Endesignal), nie an der
  Antwortlänge.
- Kennt die Quelle keine Vergangenheit: frühere Monate nicht anfragen, leer liefern.
- `iconUrl` nur, wenn die Favicon-Erkennung nichts findet.

### 6. Registrieren

In `src/lib/events/registry.ts` importieren und in `sources` eintragen. Bei
Subagenten: das macht der Hauptagent für alle Quellen gemeinsam.

### 7. Prüfen — einmal, gefiltert

```bash
npm test 2>&1 | grep -E "^ℹ (pass|fail)|^✖|not ok" | head -30
npx tsc --noEmit 2>&1 | head -20; npx eslint src scripts 2>&1 | tail -15
npm run build 2>&1 | grep -iE "error|failed|compiled" | head -20
npm run check -- <id> 2>&1 | tail -40
npm run categories -- <id> 2>&1 | head -60
```

`check` ruft live mehrere Monate mit kaltem Cache auf und prüft Pflichtfelder,
IDs, Dopplungen und den Zeitraum. Die Zahlen mit der Website vergleichen.
`categories` markiert mit `*`, was der Wortschatz nicht kennt: als Synonym in
`SYNONYMS` oder als neue Art in `CATEGORIES` aufnehmen. Zwei Namen für dieselbe
Sache vermeiden. `npm run dev` nur, wenn die Oberfläche betroffen ist.

### 8. Berichten

Kurz: Endpunkt; wie die Ticketlage erkannt wird; Art-Felder und
`defaultCategory`; neue Arten/Synonyme; welche Tabellenangaben ankommen und
welche fehlen; was der Adapter nicht liefert; Termine je Monat gegen die
Website; woran ein Layoutbruch auffällt.

## Referenzen

- `referenzen/endpunkt-finden.md`: kein Termin im HTML, XHR aufzeichnen, 403,
  Token, Web-Archiv, Seiten ohne Monatsparameter.
- `referenzen/felder-und-fallen.md`: Ticketlage, Felder, Detailseiten, Fallen.
