/*
 * Service Worker.
 *
 * Bewusst zurückhaltend: der Kalender lebt von aktuellen Terminen, deshalb
 * werden Daten **nie** aus dem Cache beantwortet. Zwischengespeichert wird nur
 * das Gerüst der App – damit lässt sie sich installieren und zeigt ohne
 * Verbindung eine verständliche Seite statt eines Browserfehlers.
 */

const VERSION = 'v2';
const SHELL = `shell-${VERSION}`;
const OFFLINE_URL = '/offline';

const PRECACHE = [OFFLINE_URL, '/icon-192.png', '/icon-512.png', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      // Einzelne Fehlschläge dürfen die Installation nicht verhindern.
      .then((cache) => Promise.allSettled(PRECACHE.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== SHELL).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Termine und Quellen-Icons kommen immer frisch aus dem Netz.
  if (url.pathname.startsWith('/api/')) return;

  // Seitenaufrufe: Netz zuerst, sonst die Offline-Seite.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(SHELL);
        return (await cache.match(OFFLINE_URL)) ?? Response.error();
      }),
    );
    return;
  }

  // Gebaute Dateien tragen einen Hash im Namen und ändern sich nie.
  if (url.pathname.startsWith('/_next/static/') || PRECACHE.includes(url.pathname)) {
    event.respondWith(
      caches.open(SHELL).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      }),
    );
  }
});
