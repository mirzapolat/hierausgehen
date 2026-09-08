import type { MetadataRoute } from 'next';
import { cities } from '@/lib/cities';
import { SITE_URL, programmePath, cityUrl } from '@/lib/site';

/** Kalender und lesbare Programmübersicht jeder Stadt. */
export default function sitemap(): MetadataRoute.Sitemap {
  // Kein künstliches Änderungsdatum: der Build ist kein Quellen-Update.
  return cities.flatMap((city, index) => [
    { url: cityUrl(city.id), changeFrequency: 'daily' as const, priority: index === 0 ? 1 : 0.8 },
    { url: new URL(programmePath(city.id), SITE_URL).toString(), changeFrequency: 'daily' as const, priority: 0.9 },
  ]);
}
