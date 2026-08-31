/**
 * Aufklärung für eine neue Quelle.
 *
 *   npm run probe -- https://beispiel.de/spielplan [weitere URLs …]
 *   npm run probe -- --anatomie https://beispiel.de/spielplan
 *   npm run probe -- --anatomie .probe/beispiel_de_spielplan.html --auswahl "li.termin"
 *
 * Holt die Seite mit demselben HTTP-Client, den auch die Adapter benutzen
 * (HTTP/2 mit Browser-Profil – ein einfacher `curl` bekommt bei etlichen
 * Kulturseiten 403), legt sie unter `.probe/` ab und zeigt, woran sich ein
 * Adapter festmachen lässt: nachgeladene Endpunkte, strukturierte Daten,
 * wiederkehrende Container und Hinweise auf Termine.
 *
 * `--anatomie` geht einen Schritt weiter und nimmt die Terminliste
 * auseinander: welcher Block ein Termin ist, wie er ausgeschrieben aussieht,
 * welche Felder in ihm stecken und wie oft. Das ersetzt die Handarbeit, mit
 * der man sich sonst über ein Dutzend Wegwerf-Skripte an dieselben Zahlen
 * herantastet. Bereits geholte Seiten liest es direkt aus `.probe/`.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { fetchText, SourceHttpError } from '../src/lib/events/http.ts';

const args = process.argv.slice(2);
const anatomie = args.includes('--anatomie');
const selector = readOption('--auswahl');
const targets = args.filter((arg) => !arg.startsWith('--') && arg !== selector);

if (targets.length === 0) {
  console.error('Aufruf: npm run probe -- [--anatomie] <url|datei> [--auswahl "li.termin"]');
  process.exit(1);
}

/**
 * Gestaltungsklassen (Tailwind & Co.) sagen nichts über den Inhalt. Sie
 * kommen als Auswahl in Frage, aber erst nach den sprechenden Namen.
 */
const UTILITY =
  /^(flex|grid|hidden|relative|absolute|static|fixed|sticky|block|inline|contents|container|truncate|visible|invisible|overflow|isolate|order|float|clear|table|list|cursor|select|resize|appearance)(-|$)|^(text|bg|border|rounded|shadow|opacity|ring|outline|divide|w|h|min|max|size|p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|items|justify|self|place|content|font|leading|tracking|indent|underline|decoration|uppercase|z|top|bottom|left|right|inset|translate|rotate|scale|transform|transition|duration|ease|delay|animate|filter|blur|backdrop|from|via|to|basis|grow|shrink|aspect|columns|scroll|snap|space|whitespace|break|align|object|pointer|touch|col|row|sr)(-|$)/;

/** Woran ein Block als Termin erkennbar ist. */
const DATE_HINT = /\d{4}-\d{2}-\d{2}|\b\d{1,2}\.\d{1,2}\.|\b\d{1,2}[.:]\d{2}\s*Uhr/;

const OUT = path.join(process.cwd(), '.probe');
await mkdir(OUT, { recursive: true });

for (const target of targets) {
  console.log(`\n${'='.repeat(72)}\n${target}\n${'='.repeat(72)}`);

  const html = await load(target);
  if (html === undefined) continue;

  if (anatomie) {
    anatomy(html, selector, target.startsWith('http') ? new URL(target).host : undefined);
    continue;
  }

  report('Nachgeladene Endpunkte', endpoints(html));
  report('Strukturierte Daten (ld+json)', jsonLd(html));
  report('Wiederkehrende Container', containers(html));
  report('Datums- und Zeitmuster', dates(html));
  report('Hinweise auf Ticketlage', tickets(html));
  console.log('\n  Weiter mit: npm run probe -- --anatomie <dieselbe url|datei>');
}

/* ------------------------------------------------------------------ */

function readOption(name: string): string | undefined {
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1];
  return args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
}

