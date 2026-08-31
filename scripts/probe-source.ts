/**
 * Aufklärung für eine neue Quelle.
 *
 *   npm run probe -- https://beispiel.de/spielplan [weitere URLs …]
 *
 * Holt die Seite mit demselben HTTP-Client, den auch die Adapter benutzen
 * (HTTP/2 mit Browser-Profil – ein einfacher `curl` bekommt bei etlichen
 * Kulturseiten 403), legt sie unter `.probe/` ab und zeigt, woran sich ein
 * Adapter festmachen lässt: nachgeladene Endpunkte, strukturierte Daten,
 * wiederkehrende Container und Hinweise auf Termine.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fetchText, SourceHttpError } from '../src/lib/events/http.ts';

const urls = process.argv.slice(2).filter((arg) => arg.startsWith('http'));
if (urls.length === 0) {
  console.error('Aufruf: npm run probe -- <url> [url …]');
  process.exit(1);
}

const OUT = path.join(process.cwd(), '.probe');
await mkdir(OUT, { recursive: true });

for (const url of urls) {
  console.log(`\n${'='.repeat(72)}\n${url}\n${'='.repeat(72)}`);

  let html: string;
  try {
    html = await fetchText(url, { retries: 1 });
  } catch (error) {
    const status = error instanceof SourceHttpError ? error.status : undefined;
    console.log(`✖ nicht abrufbar${status ? ` (HTTP ${status})` : ''}: ${(error as Error).message}`);
    console.log('  Bei 403/503 im echten Browser gegenprüfen, siehe Skill "add-source".');
    continue;
  }

  const file = path.join(OUT, `${slug(url)}.html`);
  await writeFile(file, html, 'utf8');
  console.log(`✓ ${html.length.toLocaleString('de-DE')} Zeichen → ${path.relative(process.cwd(), file)}`);

  report('Nachgeladene Endpunkte', endpoints(html));
  report('Strukturierte Daten (ld+json)', jsonLd(html));
  report('Wiederkehrende Container', containers(html));
  report('Datums- und Zeitmuster', dates(html));
  report('Hinweise auf Ticketlage', tickets(html));
}

/* ------------------------------------------------------------------ */

function report(title: string, lines: string[]) {
  console.log(`\n  ${title}`);
  if (lines.length === 0) {
    console.log('    –');
    return;
  }
  for (const line of lines.slice(0, 12)) console.log(`    ${line}`);
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
