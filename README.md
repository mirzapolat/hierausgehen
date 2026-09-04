# Hier ausgehen

Ein zentraler Kalender für Veranstaltungen in München und Glasgow. Die App liest die
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
mitgelieferten Fixtures, damit die Oberfläche mit echten Daten läuft. Ein
Neustart ist dafür nicht nötig: der Speicher-Cache gleicht sich mit der Platte
ab und übernimmt, was von aussen geschrieben wurde (siehe `events/cache.ts`).
Nur ein *gelöschtes* `.cache` merkt der laufende Server nicht – dann neu
starten.

## Aufbau

```
src/
  lib/
    cities.ts              Städte (Name, Zeitzone) – Grundlage der Stadtauswahl
    calendar.ts            reine Datumsrechnung auf ISO-Tagen
    map.ts                 reine Rechnung der Karte: Orte und ihre Bündelung
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
      geocode.ts           Ortsnamen zu Koordinaten (OpenStreetMap, mit Cache)
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

Ordner und Veranstaltungsarten sind **Daten, keine Oberflächentexte**: sie
stehen kanonisch auf Deutsch am Termin und in der Registry, danach wird
gefiltert, gruppiert und gespeichert. Übersetzt wird erst beim Anzeigen, über
`translateTerm` in `src/lib/i18n.ts` bzw. `term()` aus den Einstellungen. Der
Schlüssel bleibt der deutsche Wert – die Auswahl in der Seitenleiste überlebt
deshalb einen Sprachwechsel, und Export und `.ics` bleiben stabil. Eine Art,
die eine Quelle mitbringt und die der Wortschatz noch nicht kennt, bleibt im
Wortlaut der Quelle stehen. Der Typ erzwingt, dass jede bekannte Art und jeder
Ordner eine englische Entsprechung hat.

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

## Glasgow Life

Die erste Quelle ausserhalb Münchens und zugleich die erste, die kein Haus ist,
sondern ein Dach über gut zwanzig: Royal Concert Hall und City Halls, Old
Fruitmarket und Barrowland, Tramway, GoMA, Kelvingrove, Glasgow Film Theatre.
Genommen wird der Kanal „Arts, Music and Culture"; Sport, Museen, Bibliotheken
und Stadtteilarbeit laufen unter eigenen Kanälen und bleiben draussen.

```
GET https://www.glasgowlife.org.uk/whats-on
      ?channel=Arts, Music and Culture&start=dd/mm/yyyy&end=dd/mm/yyyy&curPage=n
      &programme=&venue=&age=&cost=&t=&q=
