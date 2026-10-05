'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { returnPath } from '@/lib/return-path';
import { useSettings } from '@/lib/settings/context';
import { ChevronLeft } from './icons';

/**
 * „Zurück zum Kalender“ oben links auf Einstellungen und Merkliste – an die
 * Stelle, von der aus die Seite geöffnet wurde. Ansicht, Tag und offener
 * Termin bleiben erhalten.
 *
 * Der Kalender braucht einen Moment, bis er steht. Solange tritt an die
 * Stelle des Knopfs ein Ladekreis, damit der Klick sichtbar angekommen ist.
 */
export function BackToCalendar() {
  const { cityId, t } = useSettings();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (pending) {
    return (
      <span
        role="status"
        aria-label={t('backToCalendar')}
        className="-ml-1 grid h-[26px] w-[26px] place-items-center text-muted"
      >
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 animate-spin" aria-hidden="true">
          <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.75" />
          <path d="M14 8a6 6 0 0 0-6-6" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        </svg>
      </span>
    );
  }

  return (
    <Link
      href="/"
      onClick={(e) => {
        e.preventDefault();
        startTransition(() => router.push(returnPath(cityId)));
      }}
      className="-ml-1 flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-1 text-[12px]
                 text-muted hover:text-text"
    >
      <ChevronLeft className="h-3.5 w-3.5" />
      {t('backToCalendar')}
    </Link>
  );
}
