import type { Metadata } from 'next';
import { ExportScreen } from '@/components/ExportScreen';
import { servedCities } from '@/lib/site-metadata';

export const metadata: Metadata = {
  title: 'Export',
  description: 'Alle bekannten Veranstaltungen als CSV-Datei.',
  robots: { index: false, follow: false },
};

/**
 * CSV-Export, erreichbar nur über `/export` – im Menü steht er bewusst nicht.
 *
 * Zur Auswahl stehen nur Städte mit Quellen: eine Stadt ohne Häuser trüge
 * nichts als die Kopfzeile bei. Die Registry bleibt dabei auf dem Server, die
 * Oberfläche bekommt nur Kennung und Namen.
 */
export default function ExportPage() {
  return <ExportScreen cities={servedCities.map(({ id, name }) => ({ id, name }))} />;
}