/** URL holen und ablegen – oder eine schon abgelegte Antwort lesen. */
async function load(target: string): Promise<string | undefined> {
  if (!target.startsWith('http')) {
    try {
      const html = await readFile(target, 'utf8');
      console.log(`✓ ${html.length.toLocaleString('de-DE')} Zeichen aus ${target}`);
      return html;
    } catch (error) {
      console.log(`✖ nicht lesbar: ${(error as Error).message}`);
      return undefined;
    }
  }

  try {
    const html = await fetchText(target, { retries: 1 });
    const file = path.join(OUT, `${slug(target)}.html`);
    await writeFile(file, html, 'utf8');
    console.log(
      `✓ ${html.length.toLocaleString('de-DE')} Zeichen → ${path.relative(process.cwd(), file)}`,
    );
    return html;
  } catch (error) {
    const status = error instanceof SourceHttpError ? error.status : undefined;
    console.log(`✖ nicht abrufbar${status ? ` (HTTP ${status})` : ''}: ${(error as Error).message}`);
    console.log('  Bei 403/503 im echten Browser gegenprüfen, siehe Skill "add-source".');
    return undefined;
  }
}

/* ------------------------------------------------------------------ */

function report(title: string, lines: string[], limit = 12) {
  console.log(`\n  ${title}`);
  if (lines.length === 0) {
    console.log('    –');
    return;
  }
  for (const line of lines.slice(0, limit)) console.log(`    ${line}`);
  if (lines.length > limit) console.log(`    … ${lines.length - limit} weitere`);
}

/** Base64-Blöcke stören jede Suche im Quelltext. */
function strip(html: string): string {
  return html.replace(/base64,[A-Za-z0-9+/=]+/g, 'base64,…');
}

function endpoints(html: string): string[] {
  const found = new Set<string>();
  for (const match of strip(html).matchAll(
    /["'`]([^"'`\s]*(?:\/api\/|graphql|\.ajax|\.ics|\.json|format=json)[^"'`\s]*)["'`]/gi,
  )) {
    const value = match[1];
    if (value.length < 4 || value.length > 200) continue;
    if (/\.(png|jpe?g|svg|webp|woff2?)$/i.test(value)) continue;
    found.add(value);
  }
  return [...found].sort();
}

function jsonLd(html: string): string[] {
  const blocks = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)];
  if (blocks.length === 0) return [];

  const types = new Map<string, number>();
  for (const block of blocks) {
    for (const match of block[1].matchAll(/"@type"\s*:\s*"([^"]+)"/g)) {
      types.set(match[1], (types.get(match[1]) ?? 0) + 1);
    }
  }
  return [
    `${blocks.length} Block/Blöcke`,
    ...[...types.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([type, n]) => `@type ${type}: ${n}`),
  ];
}

/**
 * Klassennamen, die oft genug vorkommen, um eine Terminliste zu sein –
 * das ist meistens der Container, an dem der Parser ansetzt.
 */
function containers(html: string): string[] {
  const counts = new Map<string, number>();
  for (const match of strip(html).matchAll(/class="([^"]+)"/g)) {
    for (const name of match[1].split(/\s+/)) {
      if (name.length < 4) continue;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([name, n]) => n >= 3 && n <= 400 && /event|termin|veranstalt|show|perform|item|row|card|list|day|date/i.test(name))
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => `${String(n).padStart(4)}×  .${name}`);
}

function dates(html: string): string[] {
  const patterns: [string, RegExp][] = [
    ['data-date="YYYY-MM-DD"', /data-date="\d{4}-\d{2}-\d{2}"/g],
    ['<time datetime>', /<time[^>]+datetime="[^"]+"/g],
    ['ISO im Text', /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/g],
    ['DD.MM.YYYY', /\b\d{1,2}\.\d{1,2}\.\d{4}\b/g],
    ['Uhrzeit "HH.MM Uhr"', /\b\d{1,2}[.:]\d{2}\s*Uhr\b/g],
  ];
  return patterns
    .map(([label, re]) => [label, (html.match(re) ?? []).length] as const)
    .filter(([, n]) => n > 0)
    .map(([label, n]) => `${String(n).padStart(4)}×  ${label}`);
}

