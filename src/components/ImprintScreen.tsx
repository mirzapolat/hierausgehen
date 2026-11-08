'use client';

import { useSyncExternalStore } from 'react';
import { BackToCalendar } from './BackToCalendar';
import { useSettings } from '@/lib/settings/context';

/**
 * Impressum. Bewusst schmucklos: eine Spalte, klare Reihenfolge,
 * kein Marketing – es soll schnell zu lesen sein.
 */
export function ImprintScreen() {
  const { t } = useSettings();

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-12 shrink-0 items-center gap-2 bg-[var(--chrome)] px-3 hairline-b">
        <BackToCalendar />
        <h1 className="ml-2 text-[14px] font-semibold tracking-[-0.01em]">{t('imprint')}</h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto scroll-quiet">
        <div className="mx-auto w-full max-w-[560px] px-5 py-8">
          <Section title={t('imprintHeading')}>
            <Row label={t('imprintName')}>Mirza Polat</Row>
            <Row label={t('imprintAddress')}>
              <ObfuscatedAddress />
            </Row>
            <Row label={t('imprintContact')}>
              {/* Absichtlich als Text mit „(at)" – so hat der Betreiber sie angegeben. */}
              <span className="select-all">kontakt(at)hierausgehen.de</span>
            </Row>
          </Section>

          <Section title={t('imprintContentTitle')}>
            <p className="text-[13px] leading-relaxed text-muted">{t('imprintContent')}</p>
          </Section>

          <Section title={t('imprintMapsTitle')}>
            <p className="text-[13px] leading-relaxed text-muted">{t('imprintMaps')}</p>
          </Section>

          <Section title={t('imprintLinksTitle')}>
            <p className="text-[13px] leading-relaxed text-muted">{t('imprintLinks')}</p>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-[11px] font-medium uppercase tracking-[0.06em] text-faint">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 py-2 hairline-b sm:flex-row sm:items-baseline sm:gap-6">
      <span className="w-[120px] shrink-0 text-[12px] text-faint">{label}</span>
      <span className="text-[13px] text-text">{children}</span>
    </div>
  );
}

const ADDRESS_LINES = [
  [68, 97, 99, 104, 97, 117, 101, 114, 32, 83, 116, 114, 46, 32, 49, 53, 57],
  [56, 48, 54, 51, 54, 32, 77, 252, 110, 99, 104, 101, 110],
];
const EMPTY_ADDRESS: string[] = [];
const DECODED_ADDRESS = ADDRESS_LINES.map((line) => String.fromCharCode(...line));

function ObfuscatedAddress() {
  const lines = useSyncExternalStore(emptySubscribe, decodeAddress, emptyAddress);

  return (
    <address className="not-italic" suppressHydrationWarning>
      {lines.map((line) => (
        <span key={line} className="block select-all">
          {line}
        </span>
      ))}
    </address>
  );
}

function decodeAddress(): string[] {
  return DECODED_ADDRESS;
}

function emptyAddress(): string[] {
  return EMPTY_ADDRESS;
}

function emptySubscribe() {
  return () => {};
}
