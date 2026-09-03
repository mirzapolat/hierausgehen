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
      snapshot.ts          täglicher Datenstand einer Stadt (zwölf Monate)
      schedule.ts          Zeitrechnung der Erhebung (5 Uhr Ortszeit)
      cache.ts             TTL-Cache mit Rückfall auf veraltete Daten
      ics.ts               ein Termin als .ics-Datei (RFC 5545)
      http.ts              Timeout, Retry, Browser-Header
      favicon.ts           Favicon einer Quelle finden und zwischenspeichern
      categories.ts        Veranstaltungsarten: ein Wortschatz für alle Quellen
      text.ts                geteilte Textwerkzeuge (Versalien, Leerraum)
      sources/
        _template.ts       Vorlage für eine neue Quelle
        staatsoper/        erste Quelle, zugleich Vorbild
        gaertnerplatz/     Termine nur über einen nachgeladenen Endpunkt
        residenztheater/   Monatsseite ohne Jahresangabe
  components/              Kalender, Sidebar, Detailspalte, Einstellungen
  instrumentation.ts       startet die tägliche Erhebung beim Serverstart
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
6. `npm run categories -- <quellen-id>` zeigt, welche Veranstaltungsarten die
   Quelle mitbringt und was der gemeinsame Wortschatz daraus macht.

### Veranstaltungsarten

Jede Website benennt ihre Gattungen anders. „Musik", „Live Music" und
„Konzerte" meinen dasselbe; das Deutsche Theater führt Doppelungen wie
„Konzert / Weltmusik"; anderswo steht die Art nur im Plural oder in Versalien.
Ungefiltert waren das über fünfzig Werte für gut ein Dutzend Sachen — als
Filter in der Seitenleiste unbrauchbar.

Der Parser übernimmt trotzdem weiter **den Wortlaut der Quelle**; das
Zusammenführen passiert danach, an einer Stelle:
`events/categories.ts` bildet die Formulierung auf einen Wert aus `CATEGORIES`
ab. Verglichen wird ohne Rücksicht auf Gross-/Kleinschreibung, Bindestriche,
Umlaute, `&`/`und`, HTML-Entities und den Plural; zusammengesetzte Angaben
werden zerlegt, es gewinnt der erste bekannte Teil.

Zwei Dinge bleiben dabei erhalten:

- **Die Breite.** Was der Wortschatz nicht kennt, wird nicht eingeebnet,
  sondern bleibt als eigene Art stehen. Eine neue Quelle kann also eine Art
  mitbringen, die es hier noch nie gab, ohne dass jemand etwas anpasst.
- **Die Genauigkeit.** Der Wortlaut der Quelle steht weiter am Termin
  (`categoryLabel`) und in der CSV-Spalte `veranstaltungsart_quelle`.

`npm run categories` ruft die Quellen live ab und stellt beides gegenüber; mit
`*` markiert ist, was der Wortschatz noch nicht kennt. Das ist die Stelle zum
Hinschauen, wenn eine Quelle dazukommt: Schreibweise einer bestehenden Art
(dann als Synonym eintragen) oder wirklich eine neue Art (dann in `CATEGORIES`
aufnehmen).

Die **Farbe gehört zum Ordner, nicht zur Quelle** (`events/groups.ts`): im
Kalender soll ein Blick genügen, um Oper von Kino zu unterscheiden – welches
Haus es ist, steht daneben. `definition.group` ist deshalb keine freie
Beschriftung, sondern eine Wahl aus den dort angelegten Ordnern.

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

Die Quelle führt **keine Gattung**; entsprechend bleibt `category` am Termin
leer und die Aggregation setzt den Fallback der Quelle ein.

## Staatstheater am Gärtnerplatz

Nicht über die eigene Spielplanseite, sondern über den **Kartenshop des
Staatstheaters** (EVENTIM.Inhouse). Der Grund ist handfest: `gaertnerplatztheater.de`
liegt bei 1blu hinter einer Firewall, die TCP von der Adresse dieses Servers
verwirft. Der Shop liegt auf einem anderen Host und ist erreichbar.

Der Shop gibt nur innerhalb einer Sitzung Auskunft, der Abruf ist deshalb
zweistufig:

```
GET  /gpt.webshop/webticket/shop                     # 302 -> eventlist, setzt JSESSIONID
POST /gpt.webshop/webticket/include/eventlistdelta   # index, genre, date_begin, …
```

`index` ist **keine** Position, sondern die Seitennummer; eine Seite fasst zehn
Termine, die letzte trägt `<li id="listend">`. `date_begin` im Format
`TT.MM.JJJJ` wirkt, `date_end` wird ignoriert – das Ende des Zeitraums schneidet
der Adapter selbst ab. Ohne gültige Sitzung antwortet der Shop mit einer
vollständigen Fehlerseite statt mit dem Fragment; die wird als solche erkannt
und nie als „keine Termine" verbucht.

