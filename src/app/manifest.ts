import type { MetadataRoute } from 'next';
import { APP_NAME, SITE_DESCRIPTION } from '@/lib/site';

/**
 * Web-App-Manifest. Damit lässt sich der Kalender auf dem Startbildschirm
 * ablegen und öffnet ohne Browserleiste.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: APP_NAME,
    description: SITE_DESCRIPTION,
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    lang: 'de',
    dir: 'ltr',
    categories: ['events', 'entertainment', 'lifestyle'],
    background_color: '#ffffff',
    theme_color: '#ffffff',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // Eigene Fassung mit Rand, damit Android sie beschneiden kann.
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
