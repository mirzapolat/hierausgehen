import type { Metadata } from 'next';
import { OfflineScreen } from '@/components/OfflineScreen';

export const metadata: Metadata = {
  title: 'Offline',
  robots: { index: false, follow: false },
};

export default function OfflinePage() {
  return <OfflineScreen />;
}