function tickets(html: string): string[] {
  const words = [
    'ausverkauft', 'sold out', 'restkarten', 'letzte tickets', 'letzte karten',
    'wenige', 'karten', 'tickets', 'vorverkauf', 'ticket',
  ];
  const lower = html.toLowerCase();
  return words
    .map((word) => [word, lower.split(word).length - 1] as const)
    .filter(([, n]) => n > 0)
    .map(([word, n]) => `${String(n).padStart(4)}×  "${word}"`);
}

function slug(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '_').slice(0, 80);
}

/* --------------------------- Anatomie ----------------------------- */

/** Eine Auswahl, so wie `$()` sie liefert. */
type Selection = ReturnType<cheerio.CheerioAPI>;

/**
 * Nimmt die Terminliste auseinander: Kandidaten für den Terminblock, zwei
 * ausgeschriebene Beispiele und die Felder darin mit ihrer Häufigkeit.
 */
function anatomy(html: string, chosen?: string, host?: string): void {
  const $ = cheerio.load(html);
  $('script, style, noscript, svg, template').remove();

  const candidates = recordCandidates($);
  report(
    'Terminblock-Kandidaten (Klassentoken, ab 3x, mit Datum oder Uhrzeit)',
    candidates.map(
      (c) =>
        `${String(c.count).padStart(4)}x  ${c.selector.padEnd(34)} ` +
        `Ø ${c.length} Zeichen, ${c.withDate}% mit Datum`,
    ),
  );

  const selector = chosen ?? candidates[0]?.selector;
  if (!selector) {
    console.log('\n  Kein wiederkehrender Block gefunden - die Liste kommt vermutlich erst im');
    console.log('  Browser dazu. Nachgeladene Endpunkte aufzeichnen, siehe Skill "add-source".');
    return;
  }

  const records = $(selector);
  console.log(`\n  Gewählt: ${selector} (${records.length}x) - mit --auswahl überschreibbar`);

  records.slice(0, 2).each((_, node) => {
    console.log(`\n  -- Beispielblock --\n${indent(compact($.html(node)))}`);
  });

  report(`Felder in den ${records.length} Blöcken`, fields($, records, host ?? hostOf($)), 18);
  report('Signale für die Ticketlage', signals($, records));
  console.log('\n  Achtung: identische Blöcke je Breakpoint und Hinweiskästen ohne Termin-ID');
  console.log('  sind hier mitgezählt - die Anzahl gegen die Website prüfen.');
}

interface Candidate {
  selector: string;
  count: number;
  length: number;
  withDate: number;
}

