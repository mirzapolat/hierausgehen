import * as cheerio from 'cheerio';
import type { SourceDefinition } from './types.ts';
import { fetchText } from './http.ts';
import { isFresh, readCache, writeCache } from './cache.ts';

/**
 * Favicon einer Quelle beschaffen.
 *
 * Die Startseite wird nach `<link rel="icon">` durchsucht; erst wenn das nicht
 * greift, kommt der fest hinterlegte Link und danach `/favicon.ico`. Ergebnis
 * und Bilddaten werden gecacht, damit die Sidebar nicht bei jedem Aufruf
 * fremde Server anfasst.
 */

const ICON_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_ICON_BYTES = 256 * 1024;

export interface SourceIcon {
  /** Base64-kodierte Bilddaten. */
  data: string;
  contentType: string;
}

export async function loadSourceIcon(definition: SourceDefinition): Promise<SourceIcon | undefined> {
  const key = `icon_${definition.id}`;
  const cached = await readCache<SourceIcon | null>(key);
  if (isFresh(cached)) return cached!.value ?? undefined;

  try {
    const icon = await fetchIcon(definition);
    await writeCache(key, icon ?? null, ICON_TTL_SECONDS);
    return icon;
  } catch (error) {
    console.warn(`[favicon] ${definition.id}: ${error instanceof Error ? error.message : error}`);
    // Fehlschlag kurz merken, damit ein toter Server nicht dauernd angefragt wird.
    await writeCache(key, cached?.value ?? null, 60 * 60);
    return cached?.value ?? undefined;
  }
}

async function fetchIcon(definition: SourceDefinition): Promise<SourceIcon | undefined> {
  const origin = new URL(definition.homepage).origin;
  const candidates: string[] = [];

  try {
    const html = await fetchText(definition.homepage, { timeoutMs: 8000, retries: 0 });
    candidates.push(...discoverFromHtml(html, definition.homepage));
  } catch {
    // Startseite nicht erreichbar – mit den bekannten Kandidaten weitermachen.
  }

  if (definition.iconUrl) candidates.push(definition.iconUrl);
  candidates.push(`${origin}/favicon.ico`, `${origin}/apple-touch-icon.png`);

  for (const candidate of dedupe(candidates)) {
    const icon = await tryFetchImage(candidate);
    if (icon) return icon;
  }
  return undefined;
}

/** Icon-Links der Startseite, grösste zuerst. */
function discoverFromHtml(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const found: { url: string; size: number }[] = [];

  $('link[rel]').each((_, el) => {
    const rel = ($(el).attr('rel') ?? '').toLowerCase();
    if (!/(^|\s)(icon|shortcut icon|apple-touch-icon)(\s|$)/.test(rel)) return;
    const href = $(el).attr('href');
    if (!href) return;
    const sizes = $(el).attr('sizes') ?? '';
    const size = Number(sizes.match(/(\d+)x\d+/)?.[1] ?? (rel.includes('apple') ? 180 : 32));
    try {
      found.push({ url: new URL(href, baseUrl).toString(), size });
    } catch {
      // Unbrauchbarer href.
    }
  });

  // Mittlere Grössen sind für 16–20 px am saubersten; sehr grosse zuletzt.
  return found
    .sort((a, b) => score(a.size) - score(b.size))
    .map((item) => item.url);
}

function score(size: number): number {
  return Math.abs(size - 64);
}

async function tryFetchImage(url: string): Promise<SourceIcon | undefined> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { Accept: 'image/*' },
    });
    if (!res.ok) return undefined;
    const contentType = res.headers.get('content-type') ?? '';
    if (!/^image\//i.test(contentType)) return undefined;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_ICON_BYTES) return undefined;
    return { data: buffer.toString('base64'), contentType: contentType.split(';')[0] };
  } catch {
    return undefined;
  }
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}
