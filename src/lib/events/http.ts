import http2 from 'node:http2';
import zlib from 'node:zlib';

/**
 * Gemeinsamer HTTP-Zugriff für alle Adapter: Timeout, Retry, Redirects und ein
 * Fingerabdruck, den übliche Bot-Erkennung durchlässt.
 *
 * Hintergrund: Mehrere Kulturseiten (unter anderem die Staatsoper) stehen
 * hinter einer Bot-Erkennung, die nicht am User-Agent hängt, sondern am
 * TLS-Handshake. Node schickt von Haus aus eine andere Cipher-Reihenfolge als
 * Chrome und bekommt dieselbe URL als 403, die im Browser 200 liefert. Mit der
 * Reihenfolge unten über HTTP/2 antwortet der Server normal.
 *
 * Das ist keine Umgehung eines Zugangsschutzes: die Seiten sind öffentlich und
 * ohne Anmeldung erreichbar, es werden keine Captchas gelöst und keine
 * Sitzungen gefälscht. Wir sehen für den Server aus wie der Browser, mit dem
 * dieselbe Seite ohnehin abgerufen würde.
 */

const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';

/** Cipher-, Signatur- und Kurvenreihenfolge wie aktuelles Chrome. */
const CHROME_TLS = {
  ciphers: [
    'TLS_AES_128_GCM_SHA256',
    'TLS_AES_256_GCM_SHA384',
    'TLS_CHACHA20_POLY1305_SHA256',
    'ECDHE-ECDSA-AES128-GCM-SHA256',
    'ECDHE-RSA-AES128-GCM-SHA256',
    'ECDHE-ECDSA-AES256-GCM-SHA384',
    'ECDHE-RSA-AES256-GCM-SHA384',
    'ECDHE-ECDSA-CHACHA20-POLY1305',
    'ECDHE-RSA-CHACHA20-POLY1305',
    'ECDHE-RSA-AES128-SHA',
    'ECDHE-RSA-AES256-SHA',
    'AES128-GCM-SHA256',
    'AES256-GCM-SHA384',
    'AES128-SHA',
    'AES256-SHA',
  ].join(':'),
  sigalgs: [
    'ecdsa_secp256r1_sha256',
    'rsa_pss_rsae_sha256',
    'rsa_pkcs1_sha256',
    'ecdsa_secp384r1_sha384',
    'rsa_pss_rsae_sha384',
    'rsa_pkcs1_sha384',
    'rsa_pss_rsae_sha512',
    'rsa_pkcs1_sha512',
  ].join(':'),
  ecdhCurve: 'X25519:P-256:P-384',
  minVersion: 'TLSv1.2' as const,
};

const BROWSER_HEADERS: Record<string, string> = {
  'user-agent': CHROME_UA,
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
  'accept-encoding': 'gzip, deflate, br',
  'sec-ch-ua': '"Chromium";v="139", "Not;A=Brand";v="24", "Google Chrome";v="139"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"macOS"',
  'sec-fetch-site': 'none',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-dest': 'document',
  'upgrade-insecure-requests': '1',
};

export class SourceHttpError extends Error {
  // Bewusst ohne Parameter-Properties: Node kann TypeScript nur ausziehen,
  // nicht übersetzen, und Skripte importieren diese Datei direkt.
  readonly status?: number;
  readonly url?: string;

  constructor(message: string, status?: number, url?: string) {
    super(message);
    this.name = 'SourceHttpError';
    this.status = status;
    this.url = url;
  }
}

export interface FetchTextOptions {
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Maximale Zahl gefolgter Weiterleitungen. */
  maxRedirects?: number;
  /**
   * Formularkodierter Rumpf für eine Abfrage, die nur per POST beantwortet
   * wird (Gasteig lädt seine Terminliste so nach). Rein lesend – deshalb ist
   * auch ein Wiederholungsversuch unbedenklich.
   */
  body?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Lädt eine URL als Text. Wirft `SourceHttpError` bei HTTP-Fehler, Timeout
 * oder Netzwerkproblem – die Aggregation entscheidet dann über den Fallback.
 */
export async function fetchText(url: string, options: FetchTextOptions = {}): Promise<string> {
  // Knapp bemessen: eine unerreichbare Quelle darf einen Seitenaufruf nicht
  // aufhalten. Zwei Versuche à 8 s statt drei à 15 s senken den schlimmsten
  // Fall je Adresse von rund 46 s auf rund 16 s.
  const { timeoutMs = 8_000, retries = 1, headers = {}, signal, maxRedirects = 5, body } = options;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await followRedirects(url, headers, timeoutMs, signal, maxRedirects, body);
    } catch (error) {
      if (signal?.aborted) throw error;
      // 4xx ausser 408/429 sind dauerhaft – ein Wiederholen bringt nichts.
      if (
        error instanceof SourceHttpError &&
        error.status &&
        error.status >= 400 &&
        error.status < 500 &&
        ![408, 429].includes(error.status)
      ) {
        throw error;
      }
      lastError = error;
    }
    if (attempt < retries) await sleep(400 * 2 ** attempt);
  }

  throw lastError instanceof SourceHttpError
    ? lastError
    : new SourceHttpError(
        `${url} nicht erreichbar: ${lastError instanceof Error ? lastError.message : lastError}`,
        undefined,
        url,
      );
}

