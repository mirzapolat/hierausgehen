'use client';

import { useSettings } from '@/lib/settings/context';

/** Wird vom Service Worker gezeigt, wenn keine Verbindung besteht. */
export function OfflineScreen() {
  const { settings } = useSettings();
  const de = settings.locale === 'de';

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-[17px] font-semibold tracking-[-0.01em]">
        {de ? 'Keine Verbindung' : 'No connection'}
      </h1>
      <p className="max-w-[380px] text-[13px] leading-relaxed text-muted">
        {de
          ? 'Der Kalender braucht eine Verbindung, um die Spielpläne zu laden. Sobald du wieder online bist, geht es weiter.'
          : 'The calendar needs a connection to load the programmes. It will continue as soon as you are back online.'}
      </p>
      {/* Bewusst ein voller Seitenaufruf statt <Link>: offline gäbe es sonst
          nur eine gescheiterte Client-Navigation statt eines neuen Versuchs. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a
        href="/"
        className="mt-2 flex h-9 items-center rounded-[var(--radius-md)] border border-line px-4 text-[13px]
                   text-text hover:border-line-strong"
      >
        {de ? 'Erneut versuchen' : 'Try again'}
      </a>
    </div>
  );
}
