# Endpunkt finden — die Fälle, die Zeit kosten

Nachschlagewerk zu Schritt 1 der Skill `add-source`. Hier steht, was zu tun
ist, wenn `npm run probe` allein nicht weiterkommt.

## Die Seite hat gar keine Termine im HTML

Findet das Aufklärungsskript keine Datums- oder Ticketmuster, rendert die Seite
ihren Spielplan erst im Browser. Dann aufzeichnen, was sie selbst nachlädt —
das ist der gesuchte Endpunkt:

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
  sondern der Abstand zum *laufenden* Monat. Der Bezugspunkt wandert also —
  der Adapter muss ihn aus der aktuellen Zeit berechnen.
- **Braucht es den Cursor wirklich?** `letzterTermin` sah nach einer Pflicht
  aus; mit `0` liefert dieselbe Seite sogar einen Termin mehr.
- **Geht statt POST auch GET?** Beim Gärtnerplatz ja — das spart einen
  Sonderweg im HTTP-Layer. Beim Deutschen Theater ebenso: die WordPress-Route
  `admin-ajax.php?action=filter_results&nonce=…` antwortet auf GET mit
  demselben Fragment wie auf den Browser-POST.
- **Wie meldet die Quelle das Ende?** Beim Gärtnerplatz mit dem Text
  `ende erreicht.` Ein solches Signal ist Gold wert: damit weiss der Adapter,
  wann er aufhören darf.

## Der Endpunkt verlangt ein Token

Manche Seiten legen ein Nonce in eine Inline-Variable (Deutsches Theater:
`var dtAjax = {"filterNonce":"…"}` auf `/programm/`). Dann holt der Adapter
zuerst die Seite, liest das Token heraus und fragt damit die Liste ab. Fehlt
das Token, ist das ein Layoutbruch und muss werfen — nicht stillschweigend
eine leere Liste liefern.

## Wenn 403 kommt

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

Bleibt es auch im Browser bei 403/503, ist die Quelle tatsächlich gestört:
melden und die Arbeit vertagen.

## Wenn die Seite wirklich nicht erreichbar ist

Das Web-Archiv zeigt oft auch die nachgeladenen Endpunkte:

```bash
curl -sS "https://web.archive.org/cdx/search/cdx?url=beispiel.de/spielplan*&output=json&fl=original,timestamp,length&limit=40&filter=statuscode:200&collapse=urlkey&from=2026" \
  | python3 -m json.tool
# Rohfassung ohne Archiv-Rahmen: Zeitstempel + "id_"
curl -sS -L "https://web.archive.org/web/<timestamp>id_/<url>" -o /tmp/roh
```

Archivstände sind zum **Verstehen der Struktur** gut, nie als Datenquelle. Ein
Adapter, der nur gegen ein altes Archiv geprüft wurde, ist nicht geprüft.

## Eine Seite für die ganze Spielzeit

Nicht jede Quelle kennt Monate. Volkstheater und Theaterakademie rendern den
kompletten Spielplan in einer Seite und filtern im Browser; die Theaterakademie
legt dafür sogar eine zweite, JS-maskierte Kopie der Liste ins HTML (daher
3,5 MB für 236 Termine). Ein Monatsparameter in der URL ändert dort nichts —
einmal gegenprüfen, indem man zwei Monate nebeneinander holt und die Länge
vergleicht. Ist sie gleich, holt der Adapter eine Seite und filtert lokal.

Vergangene Spielzeiten stehen auf solchen Seiten nicht. Monate vor dem
laufenden gar nicht erst anfragen und leer zurückgeben — das ist kein Ausfall.
