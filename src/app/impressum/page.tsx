import type { Metadata } from 'next';
import { ImprintScreen } from '@/components/ImprintScreen';
import { sourceDefinitions } from '@/lib/events/registry';

export const metadata: Metadata = {
  title: 'Impressum',
  description: 'Angaben gemäß § 5 DDG zu HIERAUSGEHEN.DE.',
  robots: { index: false, follow: false },
};

export default function ImprintPage() {
  // Die Quellen kommen vom Server – die Registry zieht Adapter-Code nach,
  // der nicht in den Browser gehört.
  return <ImprintScreen sources={sourceDefinitions} />;
}