```

Ein serverseitig gerendertes Umbraco-Suchergebnis, zwölf Treffer je Seite. Die
leeren Felder gehören dazu: wer `programme` oder `cost` weglässt, bekommt die
ungefilterte Liste. Der Zeitraum wirkt auch rückwärts – ein Januartermin von
2020 ist noch abrufbar. Wie viele Seiten es sind, sagt
`nav.pagination[data-pages]` auf der ersten; alle müssen geholt werden, weil
der Filter auch zurückgibt, was in den Zeitraum nur hineinragt, und diese
Ausstellungen der Sortierung nach vorne stehen.

Die Datumszeile einer Karte kennt vier Formen, und die Sparsamkeit ist die
Falle: beim Lauf steht Monat und Jahr nur so weit da, wie sie sich ändern.

```
Thursday 3rd Sept 2026 7:00pm            Einzeltermin
Thursday 3rd - Saturday 5th Sept 2026    Lauf, links erbt Monat und Jahr
Friday 5th Jun - Sunday 6th Sept 2026    Lauf, links erbt nur das Jahr
Every week on Friday from 17th Jul 2026 until 19th Dec 2026
```

Läufe tragen nie eine Uhrzeit – die Detailseite sagt dazu „Check venue opening
times". Sie werden zu einem ganztägigen Termin am ersten Tag mit gesetztem
`end`, die Originalzeile bleibt als Notiz stehen; Serien werden in ihre
Einzeltermine ausgerollt.

Preise, Ticketlink und Ticketlage kennt die Liste nicht; sie stehen im Kasten
„Tickets" der Detailseite, die ohnehin für den Programmtext geholt wird. Der
Kaufknopf („Buy tickets now" für den eigenen Shop, „Book now" auch für
Eventbrite) heisst `available`; fehlt er, verkauft die Seite nicht –
`not_on_sale`, mit dem Wortlaut als Beleg („Free - Drop-in - no ticket
required", „book in venue or online", ein Verkauf, der zu einem anderen Haus
umgezogen ist).

**Ausverkauft** meldet der Ticketkasten nicht: der Kaufknopf bleibt stehen. Das
einzige Signal ist eine von Hand vorangestellte Zeile im Programmtext, kursiv
und für sich allein – „- Sold out -". Gewertet wird deshalb nur genau das: eine
eigene kurze Zeile am Anfang. „has consistently sold out concert halls" mitten
im Fliesstext ist eine Biografie, kein Zustand.

### Veranstaltungsart, wo keine steht

Ein Feld für die Gattung gibt es nirgends – nicht in der Liste, nicht auf der
Detailseite, nicht als Filter. Die Facette „Age" wäre eine Zielgruppe, aber
kein Termin dieses Kanals trägt sie, und der Ticketshop steht hinter einer
Bot-Erkennung. Geraten wird trotzdem nichts: genommen wird nur, wo die Seite
die Gattung **selbst ausspricht**, in vier Stufen.

| Stufe | Signal | Beispiel |
| --- | --- | --- |
| 1 | Programmschiene, wo sie ein Klangkörper ist | RSNO, SCO, BBC SSO, Celtic Connections → `Concert` |
| 2 | Titel, wo er die Form nennt | „… in Concert", „Exhibition :", „Shorts Programme", „Bookbug", „Ceilidh", „Còisirean" |
| 3 | „Check venue opening times" im Kasten „Dates and times" | ein Lauf ohne Anfangszeit → `Exhibition` |
| 4 | „Doors: 7pm" im Ankündigungstext | die Einlasszeit schreibt Glasgow Life nur zu Auftritten → `Concert` |

Übernommen wird der englische Wortlaut, `categories.ts` bildet ihn ab. Das
deckt rund die Hälfte ab (Konzert 52, Ausstellung 13, Kino 7, Tanz 3,
Literatur 3, Vortrag 3, Kinder & Familie 3 von 174); der Rest bleibt beim
Quellen-Fallback „Kultur".

Stufe 3 und 4 sind genauer als jede Tabelle von Spielstätten, und sie kosten
nichts: die Detailseite wird ohnehin geholt. Im Tramway liegen Ausstellung und
Gastspiel nebeneinander – dieselbe Zeile „Check venue opening times"
unterscheidet sie, ein Haus kann das nicht. Und „Doors: 7pm" trifft genau den
Block, den weder Schiene noch Titel fassen: Popkonzerte, deren Titel nur der
Künstlername ist (Mogwai, Jake Bugg, Katherine Jenkins).

Bewusst **nicht** benutzt wird die Spielstätte. Sie brächte die Abdeckung auf
86 %, wäre aber eine Tabelle über 21 Häuser, die bei jedem neuen Haus still
veraltet – und sie führt in die Irre: „Jeremy Bowen: Truth Under Fire" ist ein
Vortrag in einem Konzerthaus.

Was die Quelle darüber hinaus **nicht** liefert: keine Endzeiten.

### Die Uhrzeit, die in der Liste fehlt

Der Kasten „Dates and times" nennt für manche Läufe sehr wohl einen Beginn,
den die Trefferkarte weglässt – „Al Seed Productions – Thrice" spielt an
beiden Abenden um 7:30pm. Solche Termine sind dann nicht ganztägig. Die
Korrektur läuft über `EventDetail.startTime` und wirkt nur in eine Richtung:
was die Liste schon wusste, bleibt stehen.

## ATG Tickets Glasgow

King's Theatre und Theatre Royal, beide der Ambassador Theatre Group, teilen
sich einen Spielplan: Tourneemusicals, Schauspiel, Comedy, Scottish Opera und
Scottish Ballet als Gäste, dazu die Weihnachtspantomime und Hausführungen. Ein
drittes Glasgower Haus führt ATG nicht.

Die Quelle antwortet an drei Stellen, und keine kann, was die andere kann.

```
GET  https://www.atgtickets.com/whats-on/glasgow/?page=n     die Stücke
POST https://calendar-service.core.platform.atgtickets.com/  die Vorstellungen
     { operationName: "getShow", variables: { titleSlug, venueSlug, sourceId } }