function recordCandidates($: cheerio.CheerioAPI): Candidate[] {
  const byToken = new Map<string, string[]>();

  for (const node of $('[class]').toArray()) {
    const text = $(node).text().replace(/\s+/g, ' ').trim();
    for (const token of ($(node).attr('class') ?? '').split(/\s+/)) {
      // Tailwind-Werte wie w-[260px] taugen nicht als Auswahl.
      if (token.length < 3 || /[[\]()#:/]/.test(token)) continue;
      const key = `${node.tagName}.${token}`;
      const list = byToken.get(key) ?? [];
      list.push(text);
      byToken.set(key, list);
    }
  }

  const seen = new Set<string>();
  return [...byToken.entries()]
    .map(([selector, texts]) => ({
      selector,
      count: texts.length,
      length: Math.round(texts.reduce((sum, text) => sum + text.length, 0) / texts.length),
      withDate: Math.round((texts.filter((text) => DATE_HINT.test(text)).length / texts.length) * 100),
    }))
    .filter((c) => c.count >= 3 && c.count <= 3000 && c.length >= 50 && c.withDate >= 80)
    .sort((a, b) => score(b) - score(a))
    .filter((c) => {
      // Mehrere Klassen auf denselben Elementen nur einmal anbieten.
      const key = `${c.count}|${c.length}|${c.withDate}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
}

function score(candidate: Candidate): number {
  const token = candidate.selector.split('.')[1] ?? '';
  const weight = UTILITY.test(token) ? 0.3 : 1;
  return candidate.count * Math.min(candidate.length, 400) * weight;
}

interface Field {
  count: number;
  sample: string;
}

/** Welche Bausteine stecken in den Blöcken - und in wie vielen? */
function fields($: cheerio.CheerioAPI, records: Selection, host: string): string[] {
  const hits = new Map<string, Field>();
  const total = records.length;

  records.each((_, node) => {
    const record = $(node);
    const own = new Map<string, string>();

    const id = record.attr('id') ?? record.attr('data-id') ?? record.attr('data-event-id');
    if (id) own.set('[id] am Block', id);

    record.find('[class], time, a[href]').each((__, child) => {
      const element = $(child);
      const text = element.text().replace(/\s+/g, ' ').trim();
      const tag = child.tagName;

      if (tag === 'time') {
        const datetime = element.attr('datetime');
        own.set(datetime ? 'time[datetime]' : 'time (Text)', datetime ?? text);
      }

      if (tag === 'a') {
        const href = element.attr('href') ?? '';
        const external = /^https?:\/\//.test(href) && !href.includes(host);
        own.set(external ? 'a[href] extern (Ticket?)' : 'a[href] intern', href);
      }

      if (!text) return;
      for (const token of (element.attr('class') ?? '').split(/\s+/)) {
        if (token.length < 3 || /[[\]()#:/]/.test(token)) continue;
        own.set(`.${token}`, text);
      }
    });

    for (const [key, sample] of own) {
      const entry = hits.get(key) ?? { count: 0, sample: cut(sample, 58) };
      entry.count++;
      hits.set(key, entry);
    }
  });

  // Sprechende Namen zuerst: `.eventSubtitle` sagt mehr als `.flex-col`.
  const weight = ([key, field]: [string, Field]) =>
    field.count * (UTILITY.test(key.replace(/^\./, '')) ? 0.3 : 1);

  return [...hits.entries()]
    .filter(([, field]) => field.count / total >= 0.1)
    .sort((a, b) => weight(b) - weight(a))
    .slice(0, 24)
    .map(
      ([key, field]) =>
        `${String(Math.round((field.count / total) * 100)).padStart(3)}%  ` +
        `${key.padEnd(30)} ${field.sample}`,
    );
}

/**
 * Eigene Domain, um interne von fremden Links (Ticketshop) zu trennen –
 * aus `canonical`/`og:url`, sonst aus dem häufigsten verlinkten Host.
 */
function hostOf($: cheerio.CheerioAPI): string {
  const declared =
    $('link[rel="canonical"]').attr('href') ?? $('meta[property="og:url"]').attr('content') ?? '';
  const host = (value: string) => {
    try {
      return new URL(value).host;
    } catch {
      return '';
    }
  };

  const own = host(declared);
  if (own) return own;

  // Favicon und Stylesheets liegen praktisch immer auf der eigenen Domain.
  for (const node of $('head link[href^="http"]').toArray()) {
    const name = host($(node).attr('href') ?? '');
    if (name) return name;
  }

  const counts = new Map<string, number>();
  $('a[href^="http"]').each((_, node) => {
    const name = host($(node).attr('href') ?? '');
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '\u0000';
}

function signals($: cheerio.CheerioAPI, records: Selection): string[] {
  const words = ['ausverkauft', 'restkarten', 'letzte', 'wenige', 'vorverkauf', 'karten', 'tickets'];
  const total = records.length;
  const texts: string[] = [];
  let withLink = 0;

  records.each((_, node) => {
    texts.push($(node).text().toLowerCase());
    if ($(node).find('a[href^="http"]').length > 0) withLink++;
  });

  const lines = words
    .map((word) => [word, texts.filter((text) => text.includes(word)).length] as const)
    .filter(([, n]) => n > 0)
    .map(([word, n]) => `${String(Math.round((n / total) * 100)).padStart(3)}%  "${word}"`);

  lines.push(
    `${String(Math.round((withLink / total) * 100)).padStart(3)}%  Block mit externem Link`,
  );
  return lines;
}

/** Ein Block, wie ihn ein Mensch lesen kann: ohne Grafik, ohne Leerlauf. */
function compact(markup: string): string {
  return cut(
    markup
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/base64,[A-Za-z0-9+/=]+/g, 'base64,')
      .replace(/\s+/g, ' ')
      .replace(/> </g, '>\n<'),
    2000,
  );
}

function indent(text: string): string {
  return text
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n');
}

function cut(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}
