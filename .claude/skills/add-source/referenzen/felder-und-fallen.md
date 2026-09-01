# Felder zuordnen — die Fallen

Nachschlagewerk zu Schritt 4 der Skill `add-source`. Jede Regel hier stammt aus
einem Fehler, der schon einmal passiert ist.

## Beim Lesen der Liste

- **Meta-Zeilen können mehr als zwei Teile haben.** `16.00 Uhr | Nationaltheater
  | PREMIERE` — die Spielstätte ist der *zweite* Abschnitt, alles danach sind
  Hinweise. Wer „alles nach dem ersten `|`" nimmt, bekommt Spielstätten wie
  „Nationaltheater | PREMIERE".
- **Dieselbe Angabe steht oft in verschiedenen Elementen.** Die Spielstätte ist
  beim Gärtnerplatz mal ein Link auf den Saalplan („Foyer"), mal blosser Text
  („Kempten") — und beim Haupthaus gar nicht da. Ein Selektor auf `a[href…]`
  verliert zwei von drei Fällen lautlos. Lieber den gemeinsamen Container
  greifen und den Text nehmen.
- **`<br>` trennt Inhalte, nicht nur Zeilen.** `Prinzregententheater</br>Großes
  Haus` wird beim reinen Textlesen zu „PrinzregententheaterGroßes Haus". Vor dem
  Parsen `<br>` (auch das ungültige `</br>`) durch einen Zeilenumbruch ersetzen.
- **Nicht jeder Block in der Liste ist ein Termin.** Zwischen den Vorstellungen
  stehen Hinweiskästen (Gärtnerplatz: „Theaterferien", auf *jeder* Seite). Ein
  Block zählt nur, wenn er die stabile Termin-ID trägt.
- **Derselbe Termin kann mehrfach im Markup stehen.** Die Theaterakademie
  rendert jeden Termin dreimal, einmal je Breakpoint (`datarecord--small`,
  `--middle`, `--large`). Eine Variante wählen und über die Termin-ID
  entdoppeln — sonst zählt der Adapter dreifach.
- **Taxonomien aus der Seite lesen statt im Code pflegen.** Gattungen, Orte und
  Merkmale stehen oft nur als `sparte-14`, `ort-57` im Markup — die Namen dazu
  in den Beschriftungen der Filter. Die einmal je Abruf mitzulesen ist besser
  als eine Tabelle im Code, die bei einer neuen Gattung still veraltet.
- **Steht das Jahr nicht am Termin** (das Residenztheater schreibt nur
  „Do. 1 Okt"), nimmt der Parser den angefragten Monat entgegen und wählt das
  Jahr so, dass der Termin ihm am nächsten liegt. Damit stimmt auch ein
  Januartermin auf einer Dezemberseite.
- **HTML-Entities entschlüsseln.** `Show &amp; Revue` darf nicht als Kategorie
  in der API landen. Wer `.text()` benutzt, ist auf der sicheren Seite; wer
  Attribute oder rohe Fragmente liest, muss selbst dekodieren.

## Ticketlage

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

Ein Hinweis „Vorverkauf ab 04.08." neben einem funktionierenden Kaufen-Knopf
heisst nicht `not_on_sale` — der Vorverkauf hat dann längst begonnen und die
Zeile steht nur noch da. Der Knopf gewinnt.

`past` ist **kein** Adapter-Zustand. Vergangene Termine werden unverändert
übernommen; die Anzeige leitet den Zustand über `displayAvailability()` aus der
Zeit ab. Adapter filtern Vergangenes nicht heraus und schreiben es nicht um.

## Titel, Untertitel, Beschreibung, Hinweise

- **Programmtext getrennt halten.** Inhaltsangaben, Kurzinfos und
  Beschreibungstexte gehören in `description`. `notes` ist für Preise,
  Festivals, Premierenhinweise, Abo-Reihen und praktische Zusatzinfos.
- **Preise und Schlagworte trennen** und lesbar machen. Rohtext wie
  `Preise M , € 193 /168 /- /- /- /14` gehört als `Preise M: 193 / 168 / 14 €`
  in `notes`, Platzhalter `-` fallen weg.
- **Versalien wortweise glätten** mit `softenShouted` aus `../../text.ts` —
  nicht nur wenn der ganze Titel schreit: `ILLUSIONEN - WIE SCHWANENSEE
  (Gastspiel in Baden-Baden)` bliebe sonst stehen, weil der Klammerzusatz
  Kleinbuchstaben enthält. `clean` für Leerraum kommt aus derselben Datei.
- **`venue.city` nicht hart setzen.** Häuser führen Gastspiele in anderen
  Städten im selben Spielplan. Lieber weglassen als erfinden.
- **`id` ist** `` `${sourceId}:${stabile ID der Quelle}` `` — bevorzugt die
  numerische Termin-ID aus dem Link oder dem `id`-Attribut, nur notfalls ein
  Slug aus Datum, Zeit und Titel.
- **`start` immer über `berlinIso(datum, stunde, minute)`** aus `../../time.ts`.
  Nie einen Offset von Hand schreiben (Sommerzeit).

## Veranstaltungsart

- **Jeder Termin braucht in der API eine Veranstaltungsart.** Liefert die Quelle
  pro Termin eine Gattung, kommt sie in `event.category`. Liefert sie keine oder
  nur teilweise Gattungen, setze in `definition.defaultCategory` einen ehrlichen
  Quellen-Fallback wie „Theater", „Konzert", „Clubnacht" oder „Oper & Ballett".
  Die Parser dürfen fehlende Einzelwerte leer lassen; die Aggregation ergänzt
  daraus die Kategorie. In der App soll dadurch keine Kategorie-Pille „Ohne
  Angabe" entstehen.
- **Den Wortlaut der Quelle übernehmen, nicht übersetzen.** Der Parser schreibt,
  was auf der Seite steht („Live Music", „Musik", „Kinder & Familie"). Das
  Vereinheitlichen ist nicht seine Aufgabe: `src/lib/events/categories.ts`
  bildet die Formulierung anschliessend auf den gemeinsamen Wortschatz ab
  („Live Music" und „Musik" werden zu „Konzert"), der Originalwortlaut bleibt
  als `event.categoryLabel` erhalten. Ein Parser, der selbst auf „Konzert"
  umschreibt, verschenkt genau diese Genauigkeit.
- **Nach `npm run check` einmal `npm run categories -- <quellen-id>`.** Die
  Ausgabe zeigt jede Formulierung der Quelle mit der Art, die daraus wird, und
  markiert mit `*`, was der Wortschatz noch nicht kennt. Für jede Markierung
  eine Entscheidung treffen — es gibt nur zwei:
  - **Schreibweise einer bestehenden Art** („Livemusik", „Konzerte",
    „Tanzabend") → als Synonym in `SYNONYMS` eintragen. Gross-/Kleinschreibung,
    Bindestriche, Umlaute, „&"/„und" und der Plural sind schon abgedeckt und
    brauchen keinen Eintrag.
  - **Wirklich eine neue Art** (die Quelle macht einen Unterschied, den es im
    Kalender bisher nicht gibt) → in `CATEGORIES` aufnehmen. Neue Arten sind
    erlaubt und kosten nichts an der UI; sie ersetzen nur nichts Bestehendes.
    Zwei Namen für dieselbe Sache sind der Fehler, den es zu vermeiden gilt.
  Wird nichts entschieden, ist das kein Datenverlust: eine unbekannte Art
  bleibt in ihrer Schreibweise stehen. Sie steht dann aber als eigener Filter
  neben einer gleichbedeutenden — genau die Zersplitterung, die der Wortschatz
  auflöst.
- **Nicht zu eng klassifizieren.** Wenn ein Theater auch Führungen, Gespräche
  oder Gastspiele führt, ist „Theater" als `defaultCategory` besser als alles
  pauschal „Schauspiel" zu nennen. Auch `defaultCategory` läuft durch den
  Wortschatz.

## Lange Programmtexte von Detailseiten

Viele Listen liefern nur einen Teaser; die App soll aber den langen Text
durchsuchen und im Detail anzeigen. Der Parser dafür bleibt eine reine Funktion
in `parse.ts` (`parseDetailDescription(html)`), das Laden läuft in `index.ts`
über `enrichEventDescriptions` aus `src/lib/events/sources/detail.ts`.

- Detailseiten nach **Produktion** deduplizieren, nicht nach Vorstellung.
  Enthält die Termin-URL eine Vorstellungs-ID, den Cache-Key auf die
  Produktionsseite normalisieren (`cacheKey`), damit mehrere Abende desselben
  Stücks nur einen Detailabruf kosten.
- **Seiten ohne Text gar nicht erst holen.** Wenn die Liste erkennbar macht,
  welche Termine eine eigene Produktionsseite haben (Theaterakademie: nur die
  eigenen Produktionen sind verlinkt, Gastspielseiten tragen ausser Titel und
  Terminen nichts), diese Auskunft aus dem Parser mitgeben und `fetchUrl` für
  den Rest `undefined` liefern lassen. Das spart hier 113 von 120 Abrufen.
- Detailtexte cachen. Ein fehlgeschlagener Detailabruf darf nie die Quelle als
  kaputt markieren; der Termin bleibt mit Kurztext oder ohne `description`.
- Detailabrufe haben ein eigenes Zeitbudget und begrenzte Parallelität. Normale
  Seitenaufrufe bleiben knapp; ein expliziter Quellen-Reload darf mehr Zeit
  bekommen.
- Der lange Text ersetzt den Kurztext nur, wenn er wirklich informativer ist.
  Keine Navigations-, Footer-, Cast-, Abo- oder Ticketshop-Texte in
  `description` übernehmen.
