import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

/**
 * Der Kalender selbst darf indexiert werden; die API liefert nur Rohdaten für
 * die eigene Oberfläche und gehört nicht in eine Suchmaschine.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: '/api/',
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
