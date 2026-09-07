import type { Metadata } from 'next';
import { ImprintScreen } from '@/components/ImprintScreen';

export const metadata: Metadata = {
  title: 'Impressum',
  description: 'Angaben gemäß § 5 DDG zu HIERAUSGEHEN.de.',
  robots: { index: false, follow: false },
};

export default function ImprintPage() {
  return <ImprintScreen />;
}