GET  https://www.atgtickets.com/shows/<stück>/<haus>/        der Programmtext
```

**Die Übersicht** ist eine Next.js-Seite und steht im HTML zweimal da: als
Markup mit generierten MUI-Klassennamen und als die Daten, aus denen das Markup
entstand (`self.__next_f.push([1,"…"])`). Die Stücke aneinandergehängt ergeben
einen Fliesstext, in dem `"cards":[…]` die Trefferliste ist, `"totalPages"` die
Blätterung und `"found"` die Gesamtzahl. Gelesen werden die Daten, nicht das
Markup – die Klassennamen wechseln mit jedem Build, `"cards"` nicht.

Eine Karte ist ein **Stück**, keine Vorstellung: Titel, Gattung, Haus und die
Laufzeit als Text. Einen Parameter für den Zeitraum gibt es nicht, `?page=` ist
laut `robots.txt` ohnehin das einzige erlaubte Argument. Also wird die
Übersicht ganz geholt (fünf Seiten, 101 Stücke) und die Laufzeit entscheidet,
wen der angefragte Monat betrifft – danach bleiben rund zwanzig Stücke übrig,
für die es sich lohnt zu fragen, wann sie spielen.

```
Fri 4 Sep 2026                     ein Abend
Tue 8 Sep - Sat 19 Sep 2026        Lauf, das Jahr steht nur rechts
Sat 21 Nov 2026 - Sun 3 Jan 2027   Lauf über den Jahreswechsel
Until Sat 5 Sep 2026               laufendes Stück, der Beginn war früher
```

**Der Kalenderdienst** ist die einzige Stelle, die zu einem Stück *alle*
Vorstellungen nennt. Die Produktionsseite trägt nur die nächsten neun im HTML –
bei einer Pantomime mit siebzig Terminen verschluckt das einundsechzig. Ein
Stück, das er nicht kennt, antwortet mit 404; das ist eine Lücke, kein Ausfall.
Erst wenn *kein* Stück beantwortet wird, meldet sich die Quelle als kaputt.

| Feld der Antwort | wird zu |
| --- | --- |
| `availabilityStatus: GOOD` / `MEDIUM` | `available` |
| `availabilityStatus: LOW` | `limited`, Wortlaut „Low availability!" |
| `availabilityStatus: SOLDOUT` | `soldout`, Wortlaut „Sold out" |
| `accessibilityType` | Notiz („Audio Described Performance") |
| `price.minPrice` | Notiz („Tickets from £48.00") |

`MEDIUM` ist bewusst kein Restkartenzustand, sondern der normale Fall eines gut
laufenden Abends – als „limited" ausgegeben färbte es zwei Drittel des
Spielplans falsch.

### Die Zeitzone, die zweimal dasteht

`performanceDate` sieht mit seinem `Z` aus wie der übliche Fehler, einen
Wandkalender als UTC zu verkaufen – zumal gleich daneben `timeZone:
"Europe/London"` steht. Es ist aber echtes UTC. Nachgeprüft an einem Lauf über
die Zeitumstellung hinweg: Scottish Operas *Turandot* steht am 22.10. als
`18:15Z` und am 28.10. als `19:15Z`, und beide Abende beginnen um 19:15
Ortszeit. Bestätigt durch `showTimes` der Produktionsseite („Tue and Thu at
20:00" zu einem `19:00Z` im September). Umgerechnet wird deshalb über die
Zeitzone, nie durch Abschneiden des `Z`.

### Sammelkarten

Zwei der 101 Karten führen nicht auf eine Produktionsseite, sondern auf eine
Sammelseite ohne Haus im Pfad (`/shows/scottish-ballet-emergence/`). Erst
`seriesCollection` in deren `window.__PRELOADED_STATE__` nennt die Paare aus
Stück und Haus, die der Kalenderdienst braucht – ohne diesen Umweg fehlte
Scottish Ballet im Kalender.

Dieselbe Vorlage trägt auch den langen Ankündigungstext und die Spieldauer;
geholt wird sie je Produktion einmal, nicht je Abend.

Was die Quelle **nicht** liefert: keine Endzeiten (die Spieldauer steht als
Notiz daneben), keine Vergangenheit – ein Ticketshop führt keine gespielten
Abende, ein Monat vor dem laufenden ist deshalb leer und kostet keinen Abruf.

## Citizens, Tron und Royal Conservatoire

Drei Glasgower Häuser, ein Ticketsystem: alle drei verkaufen über **Spektrix**
und lassen dessen öffentliche „Website Integration"-Schnittstelle offen. Ohne
Anmeldung, ohne Schlüssel – es ist die Auskunft, aus der die Häuser ihre
eigenen Spielplanseiten bauen.

```
GET <shop>/api/v3/events                           alle Produktionen
GET <shop>/api/v3/instances?startFrom=…&startTo=…   die Vorstellungen
```

`<shop>` ist `tickets.citz.co.uk/citizenstheatre`, `sales.tron.co.uk/tron` bzw.
`tickets.rcs.ac.uk/royalconservatoirescotland`. Den Kundennamen des
Conservatoire nennt keine Seite; er stand erst im Skript der Buchungsstrecke
(`/royalconservatoirescotland/website/scripts/integrate.js`).
Die beiden Listen hängen über `instance.event.id` zusammen. Was überall gleich
heisst, liest `sources/spektrix.ts`; die `attribute_…`-Felder daneben
konfiguriert jedes Haus selbst und deutet deshalb der jeweilige Adapter.

Drei Eigenheiten der Schnittstelle, jede eine mögliche Falle:

- **`start` ist Ortszeit ohne Zeichen dafür** („2026-10-01T19:30:00"),
  `startUtc` derselbe Zeitpunkt in UTC. Gerechnet wird aus der Ortszeit über
  die Zeitzone – dann stimmt der Offset auch in der Umstellungsnacht.
- **Der Zeitraumfilter braucht volle Zeitstempel.** `startTo=2026-10-31` meint
  Mitternacht und schneidet den letzten Tag ab; richtig ist
  `startTo=2026-10-31T23:59:59`. Auf `/events` wirkt der Filter gar nicht – er
  wird stillschweigend ignoriert, gefiltert wird über die Vorstellungen.
- **`isOnSale` heisst „der Verkauf läuft", nicht „es gibt noch Karten".**

### Die Ticketlage, die die Schnittstelle nicht kennt

Der ausverkaufte „The Singer" meldet in Spektrix für alle sieben Abende
`isOnSale: true`, während die Website daneben „Sold Out" schreibt. Eine
Sitzplatzauskunft gibt es nicht (`/instances/<id>/availability` antwortet mit
404). Aus der Schnittstelle allein bliebe jeder Termin `unknown` – und ein
ausverkaufter Abend als „buchbar" wäre schlechter als ein ehrliches
Achselzucken.

Citizens und Tron schreiben sie aber in den Spielplan ihrer Produktionsseite.
Der wird deshalb je Produktion einmal geholt – nicht je Abend: bei der
Tron-Pantomime mit ihren 66 Terminen ist das ein Abruf statt 66. Zugeordnet
wird über Tag und Uhrzeit in Ortszeit.

| Citizens: Knopf und Zeile darunter | Tron: Knopf | `availability` |
| --- | --- | --- |
| `Buy Tickets` / `Book Tickets` | `Book Tickets` | `available` |
| `Limited tickets` | `Limited`, `Last Few` | `limited` |
| `Sold Out` ohne `href` | `SOLD OUT` ohne `href` | `soldout` |
| gar kein Knopf | gar kein Knopf | `unknown` |

Ein Abend ganz ohne Knopf ist **nicht** ausverkauft, sondern nicht öffentlich
buchbar – Schulvorstellungen beim Citizens, Pressevorstellungen beim Tron.

Beim Tron wäre die Vorstellungs-ID aus dem Buchungslink (`/book-online/<ID>`)
der exaktere Schlüssel – ausgerechnet die ausverkauften Zeilen tragen aber
keinen Link, und genau die sind der Grund, überhaupt dort nachzusehen. Also Tag
und Uhrzeit, wie beim Citizens.

### Was jedes Haus in seine eigenen Felder schreibt

|  | Citizens | Tron |
| --- | --- | --- |
| Spielplan gegen Kursbetrieb | `attribute_EventType` | `attribute_WebsitePlacement` |
| aufgenommen | `Shows`, `Heritage Tours` | `Theatre` |
| draussen | `Classes` (Young Creatives, 119 Players – wöchentlich übers Schuljahr), Bildungsworkshops | `Participation`, `Hidden` |
| Spielstätte | `attribute_Venue` („Citizens Theatre - Studio Theatre") | `attribute_Location` („Main Auditorium") |
| Gattung | keine | `attribute_TAASubGenre` / `attribute_TAAArtform` |
| Preise | keine | `attribute_Prices` |

Beim Conservatoire braucht es keinen solchen Filter: die 93 Produktionen der
Kasse sind genau die 93 Karten der Spielplanseite.

Hinter Trons `Hidden` steckt der Tischverkauf des Café/Bar: 177 Termine
„Table Reservation", mehr als der ganze übrige Spielplan zusammen. Ohne diesen
Filter wäre das Tron die grösste Quelle im Kalender – und die falscheste.

Citizens' `EventType` ist **keine** Gattung: „Shows" trennt Spielplan von
Kursbetrieb und würde als Kategorie zu „Show" (Revue, Varieté) werden, also
glatt daneben. Nur die Hausführungen benennen sich selbst; alles andere fällt
auf den Quellen-Fallback „Theater". Das Tron führt die Gattung zweistufig, in
der Systematik der schottischen Theaterstatistik – vorangestellt wird die
genauere, weil `categories.ts` aus einer zusammengesetzten Angabe das erste
bekannte Glied nimmt und „Pantomime" mehr sagt als „Christmas Show".

### Die Adresse, die nirgends steht

Welche Seite zu einer Produktion gehört, sagt Spektrix nicht, und aus dem Namen
lässt es sich nicht ableiten: „1984" liegt unter `/whats-on/1984-play/`, „The
Big Comedy Roadshow" unter `/shows/the-big-comedy-roadshow-3/`. Die
Übersichtsseite nennt zu jeder Karte Titel und Link; zugeordnet wird über eine
Vergleichsform des Titels, bei der alles ausser Buchstaben und Ziffern wegfällt
(Spektrix hängt Leerzeichen an, und das Apostroph in „Queer Folks' Tales" ist
einmal gerade und einmal typografisch).

Fällt diese Zuordnung aus, kostet das nur die schönere Adresse: der Termin
selbst hängt allein an Spektrix, und ohne Link bleibt die Übersichtsseite
stehen. Dasselbe gilt für den Spielplan – ohne ihn bleibt die Ticketlage
`unknown`.

### Das Conservatoire: zwei Eigenheiten mehr

**Der Knopf „Tickets" sagt dort nichts über Karten.** Er steht auch an
Terminen, deren Verkauf laut Kasse erst in drei Tagen beginnt – die Seite
rendert ihn unbesehen. Gewertet wird deshalb nur sein Gegenteil, ein totes
`c-btn--disabled` mit „Sold Out", und das gilt dann für den ganzen Lauf: solange
ein einziger Abend zu haben ist, zeigt die Karte den Knopf. Alles Übrige kommt
von der Kasse, die als einzige weiss, wann der Verkauf öffnet.

**Zugeordnet wird über die Buchungsnummer, nicht über den Titel.** Jede Karte
verlinkt auf `/whats-on/<stück>/book/<n>`, und dieses `<n>` ist die
Zifferngruppe, mit der die Vorstellungs-ID beginnt (`652210` ⇒ `652210ABCD…`).
Der Titel taugt hier nicht: die Website führt ihn redaktionell, die Kasse
betrieblich, und bei 26 von 93 Veranstaltungen gehen die beiden auseinander
(„Haver Quartet" gegen „Westbourne Music presents: Haver Quartet"). Nur wo die
Nummer fehlt – Läufe über mehrere Tage verweisen auf ihre eigene Terminliste
statt auf die Kasse – wird der Titel verglichen. Zusammen finden 92 der 93
Produktionen ihre Karte.

Dieselbe Nummer baut auch den Ticketlink jedes einzelnen Abends:
`/whats-on/<stück>/book/<n>/` reicht `<n>` als `InstanceId` an die Kasse durch –
nachgeprüft an einer Vorstellung, die auf der Seite gar keinen Knopf hatte.

Einen **Programmtext** führt die Kasse dort zu keiner einzigen Produktion – das
Feld ist da und bei allen 93 leer. Er steht nur im WordPress und wird deshalb
über `enrichEventDetails` je Produktion einmal nachgeladen. Und eine
**Spielstätte** unterscheidet das Haus nicht: zu jedem Termin steht nur „Royal
Conservatoire of Scotland", kein Saal. Das wird nicht erfunden.

Alle drei Quellen liefern **Endzeiten**: die Spieldauer steht an der Produktion
(`duration` in Minuten, `0` heisst „nicht angegeben"). Und alle drei kennen
**Vergangenheit**: gespielte Abende bleiben rund ein Jahr abrufbar, vergangene
Monate werden deshalb angefragt wie jeder andere.

## Kartenansicht

Neben Tag, Woche und Monat gibt es **Karte** (Taste `K`, ab Bildschirmbreite
`lg`). Das ist eine Tagesansicht mit anderen Mitteln: dieselben gefilterten
Termine wie in „Tag", nur nach Ort sortiert statt nach Uhrzeit. Die Frage
dahinter ist eine andere – nicht „was läuft heute", sondern „was läuft heute in
meiner Nähe". Seitenleiste, Filter und Detailspalte bleiben unverändert.

**Ein Pin ist ein Ort, kein Termin.** Sechs Vorstellungen im Deutschen Theater
sind ein Punkt mit einer Sechs, nicht sechs Punkte übereinander; der Ring darum
zeigt die Ordnerfarben der beteiligten Quellen als Kreissegmente. Und was sich
bei der aktuellen Zoomstufe überdecken würde, wird zusammengefasst: die Häuser
am Max-Joseph-Platz liegen keine 200 Meter auseinander und sind herausgezoomt
ein Punkt, hineingezoomt wieder vier. Gerechnet wird das in Bildpunkten, nicht
in Metern – das ist die Frage, um die es geht (`lib/map.ts`, mit Tests).

Beim Überfahren steht am Zeiger, was hier läuft. Ein Klick auf einen Punkt mit
mehreren Terminen öffnet die Ortskarte, einer mit genau einem Termin führt
direkt in die Detailspalte – eine Liste mit einem Eintrag ist kein Gewinn.
Umgekehrt gilt dasselbe: wer mit den Pfeiltasten durch die Termine geht, sieht
die Karte mitwandern.

Die Kacheln kommen ohne Schlüssel und ohne Registrierung direkt von
OpenStreetMap. Deren Standardstil ist bunter, als es hierher passt – ein Filter
auf der Kachelebene entsättigt ihn und kehrt ihn im dunklen Schema um, während
die Pins ihre Farben behalten. Leaflet und die Kacheln werden erst geladen,
wenn die Ansicht zum ersten Mal geöffnet wird.

### Woher die Koordinaten kommen

Die Quellen nennen nur Namen, und meistens sind es Raumnamen: „Silbersaal",
„Bühne 1", „Foyer", „Saal & Stream". `events/geocode.ts` macht daraus Punkte –
über Nominatim (OpenStreetMap), einmal je Name, danach ein halbes Jahr aus dem
Zwischenspeicher. Gefragt wird während der täglichen Erhebung auf dem Server;
kein Seitenaufruf fasst je einen Kartendienst an.

Ein falscher Pin ist schlimmer als gar keiner, deshalb zählt ein Treffer nur,
wenn drei Dinge stimmen:

- **Der Name passt.** „Bühne 1" findet in München eine „Kleine Bühne" in
  Pasing – acht Kilometer daneben.
- **Die Art passt.** „Nationaltheater" liefert zuerst drei Tramhaltestellen und
  erst danach das Theater; Verkehrswege und Ortsteile zählen nicht.
- **Die Entfernung passt.** Über 50 km vom Stadtzentrum ist es ein anderer Ort
  gleichen Namens – oder ein Gastspiel in einer anderen Stadt, das auf dieser
  Karte nichts zu suchen hat.

Findet sich der Raumname nicht, greift das **Haus der Quelle**: der Silbersaal
liegt im Deutschen Theater. Zwei Sonderregeln sichern das ab. Ein Name, der nur
aus Allerweltswörtern besteht („Saal", „Foyer", „Theatersaal", „Bibliothek"),
zählt nur als eigener Ort, wenn er direkt am Haus liegt – sonst landete das
Literaturhaus beim Kongress-Saal der Zeugen Jehovas und das Deutsche Theater in
Solln. Und hat ein Name weit weg einen guten Treffer („Baden-Baden",
„Ludwigsburg, Forum am Schloßpark"), gibt es *keinen* Rückfall aufs Haus: das
wäre ein erfundener Ort.

Was übrig bleibt, verschwindet nicht, sondern steht unter der Karte als „ohne
Ort" – zuletzt 7 von 2608 Terminen, darunter „Gastspiel" und „per Zoom", die
tatsächlich keinen Ort haben. `npm run venues` zeigt die ganze Tabelle:

```bash
npm run venues                  # alle Quellen, laufender Monat
npm run venues -- staatsoper    # nur eine Quelle
```

Mit `*` markiert ist, was ohne Ort blieb; `Haus` heisst, dass nicht der
Raumname gefunden wurde, sondern das Haus der Quelle. Das ist die Stelle zum
Hinschauen, wenn ein Haus auf der Karte fehlt. Für die Ausnahme, dass
OpenStreetMap einen Ort ganz anders nennt, gibt es `OVERRIDES` in
`geocode.ts` – Handarbeit, und deshalb bewusst die Ausnahme.

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