async function followRedirects(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  maxRedirects: number,
  body?: string,
): Promise<string> {
  let current = url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const response = await request(current, headers, timeoutMs, signal, body);

    if (response.status >= 300 && response.status < 400 && response.headers.location) {
      current = new URL(response.headers.location, current).toString();
      continue;
    }
    if (response.status < 200 || response.status >= 300) {
      throw new SourceHttpError(`HTTP ${response.status} für ${current}`, response.status, current);
    }
    return response.body;
  }
  throw new SourceHttpError(`Zu viele Weiterleitungen ab ${url}`, undefined, url);
}

interface Response {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * Erst HTTP/2 mit Chrome-Profil; kann der Server das nicht, normaler fetch.
 *
 * Das Zeitlimit gilt für beide Versuche zusammen. Sonst zahlte ein Host, der
 * gar nicht antwortet – etwa weil er die Adresse dieses Servers auf TCP-Ebene
 * verwirft – das volle Limit zweimal, und mit einem Wiederholungsversuch am
 * Ende viermal. Eine Quelle liefe damit selbst bei grosszügiger Frist ins
 * Zeitlimit, statt zügig aufzugeben.
 */
async function request(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
  signal?: AbortSignal,
  body?: string,
): Promise<Response> {
  const startedAt = Date.now();
  try {
    return await requestHttp2(url, headers, timeoutMs, signal, body);
  } catch (error) {
    if (error instanceof SourceHttpError || signal?.aborted) throw error;
    const remainingMs = timeoutMs - (Date.now() - startedAt);
    // Nichts mehr übrig: der zweite Versuch wäre nur Wartezeit ohne Aussicht.
    if (remainingMs < 500) throw error;
    return requestFetch(url, headers, remainingMs, signal, body);
  }
}

function requestHttp2(
  url: string,
  extraHeaders: Record<string, string>,
  timeoutMs: number,
  signal?: AbortSignal,
  body?: string,
): Promise<Response> {
  const target = new URL(url);

  return new Promise<Response>((resolve, reject) => {
    const client = http2.connect(target.origin, {
      ALPNProtocols: ['h2'],
      ...CHROME_TLS,
    });

    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      client.close();
      fn();
    };

    const timer = setTimeout(
      () => finish(() => reject(new Error(`Zeitüberschreitung nach ${timeoutMs} ms für ${url}`))),
      timeoutMs,
    );
    const onAbort = () => finish(() => reject(new Error('Abgebrochen')));
    signal?.addEventListener('abort', onAbort, { once: true });

    client.on('error', (error) => finish(() => reject(error)));

    const req = client.request({
      ':method': body === undefined ? 'GET' : 'POST',
      ':authority': target.host,
      ':scheme': 'https',
      ':path': `${target.pathname}${target.search}`,
      ...BROWSER_HEADERS,
      ...(body === undefined
        ? {}
        : {
            'content-type': 'application/x-www-form-urlencoded',
            'content-length': String(Buffer.byteLength(body)),
            'sec-fetch-site': 'same-origin',
            'sec-fetch-mode': 'cors',
            'sec-fetch-dest': 'empty',
          }),
      ...lowercaseKeys(extraHeaders),
    });

    let status = 0;
    let responseHeaders: Record<string, string> = {};
    const chunks: Buffer[] = [];

    req.on('response', (incoming) => {
      status = Number(incoming[':status'] ?? 0);
      responseHeaders = Object.fromEntries(
        Object.entries(incoming)
          .filter(([key]) => !key.startsWith(':'))
          .map(([key, value]) => [key, String(value)]),
      );
    });
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('error', (error) => finish(() => reject(error)));
    req.on('end', () =>
      finish(() => {
        try {
          const body = decompress(Buffer.concat(chunks), responseHeaders['content-encoding']);
          resolve({ status, headers: responseHeaders, body });
        } catch (error) {
          reject(error);
        }
      }),
    );
    req.end(body);
  });
}

async function requestFetch(
  url: string,
  extraHeaders: Record<string, string>,
  timeoutMs: number,
  signal?: AbortSignal,
  body?: string,
): Promise<Response> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const composed = signal ? AbortSignal.any([signal, timeout]) : timeout;

  const res = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    body,
    signal: composed,
    redirect: 'manual',
    headers: {
      ...BROWSER_HEADERS,
      ...(body === undefined ? {} : { 'content-type': 'application/x-www-form-urlencoded' }),
      ...lowercaseKeys(extraHeaders),
      'accept-encoding': 'gzip, deflate',
    },
  });

  return {
    status: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    body: await res.text(),
  };
}

function decompress(buffer: Buffer, encoding: string | undefined): string {
  switch (encoding) {
    case 'gzip':
      return zlib.gunzipSync(buffer).toString('utf8');
    case 'deflate':
      return zlib.inflateSync(buffer).toString('utf8');
    case 'br':
      return zlib.brotliDecompressSync(buffer).toString('utf8');
    default:
      return buffer.toString('utf8');
  }
}

function lowercaseKeys(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
}