Je Termin ein `div` mit `id="eventKey:<id>"` – der stabilen Termin-ID – und
darin Titel, Untertitel, Datum, Beginn und Spielstätte, jeweils mit derselben ID
im Attribut. Die Ticketlage kommt aus zwei unabhängigen Signalen:

| Quelle | `availability` |
| --- | --- |
| `<a href="…selectseat…">Karten</a>` | `available` |
| derselbe Link mit „Restkarten" | `limited` |
| `<span id="soldtext:<id>">` mit `<a>` **ohne** `href` | `soldout` |

**Die Gattung steht an keinem Termin.** Sie ergibt sich daraus, mit welchem
Sparten-Filter die Liste geholt wurde – der Adapter läuft die Sparten (Oper,
Musical, Ballett, Konzert, Liederabend, Operette, Soiree, Sonstiges) einzeln ab,
und die Sparten selbst liest er aus dem Filter der Shop-Seite, damit keine
Tabelle im Code veraltet. Die Sparten teilen die Liste vollständig und
überschneidungsfrei auf.

Was der Shop **nicht** kann: er führt nur, was gerade im Verkauf ist – je nach
Vorverkauf zwei bis drei Monate statt der zwölf des Spielplans. Vergangenes gibt
er gar nicht heraus, Endzeiten und lange Programmtexte führt er nicht.

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

## Erhebung: einmal am Tag, zwölf Monate

Die Häuser werden nicht pro Seitenaufruf befragt, sondern **einmal täglich um
5 Uhr Ortszeit der Stadt** – für den laufenden Monat und die elf folgenden.
Daraus entsteht ein Datenstand je Stadt (`events/snapshot.ts`); jeder
Seitenaufruf und jeder API-Aufruf bekommt nur einen Ausschnitt daraus. Egal wie
viele Leute den Kalender öffnen: die Quellen sehen eine Abfrage am Tag.

- **Der Zeitplan** hängt in `src/instrumentation.ts` am Serverstart. Beim
  Hochfahren wird der Stand aufgewärmt (liegt er auf der Platte, kostet das
  nichts), danach läuft ein Timer auf die nächste 5 Uhr. `EVENT_REFRESH_SCHEDULE=0`
  schaltet ihn ab, etwa in der Entwicklung.
- **Eine heute hinzugefügte Quelle wartet nicht bis morgen.** Der Datenstand
  überlebt als Volume ein Deployment – eine gerade erst registrierte Quelle
  steht nicht darin, und der Stand von heute Nacht gilt bis morgen früh. Beim
  Hochfahren vergleicht der Server deshalb die Registry mit dem gespeicherten
  Stand, holt die Unbekannten sofort und setzt sie ein (drei Anläufe über zehn
  Minuten, falls ein Haus genau während des Deployments nicht antwortet). Ein
  Deployment genügt also; niemand muss die Seite aufrufen, damit die neue
  Quelle erscheint. Im Log steht `neu registriert – <id>` und danach
  `<id> erstmals erhoben`. Unabhängig davon holt jeder Seitenaufruf nach, was
  der Stand nicht kennt (`repairSnapshot`) – das bleibt das Netz darunter.
- **Kein Zeitplan gelaufen?** Ist der Stand über 5 Uhr hinaus alt geworden
  (Neustart, schlafender Prozess), wird er trotzdem sofort ausgeliefert und im
  Hintergrund nachgezogen. Ein leerer Kalender wäre die schlechtere Antwort.
- **Die geplante Erhebung darf lange dauern** (3 Minuten je Quelle) – es wartet
  niemand darauf. Nur der seltene Fall „gar kein Stand vorhanden, Besuch schon
  da" arbeitet mit knapperen Fristen.
- **Von Hand auffrischen kann niemand.** Es gibt weder einen Knopf noch Ziehen
  zum Aktualisieren noch ein Neuladen einzelner Quellen: erhoben wird
  ausschliesslich im Tageslauf, jeder Aufruf liest nur den Stand. Damit sehen
  die Häuser garantiert eine Abfrage am Tag, gleich wie oft jemand drückt.
- **Zwölf Monate sind das Ende der Fahnenstange.** Der Kalender lässt sich nicht
  darüber hinaus bewegen: Pfeile werden am Rand inaktiv, der Monatsstreifen
  endet dort, und ein Deeplink auf ein Datum ausserhalb landet am Rand
  (`coverageRange`, `clampDay` in `lib/calendar.ts`).

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
