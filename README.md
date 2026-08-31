# Hier ausgehen

Ein zentraler Kalender für Veranstaltungen in München. Die App liest die
Spielpläne einzelner Häuser aus, überführt sie in ein gemeinsames Format und
zeigt sie zusammen in Monats-, Wochen- und Tagesansicht — öffentlich, ohne
Konto.

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # Parser gegen gespeicherte Antworten der Quellen
npm run build
```

Ist eine Quelle gerade nicht erreichbar, füllt `npm run seed` den Cache aus den
mitgelieferten Fixtures, damit die Oberfläche mit echten Daten läuft. Der Cache
liegt auch im Arbeitsspeicher des Servers – nach dem Seeden den Dev-Server neu
starten, sonst gilt weiter, was er schon geladen hat.

## Aufbau

```
src/
  lib/
    cities.ts              Städte (Name, Zeitzone) – Grundlage der Stadtauswahl
    calendar.ts            reine Datumsrechnung auf ISO-Tagen
    format.ts              alle sichtbaren Datums- und Zeitformate
    i18n.ts                Wörterbuch Deutsch / Englisch
    settings/context.tsx   Erscheinungsbild, Sprache, Zeitformat, Zeitzone, Stadt
    events/
      types.ts             CalendarEvent, SourceDefinition, EventSource
      registry.ts          Liste aller Quellen  ← hier wird registriert
      aggregate.ts         parallel laden, Fehler je Quelle isolieren
      cache.ts             TTL-Cache mit Rückfall auf veraltete Daten
      http.ts              Timeout, Retry, Browser-Header
      favicon.ts           Favicon einer Quelle finden und zwischenspeichern
      text.ts                geteilte Textwerkzeuge (Versalien, Leerraum)
      sources/
        _template.ts       Vorlage für eine neue Quelle
        staatsoper/        erste Quelle, zugleich Vorbild
        gaertnerplatz/     Termine nur über einen nachgeladenen Endpunkt
        residenztheater/   Monatsseite ohne Jahresangabe
  components/              Kalender, Sidebar, Detailspalte, Einstellungen
  app/
    page.tsx               Serverseitige Erstansicht
    settings/page.tsx      Einstellungen
    impressum/page.tsx     Impressum
    offline/page.tsx       Rückfallseite ohne Verbindung
    manifest.ts            Web-App-Manifest (installierbar)
    robots.ts, sitemap.ts  Angaben für Suchmaschinen
    opengraph-image.tsx    Vorschaubild für geteilte Links
    api/events/            aggregierte Termine
    api/source-icon/[id]/  Favicon einer Quelle
