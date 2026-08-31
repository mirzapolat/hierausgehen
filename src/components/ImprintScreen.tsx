'use client';

import Link from 'next/link';
import type { SourceDefinition } from '@/lib/events/types';
import { useSettings } from '@/lib/settings/context';
import { ChevronLeft, External } from './icons';

/**
 * Impressum. Bewusst schmucklos: eine Spalte, klare Reihenfolge,
 * kein Marketing – es soll schnell zu lesen sein.
 */
export function ImprintScreen({ sources }: { sources: SourceDefinition[] }) {
  const { t } = useSettings();

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-12 shrink-0 items-center gap-2 bg-[var(--chrome)] px-3 hairline-b">
        <Link
          href="/"
          className="-ml-1 flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-1 text-[12px]
                     text-muted hover:text-text"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          {t('backToCalendar')}
        </Link>
        <h1 className="ml-2 text-[14px] font-semibold tracking-[-0.01em]">{t('imprint')}</h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto scroll-quiet">
        <div className="mx-auto w-full max-w-[560px] px-5 py-8">
          <Section title={t('imprintHeading')}>
            <Row label={t('imprintName')}>Mirza Polat</Row>
            <Row label={t('imprintContact')}>
              {/* Absichtlich als Text mit „(at)" – so hat der Betreiber sie angegeben. */}
              <span className="select-all">kontakt(at)hierausgehen.de</span>
            </Row>
          </Section>

          <Section title={t('imprintContentTitle')}>
            <p className="text-[13px] leading-relaxed text-muted">{t('imprintContent')}</p>
          </Section>

          <Section title={t('imprintSources')}>
            <ul className="flex flex-col">
              {sources.map((source) => (
                <li key={source.id} className="flex items-center gap-2 py-1.5 hairline-b">
                  <span
                    aria-hidden="true"
                    className="h-[7px] w-[7px] shrink-0 rounded-full"
                    style={{ background: source.color }}
                  />
                  <span className="flex-1 text-[13px]">{source.name}</span>
                  <a
                    href={source.homepage}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-[12px] text-muted hover:text-text"
                  >
                    {new URL(source.homepage).hostname.replace(/^www\./, '')}
                    <External className="h-3 w-3" />
                  </a>
                </li>
              ))}
            </ul>
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
