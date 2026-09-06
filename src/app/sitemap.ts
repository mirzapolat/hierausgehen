import type { MetadataRoute } from 'next';
import { cities } from '@/lib/cities';
import { cityUrl } from '@/lib/site';

/**
 * Je Stadt eine Adresse. Mehr gibt es nicht zu melden: alles Weitere ist ein
 * Ausschnitt desselben Kalenders und würde nur dieselbe Seite doppelt anbieten.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  // Der Datenstand wird täglich erneuert, die Seite ändert sich also täglich.
  const lastModified = new Date();

  return cities.map((city, index) => ({
    url: cityUrl(city.id),
    lastModified,
    changeFrequency: 'daily',
    priority: index === 0 ? 1 : 0.8,
  }));
}