```

Die Trennung ist die eigentliche Idee: **Quelle → normalisiertes Modell → UI.**
Kalender und Oberfläche kennen ausschliesslich `CalendarEvent` und nie das
Format einer fremden Website.

## Eine Quelle hinzufügen

Kurzfassung — ausführlich in `.claude/skills/add-source/SKILL.md`, das Claude
Code beim Hinzufügen einer Quelle automatisch heranzieht:

1. `npm run probe -- <url> [<url mit anderem Monat>]` zeigt Endpunkte,
   strukturierte Daten, wiederkehrende Container sowie Datums- und
   Ticketmuster – und beantwortet nebenbei, ob es einen Zeitraum-Parameter gibt.
   Gesucht wird der Endpunkt, den die Seite selbst nachlädt (JSON,
   HTML-Fragment, ICS oder `application/ld+json`); der ist stabiler als die
   gerenderte Seite.
2. Eine echte Antwort als Fixture ablegen.
3. `parse.ts` als reine Funktion schreiben (kein Netzwerk) und gegen die
   Fixture testen.
4. `index.ts` nach dem Muster von `sources/staatsoper/` bauen.
5. In `registry.ts` eintragen. Sidebar, Filter, Farbe und Favicon ergeben sich
   daraus von selbst.

## Bayerische Staatsoper

Der Spielplan liegt pro Monat unter `/spielplan/{YYYY-MM}`. Abgerufen wird die
Ajax-Variante derselben Seite:

```
GET https://www.staatsoper.de/spielplan/{YYYY-MM}/calendar.ajax
```

Sie enthält denselben vollständigen Monat ohne JavaScript und ohne Paging, aber
nur das Listenfragment – rund ein Fünftel der Übertragung.

**Bot-Erkennung:** Die Seite prüft den TLS-Handshake, nicht den User-Agent.
Node schickt von Haus aus eine andere Cipher-Reihenfolge als Chrome und bekommt
dieselbe URL als 403, die im Browser 200 liefert. `src/lib/events/http.ts` geht
deshalb über HTTP/2 mit Chromes Cipher-, Signatur- und Kurvenreihenfolge. Wer
einen Adapter mit einfachem `fetch` schreibt, läuft hier ins Leere.

**Vergangene Monate** liefert die Quelle bewusst leer („In diesem Zeitraum gibt
es keine Vorstellungen"). Der Parser erkennt diese Meldung und unterscheidet sie
von einem geänderten Layout.
Je Termin liefert es Datum, Uhrzeit, Spielstätte, Titel, Komponist, Gattung,
Preise, den Link zur Veranstaltung, einen `.ics`-Link und den Ticketstatus.

Die Ticketlage wird aus zwei unabhängigen Signalen gelesen — dem Text des
Ticket-Knopfes und seiner CSS-Klasse:

| Quelle | `availability` |
| --- | --- |
| `Tickets` | `available` |
| `Letzte Tickets` | `limited` |
| `ausverkauft` / `button--ticket-soldout` | `soldout` |
| kein Ticket-Knopf | `not_on_sale` |

Für die Anzeige kommt `past` dazu: was eine Quelle zuletzt über Karten gemeldet
hat, gilt für einen bereits gelaufenen Termin nicht mehr. Der Zustand wird beim
Anzeigen aus dem Zeitpunkt berechnet (`displayAvailability`) und nicht in den
Daten gespeichert – ein zwischengespeicherter Termin kann diese Grenze
überschreiten, ohne dass die Quelle erneut abgefragt wird.

## Monatsansicht

Auf grossen Bildschirmen scrollt der Monatskalender durchgehend: am Rand hängt
er weitere Wochen an und schneidet am anderen Ende ab (`MonthScrollView`,
Fenster von höchstens 240 Wochen bei fester Zeilenhöhe). Die Kopfzeile zeigt den
Monat, der oben steht; Pfeile, „Heute" und Deeplinks springen weiterhin gezielt
an eine Stelle. Mobil bleibt es beim festen Monatsraster mit Punkten
(`MonthView`) plus Tagesliste – dort ist Blättern die klarere Geste.

## Residenztheater

Ein Monat je Seitenaufruf, ohne weiteren Endpunkt:

```
GET https://www.residenztheater.de/spielplan?month={YYYY-MM}
```

Aufbau: `div.schedule` › `section.schedule__day` › `article.schedule-act`.
Je Termin gibt es Spielstätte, Beginn und oft auch **Endzeit**
(`Marstall, 19.00–20.45 Uhr`), Titel, Autor, Preise, einen `.ics`-Link – dessen
`activity`-Nummer die stabile ID liefert – und den Ticketstatus.

| Quelle | `availability` |
| --- | --- |
| `<a>Karten</a>` | `available` |
| `<a>Restkarten</a>` | `limited` |
| `<button disabled>Ausverkauft</button>`, `.schedule-act--inactive` | `soldout` |
| „Zur Anmeldung", „Eintritt frei", „Karten ab 01.12.2026" | `not_on_sale` |
| kein Knopf (Gastspiele fremder Häuser) | `unknown` |

Zwei Eigenheiten:

- **Das Jahr steht nirgends am Termin** – nur „Do. 1 Okt". Der Parser bekommt
  den angefragten Monat und wählt das Jahr so, dass der Termin ihm am nächsten
  liegt.
- **Kommende Monate füllen sich erst mit ihrem Vorverkauf.** Bis dahin stehen
  dort nur einzelne angekündigte Premieren. Ein fast leerer Monat ist normal.

Die Quelle führt **keine Gattung**; entsprechend bleibt `category` leer und die
Termine sammeln sich in der Sidebar unter „Ohne Angabe".

## Staatstheater am Gärtnerplatz

Die Spielplanseite enthält selbst keine Termine – sie lädt sie nach:

```
GET /de/spielplan/index.html?ajax=1&offset={N}&letzterTermin=0
```

`offset` ist **kein** Monat, sondern der Abstand in Monaten zum laufenden
Monat: 0 ist der aktuelle, 1 der nächste. Vergangenes gibt die Quelle nicht
heraus; hinter dem letzten geplanten Monat antwortet sie mit `ende erreicht.`
`letzterTermin` ist im Original ein Cursor – mit `0` liefert dieselbe Seite den
vollständigen Monat, mit dem echten Cursor fehlt der erste Termin.

Je Termin ein `div.vorstellung` mit sprechenden Klassen: `vorstellung-<id>`
(die stabile Termin-ID), `date-DDMMYY`, `sparte-<id>` (Gattung) und `ort-<id>`.
Dazu Beginn und **Endzeit**, Titel, Merkmale wie „U30" und der Ticketstatus.

| Quelle | `availability` |
| --- | --- |
| `<a class="ticket">Tickets</a>` | `available` |
| `<a class="ticket">Restkarten</a>` | `limited` |
| `<span>Ausverkauft</span>` | `soldout` |
| `<span>ab 02.10.</span>`, „Schulbestellung" | `not_on_sale` |
| kein Knopf | `unknown` |

Drei Eigenheiten:

- **Nicht jeder Block ist ein Termin.** Der Kasten „Theaterferien" läuft auf
  jeder Seite mit; gezählt wird nur, was eine `vorstellung-<id>` trägt.
- **Die Spielstätte fehlt beim Haupthaus**, steht beim Foyer als Link auf den
  Saalplan und bei Gastspielen als blosser Text („Kempten").
- **Die Gattungsnamen stehen nicht in den Fragmenten**, sondern als
  Beschriftung der Filter auf der Spielplanseite. Sie werden einmal je Abruf
  mitgelesen, damit keine Tabelle im Code veraltet.

## Suchmaschinen und Installation

- **Metadaten** zentral in `src/lib/site.ts` und `app/layout.tsx`: Titelvorlage,
  Beschreibung, Canonical, Open Graph und Twitter-Card. Das Vorschaubild
  erzeugt `opengraph-image.tsx` beim Bauen.
- **Strukturierte Daten** (`components/StructuredData.tsx`): die kommenden
  Termine der Erstansicht als schema.org `Event`, dazu die Seite als `WebSite`.
  Angegeben wird nur, was die Quellen hergeben – fehlt eine Angabe, bleibt das
  Feld weg. Adressen führen die Quellen bislang nicht, deshalb hat `Place` nur
  einen Namen; für Googles Event-Rich-Results wäre eine Adresse nötig.
- **`robots.txt` und `sitemap.xml`** kommen aus `app/robots.ts` und
  `app/sitemap.ts`. Die API ist ausgenommen.
- **Installierbar** über `app/manifest.ts` samt Icons in 192, 512 und einer
  maskierbaren Fassung mit Rand. Der Service Worker (`public/sw.js`) hält sich
  bewusst zurück: er speichert nur das Gerüst und die Offline-Seite,
  **Termine kommen immer aus dem Netz** – ein Kalender aus dem Cache wäre
  schlimmer als keiner. Angemeldet wird er nur im Produktionsbetrieb.

## Verhalten bei Störungen

Leitsatz: **niemand wartet auf eine tote Quelle.**

- **Veraltetes sofort, Auffrischung im Hintergrund.** Ist ein Cache-Eintrag
  abgelaufen, wird er trotzdem umgehend ausgeliefert und die Abfrage läuft
  daneben weiter (`status: revalidating`). Ein Ausfall verzögert damit keinen
  Seitenaufruf – gemessen 0,08 s statt 130 s.
- **Sicherungsschalter.** Nach dem zweiten Fehlversuch in Folge wird die Quelle
  pausiert (1 Minute, verdoppelnd bis 30 Minuten) und gar nicht mehr angefasst.
  Das deckt den einzigen verbleibenden Wartefall ab: kalter Cache *und* tote
  Quelle.
- **Harte Frist je Quelle.** 12 Sekunden, notfalls per
  `EVENT_SOURCE_DEADLINE_MS` anders gesetzt. Sie greift auch dann, wenn ein
  Adapter das Abbruchsignal ignorieren sollte. Darunter liegt das Budget in
  `http.ts`: 8 s Zeitlimit, ein Wiederholversuch.
- **Fehler bleiben lokal.** Jede Quelle wird einzeln geladen; eine kaputte leert
  den Kalender nie. Die Sidebar markiert nur echte Ausfälle (`stale`, `error`),
  nicht die normale Hintergrund-Auffrischung, und nennt den Stand der Daten.
- **Layout geändert?** Antwortet eine Quelle zwar, liefert aber keinen einzigen
  erkennbaren Termin, wirft der Adapter absichtlich – ein stilles „keine
  Veranstaltungen" wäre die schlechtere Antwort. Ausdrückliche Leermeldungen
  (Sommerpause, Vergangenheit) sind davon ausgenommen.
- **Der Cache liegt unter `.cache/`** und übersteht Neustarts; im Container
  liegt er auf einem Volume, damit ein Deployment nicht kalt startet.

Gemessen im Container, Gärtnerplatz auf eine unroutbare Adresse umgebogen:

| Lage | vorher | jetzt |
| --- | --- | --- |
| Kalter Cache, Quelle tot | 129 s / Zeitüberschreitung | 12 s (zweimal), danach 0,02 s |
| Warmer Cache, Quelle stirbt | 31 s | 0,08 s |
| Alles gesund, kalt | – | 0,5 s |
