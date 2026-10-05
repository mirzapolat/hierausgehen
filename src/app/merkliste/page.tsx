import type { Metadata } from 'next';
import { SavedScreen } from '@/components/SavedScreen';

export const metadata: Metadata = {
  title: 'Merkliste',
  // Eine persönliche Liste aus dem Browser – für Suchmaschinen leer.
  robots: { index: false, follow: false },
};

export default function SavedPage() {
  return <SavedScreen />;
}
