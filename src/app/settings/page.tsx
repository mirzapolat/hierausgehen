import type { Metadata } from 'next';
import { SettingsScreen } from '@/components/SettingsScreen';

export const metadata: Metadata = {
  title: 'Einstellungen',
  // Eine Bedienoberfläche ohne Inhalt – in einer Suchmaschine hat sie nichts verloren.
  robots: { index: false, follow: false },
};

export default function SettingsPage() {
  return <SettingsScreen />;
}
