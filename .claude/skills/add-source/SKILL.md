---
name: add-source
description: Add a new event source (venue, theatre, concert hall, club) to the hierausgehen calendar. Use when the user gives a website URL of a venue's programme/Spielplan and wants its events integrated, or says "add this source", "neue Quelle", "füge X hinzu". Reverse-engineers the site's data endpoint, writes an adapter with a tested parser, and registers it.
---

# Neue Veranstaltungsquelle hinzufügen

Ziel: aus einer Veranstalter-Website einen Adapter machen, der `CalendarEvent[]`
liefert. Kalender, Datenmodell und UI werden dabei **nicht** angefasst — nur ein
neuer Ordner unter `sources/` plus eine Zeile in der Registry.

Muss dafür am Datenmodell oder an der UI etwas geändert werden, ist das ein
Befund über den Entwurf: ansprechen, nicht still umbauen.

## 0. Was der Nutzer mitgibt

Meistens kommt ein Link, manchmal ein Hinweis auf das Muster („die Monate hängen
hinten dran"). Solche Hinweise sind wertvoll und sparen die halbe Suche —
trotzdem immer selbst gegenprüfen, statt sie zu übernehmen.

Fehlt etwas Entscheidendes, das sich nicht aus der Seite ablesen lässt (welche
Spielstätten dazugehören, ob Nebenreihen mit sollen), einmal nachfragen. Alles
andere selbst herausfinden.

## 1. Endpunkt finden — der wichtigste Schritt

Nicht die gerenderte Seite parsen, solange es etwas Besseres gibt:

1. **JSON-API** — `/api/…`, `/graphql`, `?format=json`.
2. **HTML-Fragment zum Nachladen** — bei der Staatsoper
   `/spielplan/{YYYY-MM}/calendar.ajax`. Enthält oft den ganzen Monat ohne
   JavaScript und ohne Paging, bei einem Fünftel der Übertragung.
3. **ICS-Feed** — `/calendar.ics`, `/termine.ics`. Selten, aber am stabilsten.
4. **`<script type="application/ld+json">`** mit `@type: Event` — sehr gut
   normalisierbar.
5. **Gerendertes HTML** — letzte Wahl.

Startpunkt ist immer das Aufklärungsskript. Es benutzt denselben HTTP-Client wie
die Adapter, legt die Antwort unter `.probe/` ab und zeigt Endpunkte,
strukturierte Daten, wiederkehrende Container, Datums- und Ticketmuster:

```bash
npm run probe -- "https://beispiel.de/spielplan" "https://beispiel.de/spielplan/2026-11"
```

Zwei URLs mit verschiedenen Monaten nebeneinander zu holen, beantwortet sofort
die wichtigste Frage: **gibt es einen Parameter für den Zeitraum?** Ohne den muss
der Adapter blättern, was fast immer schlechter ist.

### Wenn die Seite gar keine Termine im HTML hat

Findet das Skript keine Datums- oder Ticketmuster, rendert die Seite ihren
Spielplan erst im Browser. Dann aufzeichnen, was sie selbst nachlädt – das ist
der gesuchte Endpunkt:

```bash
node -e "import('playwright').then(async ({chromium})=>{
const b=await chromium.launch(); const p=await (await b.newContext()).newPage();
p.on('request',r=>{ if(['xhr','fetch'].includes(r.resourceType()))
  console.log(r.method(), r.url(), r.postData()?.slice(0,200)??''); });
await p.goto('https://beispiel.de/spielplan',{waitUntil:'networkidle'});
await p.waitForTimeout(3000); await b.close();})"
```

So kam der Gärtnerplatz-Endpunkt heraus:
`/de/spielplan/index.html?ajax=1&offset=N&letzterTermin=<unix>`.

Dann die Parameter einzeln durchprobieren, statt sie zu übernehmen:

- **Ist der Zeitraum absolut oder relativ?** Dort ist `offset` kein Monat,
  sondern der Abstand zum *laufenden* Monat. Der Bezugspunkt wandert also –
  der Adapter muss ihn aus der aktuellen Zeit berechnen.
- **Braucht es den Cursor wirklich?** `letzterTermin` sah nach einer Pflicht
  aus; mit `0` liefert dieselbe Seite sogar einen Termin mehr.
- **Geht statt POST auch GET?** Beim Gärtnerplatz ja – das spart einen
  Sonderweg im HTTP-Layer.
- **Wie meldet die Quelle das Ende?** Dort mit dem Text `ende erreicht.` Ein
  solches Signal ist Gold wert: damit weiss der Adapter, wann er aufhören darf.

### Wenn 403 kommt

Etliche Kulturseiten stehen hinter einer Bot-Erkennung, die am **TLS-Handshake**
ansetzt, nicht am User-Agent. `curl` und ein nacktes `fetch` bekommen 403, wo
derselbe Link im Browser 200 liefert. Das sieht aus wie ein Ausfall, ist keiner —
diese Verwechslung hat hier schon einmal Stunden gekostet.

Vor jeder Aussage „die Seite ist down" gegenprüfen:

```bash
node -e "import('playwright').then(async ({chromium})=>{const b=await chromium.launch();
const p=await b.newPage();const r=await p.goto('https://beispiel.de/spielplan');
console.log(r.status(), (await p.content()).length); await b.close();})"
```

Antwortet der Browser mit 200, ist die Seite öffentlich erreichbar und
`fetchText` aus `src/lib/events/http.ts` kommt durch (HTTP/2 mit Chromes
Cipher-Reihenfolge). **Adapter benutzen nie direkt `fetch`.**

Bleibt es auch im Browser bei 403/503, ist die Quelle tatsächlich gestört: melden
und die Arbeit vertagen.

### Wenn die Seite wirklich nicht erreichbar ist

Das Web-Archiv zeigt oft auch die nachgeladenen Endpunkte:

```bash
curl -sS "https://web.archive.org/cdx/search/cdx?url=beispiel.de/spielplan*&output=json&fl=original,timestamp,length&limit=40&filter=statuscode:200&collapse=urlkey&from=2026" \
  | python3 -m json.tool
# Rohfassung ohne Archiv-Rahmen: Zeitstempel + "id_"
curl -sS -L "https://web.archive.org/web/<timestamp>id_/<url>" -o /tmp/roh
```

Archivstände sind zum **Verstehen der Struktur** gut, nie als Datenquelle. Ein
Adapter, der nur gegen ein altes Archiv geprüft wurde, ist nicht geprüft.

## 2. Fixtures ablegen

Echte Antworten unverändert speichern:

```
src/lib/events/sources/<quelle>/__fixtures__/<beschreibung>-<YYYY-MM>.html
```

Mindestens zwei: **ein voller Monat** und **ein leerer** (Sommerpause oder
Vergangenheit). Der leere Fall ist der, der später Fehlalarme auslöst.

Nie umdatieren, nie von Hand nachbessern.

## 3. Felder zuordnen

Pflicht: Titel, Beginn, Spielstätte, Ticketlage, Link zur Veranstaltung.

| Befund auf der Seite | `availability` |
| --- | --- |
| normaler Kaufen-Knopf | `available` |
| „Letzte Karten", „Restkarten", „wenige Plätze" | `limited` |
| „ausverkauft", deaktivierter Knopf | `soldout` |
| „Vorverkauf ab …", kein Verkauf über die Seite | `not_on_sale` |
| gar keine Angabe | `unknown` |

**Zwei unabhängige Signale** nutzen, wo es geht — Knopftext *und* CSS-Klasse,
JSON-Feld *und* Knopf. Bei der Staatsoper ist „ausverkauft" ein `<span>` statt
`<a>`: wer nur auf `a` selektiert, verliert genau diesen Zustand lautlos.

`past` ist **kein** Adapter-Zustand. Vergangene Termine werden unverändert
übernommen; die Anzeige leitet den Zustand über `displayAvailability()` aus der
Zeit ab. Adapter filtern Vergangenes nicht heraus und schreiben es nicht um.

Weitere Regeln:

- `id` ist `` `${sourceId}:${stabile ID der Quelle}` `` — bevorzugt die
  numerische Termin-ID aus dem Link, nur notfalls ein Slug aus Datum, Zeit, Titel.
- `start` immer über `berlinIso(datum, stunde, minute)` aus `../../time.ts`.
  Nie einen Offset von Hand schreiben (Sommerzeit).
- **Meta-Zeilen können mehr als zwei Teile haben.** `16.00 Uhr | Nationaltheater
  | PREMIERE` — die Spielstätte ist der *zweite* Abschnitt, alles danach sind
  Hinweise. Wer „alles nach dem ersten `|`" nimmt, bekommt Spielstätten wie
  „Nationaltheater | PREMIERE".
- **Dieselbe Angabe steht oft in verschiedenen Elementen.** Die Spielstätte ist
  beim Gärtnerplatz mal ein Link auf den Saalplan („Foyer"), mal blosser Text
  („Kempten") – und beim Haupthaus gar nicht da. Ein Selektor auf `a[href…]`
  verliert zwei von drei Fällen lautlos. Lieber den gemeinsamen Container
  greifen und den Text nehmen.
- **Nicht jeder Block in der Liste ist ein Termin.** Zwischen den Vorstellungen
  stehen Hinweiskästen (dort: „Theaterferien", auf *jeder* Seite). Ein Block
  zählt nur, wenn er die stabile Termin-ID trägt.
- **Taxonomien aus der Seite lesen statt im Code pflegen.** Gattungen, Orte und
  Merkmale stehen oft nur als `sparte-14`, `ort-57` im Markup – die Namen dazu
  in den Beschriftungen der Filter. Die einmal je Abruf mitzulesen ist besser
  als eine Tabelle im Code, die bei einer neuen Gattung still veraltet. Fehlt
  ein Eintrag, bleibt das Feld leer.
- **`venue.city` nicht hart setzen.** Häuser führen Gastspiele in anderen Städten
  im selben Spielplan. Lieber weglassen als erfinden.
- **Versalien wortweise glätten** mit `softenShouted` aus `../../text.ts` –
  nicht nur wenn der ganze Titel schreit: `ILLUSIONEN - WIE SCHWANENSEE
  (Gastspiel in Baden-Baden)` bliebe sonst stehen, weil der Klammerzusatz
  Kleinbuchstaben enthält. `clean` für Leerraum kommt aus derselben Datei.
- **Steht das Jahr nicht am Termin** (das Residenztheater schreibt nur
  „Do. 1 Okt"), nimmt der Parser den angefragten Monat entgegen und wählt das
  Jahr so, dass der Termin ihm am nächsten liegt. Damit stimmt auch ein
  Januartermin auf einer Dezemberseite.
- **Führt die Quelle keine Gattung, keine erfinden.** `category` bleibt leer und
  die Oberfläche zeigt „Ohne Angabe" – das ist richtiger als alles pauschal
  „Schauspiel" zu nennen, wenn auch Führungen und Gespräche darunter fallen.
- **Preise und Schlagworte trennen** und lesbar machen. Rohtext wie
  `Preise M , € 193 /168 /- /- /- /14` gehört als `Preise M: 193 / 168 / 14 €`
  in `notes`, Platzhalter `-` fallen weg.
- Nichts erfinden: fehlt eine Angabe, bleibt das Feld leer bzw. `unknown`.

## 4. Adapter schreiben

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
- `definition.color` gedeckt und von den vorhandenen Quellen unterscheidbar.
- `definition.group` ist der Ordner in der Sidebar — vorhandene Gruppen
  wiederverwenden („Oper & Ballett", „Theater", „Konzert", „Club"), nicht je
  Haus eine neue anlegen.
- `iconUrl` nur setzen, wenn die Favicon-Erkennung über die Startseite nichts
  findet; die Erkennung hat Vorrang, damit ein Icon-Wechsel sich selbst heilt.
- `ttlSeconds` so wählen, dass die Quelle höchstens ein paar Mal pro Stunde
  angefasst wird (30 Minuten sind der übliche Wert).
- Mehrere Monate mit `Promise.allSettled`: einzelne Lücken hinnehmen und
  protokollieren, Totalausfall werfen.
- Antwort ohne erkennbaren Termin **muss werfen** (`Layout geändert?`). Die
  Aggregation liefert dann den Cache aus und meldet die Quelle als veraltet —
  ein stilles „keine Termine" wäre die schlechtere Antwort.
- **Ausnahme:** ein leerer Monat ist kein Fehler. Drei Bauarten sind uns
  begegnet: eine ausdrückliche Leermeldung im Markup (Staatsoper
  `.activity-list__col--empty`), ein vorhandener, aber leerer Container
  (Residenztheater `div.schedule`) und eine schlicht leere Antwort plus ein
  Endesignal (Gärtnerplatz: leerer Body bzw. `ende erreicht.`). Immer am
  **Markup oder am Signal** festmachen, nie an der Antwortlänge. Sommerpause,
  noch nicht begonnener Vorverkauf und vergangene Monate sehen genau so aus.
- **Kennt die Quelle keine Vergangenheit**, Monate vor dem laufenden gar nicht
  erst anfragen und leer zurückgeben – das ist kein Ausfall.

## 5. Registrieren

In `src/lib/events/registry.ts` importieren und in `sources` eintragen. Mehr
ist nicht nötig — Sidebar, Ordner, Filter, Farbe und Favicon ergeben sich daraus.

## 6. Prüfen — gegen die echte Quelle, über mehrere Monate

```bash
npm test && npx tsc --noEmit && npx eslint src scripts && npm run build
```

Der Parser-Test deckt mindestens ab: Gesamtzahl der Termine, ein vollständig
normalisierter Termin mit allen Feldern, die Verteilung der
Verfügbarkeitszustände, Eindeutigkeit der IDs, den ausdrücklich leeren Monat
sowie leeres und kaputtes HTML.

Dann live, und zwar **mit leerem Cache und über mehrere Monate**:

```bash
find .cache -type f -name "*.json" -delete   # sonst gilt weiter, was schon da ist
npm run dev &
for r in 2026-09-01:2026-09-30 2026-10-01:2026-10-31 2026-12-01:2027-01-31 2026-07-01:2026-08-31; do
  curl -sS "http://localhost:3000/api/events?from=${r%%:*}&to=${r##*:}" | python3 -c "
import json,sys,collections
d=json.load(sys.stdin)
for s in d['sources']:
    ev=[e for e in d['events'] if e['sourceId']==s['sourceId']]
    print(s['sourceId'], s['status'], len(ev), dict(collections.Counter(e['availability'] for e in ev)))"
done
```

Warum mehrere Monate: ein Adapter, der nur einen Monat kann, fällt sonst nicht
auf. Genau das ist hier schon passiert. Einen **vergangenen** Monat und einen in
der **Spielzeitpause** immer mitprüfen.

Die Zahlen mit der Website vergleichen, nicht nur „es kommt etwas". Dann ein
Ereignis vollständig ansehen: stimmen Uhrzeit, Spielstätte, Ticketlink?

Zwei Fallen beim Prüfen:

- Der Cache liegt auch im Arbeitsspeicher des Servers. Nach `npm run seed` oder
  dem Löschen von `.cache` **den Dev-Server neu starten**.
- `npm run seed` legt Fixture-Daten in den Cache. Danach wieder entfernen, sonst
  zeigt die App Termine, die es an der Quelle nicht mehr gibt.

## 7. Berichten

Kurz und konkret: welcher Endpunkt, wie die Ticketlage erkannt wird, was der
Adapter **nicht** liefert (z. B. keine Endzeiten), wie viele Termine je Monat im
Vergleich zur Website, und woran auffällt, dass die Quelle sich geändert hat.

## Grenzen

- Nur öffentlich zugängliche Seiten. Keine Logins, keine Paywalls, keine
  Captchas, kein Umgehen von Sperren oder Ratenbegrenzungen.
- Dass `fetchText` sich wie ein Browser verhält, ist kein Umgehen eines
  Zugangsschutzes: abgerufen wird genau die Seite, die jeder Browser ohne
  Anmeldung bekommt. Was bleibt, ist Zurückhaltung — grosszügige TTL, keine
  parallelen Massenabrufe.
- `robots.txt` der Quelle ansehen und gesperrte Pfade respektieren.
