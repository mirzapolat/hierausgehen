import type { MetadataRoute } from 'next';
import { SITE_URL, programmePath, cityUrl } from '@/lib/site';
import { servedCities } from '@/lib/site-metadata';

/** Kalender und lesbare Programmübersicht jeder Stadt, die schon Quellen hat. */
export default function sitemap(): MetadataRoute.Sitemap {
  // Kein künstliches Änderungsdatum: der Build ist kein Quellen-Update.
  return servedCities.flatMap((city, index) => [
    { url: cityUrl(city.id), changeFrequency: 'daily' as const, priority: index === 0 ? 1 : 0.8 },
    { url: new URL(programmePath(city.id), SITE_URL).toString(), changeFrequency: 'daily' as const, priority: 0.9 },
  ]);
}
